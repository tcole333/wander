import io
import json

import pytest
from PIL import Image

from prebuild import media
from prebuild.paths import excerpts_dir
from prebuild.profiles import Profile, make_context

# The committed offline source: 640x480, its quadrants flat colors.
SOURCES = excerpts_dir() / "media"
QUADRANTS = (SOURCES / "quadrants.jpg").read_bytes()
QUADRANTS_SHA1 = "ead88c8e7d0db6173e0608c6b158e8d2debb4e62"
TOP_RIGHT = (40, 70, 150)

STORY = """---
id: test
---

## A Beat

```beat
id: one
image:
  commons: "File:Wander test quadrants.jpg"
  sha1: "ead88c8e7d0db6173e0608c6b158e8d2debb4e62"
  crop: [0.5, 0, 1, 0.5]
  alt: "The top right quadrant."
```

Words.
"""


def test_the_pinned_original_bakes_its_crop_at_each_width_and_any_other_is_refused():
    media.check_sha1(QUADRANTS, QUADRANTS_SHA1, "quadrants")
    with pytest.raises(media.MediaError, match="not the pinned"):
        media.check_sha1(QUADRANTS[:-1], QUADRANTS_SHA1, "quadrants")

    baked = media.bake(QUADRANTS, (0.5, 0.0, 1.0, 0.5))
    # Never wider than the 320 px crop, so the 1024 is the crop itself.
    assert {width: (b.w, b.h) for width, b in baked.items()} == {1024: (320, 240), 256: (256, 192)}
    small = Image.open(io.BytesIO(baked[256].data))
    assert (small.format, small.size) == ("JPEG", (256, 192))
    center = small.convert("RGB").getpixel((128, 96))
    assert all(abs(a - b) <= 6 for a, b in zip(center, TOP_RIGHT, strict=True))


def test_a_16_bit_grayscale_original_bakes_its_grays_scaled_to_8_bits():
    stream = io.BytesIO()
    Image.new("I;16", (300, 200), 20000).save(stream, "TIFF")
    baked = media.bake(stream.getvalue(), (0.0, 0.0, 1.0, 1.0))
    gray = Image.open(io.BytesIO(baked[256].data)).getpixel((128, 85))
    assert abs(gray - round(20000 / 257)) <= 2


def test_the_stage_writes_both_keys_and_locks_them_with_the_credit_and_license(tmp_path):
    story = tmp_path / "stories" / "test" / "story.md"
    story.parent.mkdir(parents=True)
    story.write_text(STORY, encoding="utf-8")
    ctx = make_context(Profile.FIXTURE, 1, tmp_path, story="test", offline=True)
    media.run(ctx, media.committed_originals(SOURCES))

    lock = json.loads((story.parent / "story.lock.json").read_text(encoding="utf-8"))
    [image] = lock["images"]
    assert [(f["w"], f["h"]) for f in image["files"]] == [(320, 240), (256, 192)]
    sha16 = image["files"][0]["key"][4:20]
    assert [f["key"] for f in image["files"]] == [f"img/{sha16}-1024.jpg", f"img/{sha16}-256.jpg"]
    for file in image["files"]:
        assert (ctx.out / file["key"]).stat().st_size == file["bytes"]
    assert image["credit"] == "Test Pattern, L. Hebert"
    assert image["license"] == "Public domain"
    assert image["source"] == "https://commons.wikimedia.org/wiki/File:Wander_test_quadrants.jpg"
