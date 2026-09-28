"""The media stage (streaming.md 3.9, 4.1, 7.1): a story's beat images, baked from their Commons
originals into the profile's output root, with the story's committed lock.

`uv run prebuild media --story <id>` reads the `image` of every beat in
`stories/<id>/story.md` (`{commons, sha1, crop, alt, credit?, license?, collection?}`), and for
each:

- asks Commons' API for the file by title, takes the revision whose sha1 is the one the story
  pins, and downloads that original into `build/cache/commons/` (once; later runs reuse it after
  checking its sha1 again);
- bakes the crop, a fraction of the original, into JPEGs 1024 and 256 px wide (quality 85,
  progressive, the original's color profile kept; AVIF is deferred), never wider than the crop;
- writes them as `img/<sha16>-1024.jpg` and `img/<sha16>-256.jpg`, where `<sha16>` is the first 16
  hex characters of `lines_sha` over the two files' sha256, keyed `1024.jpg` and `256.jpg`. A key
  already there is kept only when it holds the same bytes, since keys are never overwritten.

Then it writes `stories/<id>/story.lock.json`: per image (in beat order, one entry per distinct
sha1 and crop) its Commons title, sha1 and crop, its files with their keys, sizes and bytes, the
credit, the license and the file's page. The credit names the artists from Commons' Artist field
(catalog names such as 'Pinkerton, John, 1758-1826' as 'John Pinkerton'), or failing that its
Credit field; the license is Commons' LicenseShortName as it stands. A beat's own `credit` and
`license` stand in for Commons' where the story words them better: the makers when Commons' Artist
names an uploader or spells a name otherwise than the credits page, and the source's own rights
statement where Commons gives only its template's short name. A beat's `collection`, the holding
collection's own credit line where it asks to be credited so (the David Rumsey Map Collection's),
is locked beside the credit. The release names every key a lock lists (app/scripts/release.ts), so
`npm run publish-data` uploads them.

`--offline` reads the committed sources in `pipeline/tests/data/media/` instead of Commons: the
files themselves and, in `commons.json`, the metadata the API would give for each title. The stage
writes no record (streaming.md 7.2); the lock is its record.
"""

import hashlib
import html
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from PIL import Image, ImageOps

from prebuild.hashing import lines_sha, sha256_bytes
from prebuild.paths import excerpts_dir
from prebuild.profiles import Context

API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia asks every client to name itself and a way to reach its maker.
USER_AGENT = "wander-prebuild/0 (https://github.com/tcole333/wander)"
TIMEOUT_S = 60
CHUNK = 1 << 20

WIDTHS = (1024, 256)  # the baked widths, px; the key's suffix names each
QUALITY = 85
# The pinned originals run past Pillow's decompression-bomb guard (the Pinkerton maps are 117
# megapixels); the sha1 pin is the guard here.
Image.MAX_IMAGE_PIXELS = None

BEAT_BLOCK = re.compile(r"^```beat\n(.*?)\n```", re.MULTILINE | re.DOTALL)
SHA1 = re.compile(r"[0-9a-f]{40}")


class MediaError(ValueError):
    """A story's image cannot be baked as pinned: the story, Commons or the output disagree."""


type Crop = tuple[float, float, float, float]


@dataclass(frozen=True)
class StoryImage:
    """A beat's `image` in story.md."""

    beat: str
    commons: str  # the file's title, 'File:...'
    sha1: str
    crop: Crop  # fractions of the original: x0, y0, x1, y1
    credit: str | None  # the makers, as the story words them, over Commons' Artist field
    license: str | None  # the rights statement, as the story words it, over Commons' short name
    collection: str | None  # the holding collection's credit line, where it asks for one


@dataclass(frozen=True)
class Original:
    """A Commons original and what its file page says of it."""

    data: bytes
    artist: str  # Commons' Artist field, HTML
    credit: str  # Commons' Credit field, HTML
    license: str  # Commons' LicenseShortName
    source: str  # the file's page


@dataclass(frozen=True)
class Baked:
    """One baked JPEG."""

    data: bytes
    w: int
    h: int


type Originals = Callable[[StoryImage], Original]


