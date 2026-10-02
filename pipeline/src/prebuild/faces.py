"""The faces the state names are lettered in (streaming.md 3.3, Names), read from the WOFF files the
app bundles through @fontsource: which characters each face covers, and each character's advance,
so the names stage can check every name's glyphs and fit its letters before the app letters them.

A face is the WOFF files of its subsets (latin, latin-ext, vietnamese, ...), each a subset of one
font with glyph ids of its own; a character belongs to the first subset whose `cmap` maps it. The
reader needs no font library: it decompresses the WOFF tables it reads (`cmap` formats 4 and 12,
`head`, `hhea`, `hmtx` and `OS/2`) with zlib. Advances leave kerning out: the stage fits a name's
span, and the app sets its letters to that span with the face's own kerning.
"""

import struct
import zlib
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

WOFF_HEADER = struct.Struct(">4sIIHHIHHIIIII")  # 44 bytes
WOFF_ENTRY = struct.Struct(">4sIIII")  # 20 bytes


class FaceError(ValueError):
    """A face's files are missing or are not WOFF fonts the reader understands."""


def woff_tables(data: bytes) -> dict[str, bytes]:
    """A WOFF file's tables by tag, decompressed."""
    if len(data) < WOFF_HEADER.size:
        raise FaceError("too short for a WOFF header")
    signature, _flavor, length, count, *_ = WOFF_HEADER.unpack_from(data)
    if signature != b"wOFF" or length != len(data):
        raise FaceError("not a WOFF file")
    tables: dict[str, bytes] = {}
    for k in range(count):
        tag, offset, packed, size, _checksum = WOFF_ENTRY.unpack_from(
            data, WOFF_HEADER.size + k * WOFF_ENTRY.size
        )
        body = data[offset : offset + packed]
        tables[tag.decode("latin-1")] = zlib.decompress(body) if packed < size else body
    return tables


def cmap_glyphs(cmap: bytes) -> dict[int, int]:
    """The characters a `cmap` table maps to a glyph other than .notdef: format 12 from a Unicode
    full-repertoire subtable where there is one, else format 4 from a Unicode BMP subtable."""
    _version, count = struct.unpack_from(">HH", cmap)
    subtables: dict[tuple[int, int], int] = {}
    for k in range(count):
        platform, encoding, offset = struct.unpack_from(">HHI", cmap, 4 + 8 * k)
        subtables[(platform, encoding)] = offset
    for key in ((3, 10), (0, 4), (0, 6)):
        if key in subtables and struct.unpack_from(">H", cmap, subtables[key])[0] == 12:
            return _format12(cmap, subtables[key])
    for key in ((3, 1), (0, 3), (0, 1), (0, 0)):
        if key in subtables and struct.unpack_from(">H", cmap, subtables[key])[0] == 4:
            return _format4(cmap, subtables[key])
    raise FaceError("no Unicode cmap subtable of format 4 or 12")


def _format4(cmap: bytes, at: int) -> dict[int, int]:
    seg_count = struct.unpack_from(">H", cmap, at + 6)[0] // 2
    ends = struct.unpack_from(f">{seg_count}H", cmap, at + 14)
    starts_at = at + 16 + 2 * seg_count
    starts = struct.unpack_from(f">{seg_count}H", cmap, starts_at)
    deltas = struct.unpack_from(f">{seg_count}h", cmap, starts_at + 2 * seg_count)
    ranges_at = starts_at + 4 * seg_count
    ranges = struct.unpack_from(f">{seg_count}H", cmap, ranges_at)
    glyphs: dict[int, int] = {}
    for k in range(seg_count):
        for code in range(starts[k], ends[k] + 1):
            if code == 0xFFFF:
                continue
            if ranges[k] == 0:
                glyph = (code + deltas[k]) & 0xFFFF
            else:
                where = ranges_at + 2 * k + ranges[k] + 2 * (code - starts[k])
                glyph = struct.unpack_from(">H", cmap, where)[0]
                if glyph:
                    glyph = (glyph + deltas[k]) & 0xFFFF
            if glyph:
                glyphs[code] = glyph
    return glyphs


def _format12(cmap: bytes, at: int) -> dict[int, int]:
    groups = struct.unpack_from(">I", cmap, at + 12)[0]
    glyphs: dict[int, int] = {}
    for k in range(groups):
        start, end, first = struct.unpack_from(">III", cmap, at + 16 + 12 * k)
        for code in range(start, end + 1):
            glyph = first + code - start
            if glyph:
                glyphs[code] = glyph
    return glyphs


@dataclass
class Subset:
    """One WOFF file of a face: its characters' glyphs and the glyphs' advances, font units."""

    glyphs: dict[int, int]
    advances: tuple[int, ...]
    units: int
    cap: int  # OS/2 sCapHeight, font units; 0 where the table lacks it

    @classmethod
    def read(cls, data: bytes) -> Subset:
        tables = woff_tables(data)
        for tag in ("cmap", "head", "hhea", "hmtx"):
            if tag not in tables:
                raise FaceError(f"no {tag} table")
        units = struct.unpack_from(">H", tables["head"], 18)[0]
        metrics = struct.unpack_from(">H", tables["hhea"], 34)[0]
        advances = struct.unpack_from(f">{metrics * 2}H", tables["hmtx"])[0::2]
        cap = 0
        os2 = tables.get("OS/2", b"")
        if len(os2) >= 90 and struct.unpack_from(">H", os2)[0] >= 2:
            cap = struct.unpack_from(">h", os2, 88)[0]
        return cls(cmap_glyphs(tables["cmap"]), advances, units, cap)

    def advance(self, code: int) -> float:
        """The advance of the character's glyph, ems."""
        glyph = self.glyphs[code]
        return self.advances[min(glyph, len(self.advances) - 1)] / self.units


@dataclass
class Face:
    """A face's subsets, the first that covers a character giving its glyph."""

    name: str
    subsets: Sequence[Subset]
    covered: frozenset[int] = field(init=False)

    def __post_init__(self) -> None:
        self.covered = frozenset().union(*(s.glyphs.keys() for s in self.subsets))

    def covers(self, char: str) -> bool:
        return char.isspace() or ord(char) in self.covered

    def missing(self, text: str) -> str:
        """The characters of `text` the face lacks, each once, in order."""
        found: list[str] = []
        for char in text:
            if not self.covers(char) and char not in found:
                found.append(char)
        return "".join(found)

    def advance(self, char: str) -> float:
        """A character's advance, ems; a space's where the face lacks the character."""
        for subset in self.subsets:
            if ord(char) in subset.glyphs:
                return subset.advance(ord(char))
        return self.advance(" ") if char != " " else 0.25

    def width(self, text: str) -> float:
        """The text's advance with no tracking or kerning, ems."""
        return sum(self.advance(char) for char in text)

    @property
    def cap(self) -> float:
        """Its capitals' height, ems, from the first subset that gives it."""
        for subset in self.subsets:
            if subset.cap:
                return subset.cap / subset.units
        raise FaceError(f"{self.name} gives no cap height")


def read_face(name: str, paths: Sequence[Path]) -> Face:
    """A face from its subsets' WOFF files, the latin subset first; a missing file fails, naming the
    command that installs it."""
    subsets = []
    for path in paths:
        if not path.is_file():
            raise FaceError(f"{path} is missing: run `npm ci` in app/")
        subsets.append(Subset.read(path.read_bytes()))
    return Face(name, subsets)