def run(ctx: Context) -> None:
    if ctx.story is None:
        raise MediaError("name the story: `uv run prebuild media --story <id>`")
    started = time.perf_counter()
    story_md = ctx.repo / "stories" / ctx.story / "story.md"
    images = story_images(story_md.read_text(encoding="utf-8"))
    # The committed sources live in this checkout, whichever repo the stage builds.
    offline = committed_originals(excerpts_dir() / "media")
    originals = offline if ctx.offline else commons_originals(ctx.cache / "commons")
    entries: list[dict[str, Any]] = []
    seen: set[tuple[str, Crop]] = set()
    for image in images:
        if (image.sha1, image.crop) in seen:
            continue
        seen.add((image.sha1, image.crop))
        original = originals(image)
        check_sha1(original.data, image.sha1, image.commons)
        baked = bake(original.data, image.crop)
        keys = image_keys(baked)
        for width, key in keys.items():
            write_object(ctx.out / key, baked[width].data)
        if baked[WIDTHS[0]].w < WIDTHS[0]:
            print(
                f"media: {image.beat}'s crop is {baked[WIDTHS[0]].w} px wide, under {WIDTHS[0]}",
                flush=True,
            )
        entries.append(lock_entry(image, original, baked, keys))
    lock = story_md.with_name("story.lock.json")
    write_lock(lock, {"images": entries})
    seconds = time.perf_counter() - started
    print(
        f"media: {len(entries)} images of {ctx.story} into img/, "
        f"{lock.relative_to(ctx.repo)}, {seconds:.1f} s",
        flush=True,
    )


def story_images(markdown: str) -> list[StoryImage]:
    """Every beat's image, in story order."""
    images: list[StoryImage] = []
    for block in BEAT_BLOCK.findall(markdown):
        beat = yaml.safe_load(block)
        image = beat.get("image")
        if image is None:
            continue
        where = f"beat {beat.get('id')!r}"
        crop = tuple(float(value) for value in image.get("crop", (0, 0, 1, 1)))
        if len(crop) != 4 or not (0 <= crop[0] < crop[2] <= 1 and 0 <= crop[1] < crop[3] <= 1):
            raise MediaError(f"{where}: crop {list(crop)} is not x0 < x1 and y0 < y1 within 0-1")
        sha1 = str(image.get("sha1", ""))
        if not SHA1.fullmatch(sha1):
            raise MediaError(f"{where}: sha1 {sha1!r} is not 40 hex digits")
        credit, license = image.get("credit"), image.get("license")
        collection = image.get("collection")
        images.append(
            StoryImage(
                beat=str(beat["id"]),
                commons=str(image["commons"]),
                sha1=sha1,
                crop=(crop[0], crop[1], crop[2], crop[3]),
                credit=None if credit is None else str(credit),
                license=None if license is None else str(license),
                collection=None if collection is None else str(collection),
            )
        )
    return images


def check_sha1(data: bytes, pinned: str, title: str) -> None:
    found = hashlib.sha1(data, usedforsecurity=False).hexdigest()
    if found != pinned:
        raise MediaError(f"{title} has sha1 {found}, not the pinned {pinned}")


def bake(data: bytes, crop: Crop) -> dict[int, Baked]:
    """The crop at each of WIDTHS (never wider than the crop itself), as JPEG, by width."""
    with Image.open(io.BytesIO(data)) as image:
        profile = image.info.get("icc_profile")
        ImageOps.exif_transpose(image, in_place=True)
        w, h = image.size
        x0, y0, x1, y1 = crop
        cropped = image.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))
    if cropped.mode.startswith("I;16"):
        # Pillow clips 16-bit values when it converts them, so they are scaled to 8 bits first.
        cropped = cropped.convert("I").point(lambda v: v / 257).convert("L")
    elif cropped.mode in ("I", "F"):
        raise MediaError(f"an original in Pillow's {cropped.mode} mode has no 8-bit scale to bake")
    if cropped.mode not in ("RGB", "L"):
        cropped, profile = cropped.convert("RGB"), None  # the profile described the old mode
    baked: dict[int, Baked] = {}
    for width in WIDTHS:
        across = min(width, cropped.width)
        size = (across, max(1, round(cropped.height * across / cropped.width)))
        scaled = cropped
        if size != cropped.size:
            scaled = cropped.resize(size, Image.Resampling.LANCZOS, reducing_gap=3.0)
        stream = io.BytesIO()
        scaled.save(
            stream, "JPEG", quality=QUALITY, optimize=True, progressive=True, icc_profile=profile
        )
        baked[width] = Baked(stream.getvalue(), *size)
    return baked


def image_keys(baked: dict[int, Baked]) -> dict[int, str]:
    """Each width's key: `img/<sha16>-<width>.jpg`, the sha16 naming every width's bytes."""
    sha16 = lines_sha({f"{w}.jpg": sha256_bytes(b.data) for w, b in baked.items()})[:16]
    return {width: f"img/{sha16}-{width}.jpg" for width in baked}


def write_object(path: Path, data: bytes) -> None:
    """Write a key's file, or keep the one there when it holds the same bytes."""
    if path.exists():
        if path.read_bytes() != data:
            raise MediaError(f"{path} already holds other bytes, and keys are never overwritten")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    partial.write_bytes(data)
    partial.replace(path)


def lock_entry(
    image: StoryImage, original: Original, baked: dict[int, Baked], keys: dict[int, str]
) -> dict[str, Any]:
    files = [
        {"key": keys[w], "w": baked[w].w, "h": baked[w].h, "bytes": len(baked[w].data)}
        for w in WIDTHS
    ]
    collection = {} if image.collection is None else {"collection": image.collection}
    return {
        "commons": image.commons,
        "sha1": image.sha1,
        "crop": list(image.crop),
        "files": files,
        "credit": image.credit or credit_line(original.artist, original.credit),
        **collection,
        "license": image.license or plain_text(original.license),
        "source": original.source,
    }


def write_lock(path: Path, lock: dict[str, Any]) -> None:
    partial = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    partial.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    partial.replace(path)


# Credits from Commons' metadata, which is HTML


def plain_text(markup: str) -> str:
    """Text from a Commons metadata value: tags dropped, entities decoded, spaces collapsed."""
    return " ".join(html.unescape(re.sub(r"<[^>]*>", " ", markup)).split())


def person_name(name: str) -> str:
    """A catalog name as people write it: 'Pinkerton, John, 1758-1826' is 'John Pinkerton'."""
    bare = re.sub(r",\s*(c\.\s*)?[\d?]{3,4}\s*[-\u2013]\s*[\d?]{0,4}\s*$", "", name).strip()
    inverted = re.fullmatch(r"([^,]+),\s*([^,]+)", bare)
    return f"{inverted[2]} {inverted[1]}" if inverted else bare


def credit_line(artist: str, credit: str) -> str:
    """The artists from Commons' Artist field (each list item a name), else its Credit field."""
    parts = re.split(r"</(?:dd|li)>", artist, flags=re.IGNORECASE)
    names = [name for name in (person_name(plain_text(part)) for part in parts) if name]
    return ", ".join(names) if names else plain_text(credit)


# Where originals come from


def commons_originals(cache: Path) -> Originals:
    """Originals from Commons, downloaded once into `cache` and named there by sha1."""

    def get(image: StoryImage) -> Original:
        info, meta = _revision(image)
        path = cache / f"{image.sha1}{Path(urllib.parse.urlsplit(info['url']).path).suffix}"
        if not path.exists():
            print(f"media: downloading {image.commons}", flush=True)
            _download(info["url"], path, image)
        return Original(
            data=path.read_bytes(),
            artist=meta.get("Artist", ""),
            credit=meta.get("Credit", ""),
            license=meta.get("LicenseShortName", ""),
            source=info["descriptionurl"],
        )

    return get


def committed_originals(folder: Path) -> Originals:
    """Originals from committed files, with the metadata `commons.json` gives each title."""

    def get(image: StoryImage) -> Original:
        known = json.loads((folder / "commons.json").read_text(encoding="utf-8"))
        entry = known.get(image.commons)
        if entry is None:
            raise MediaError(f"{folder} holds no offline source for {image.commons}")
        return Original(
            data=(folder / entry["file"]).read_bytes(),
            artist=entry["artist"],
            credit=entry["credit"],
            license=entry["license"],
            source=entry["source"],
        )

    return get


def _revision(image: StoryImage) -> tuple[dict[str, Any], dict[str, str]]:
    """The file's revision with the pinned sha1, and the file page's metadata."""
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "imageinfo",
        "iiprop": "url|sha1|extmetadata",
        "iiextmetadatafilter": "Artist|Credit|LicenseShortName",
        "iilimit": "50",
        "titles": image.commons,
    }
    url = f"{API}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(_request(url), timeout=TIMEOUT_S) as response:
        body = json.load(response)
    pages = body.get("query", {}).get("pages", [])
    revisions = pages[0].get("imageinfo", []) if pages else []
    if not revisions:
        raise MediaError(f"Commons has no file {image.commons}")
    pinned = [info for info in revisions if info.get("sha1") == image.sha1]
    if not pinned:
        raise MediaError(f"no revision of {image.commons} on Commons has sha1 {image.sha1}")
    extmetadata = revisions[0].get("extmetadata", {})
    meta = {name: str(field.get("value", "")) for name, field in extmetadata.items()}
    return pinned[0], meta


def _download(url: str, path: Path, image: StoryImage) -> None:
    """Download to a partial file beside `path`, renamed once its sha1 is the pin."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{os.getpid()}.part")
    try:
        with urllib.request.urlopen(_request(url), timeout=TIMEOUT_S) as response:
            data = bytearray()
            while chunk := response.read(CHUNK):
                data += chunk
        check_sha1(bytes(data), image.sha1, image.commons)
        partial.write_bytes(data)
        partial.replace(path)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
