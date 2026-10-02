import struct
import zlib

import pytest

from prebuild.faces import Face, FaceError, Subset, read_face, woff_tables


def cmap4(first: int, last: int, glyph: int) -> bytes:
    """A cmap with one Unicode BMP format 4 subtable mapping first..last to glyph, glyph + 1..."""
    seg = 2
    ends = struct.pack(">2H", last, 0xFFFF)
    starts = struct.pack(">2H", first, 0xFFFF)
    deltas = struct.pack(">2h", (glyph - first) % 0x10000 - (0x10000 if glyph < first else 0), 1)
    ranges = struct.pack(">2H", 0, 0)
    body = ends + b"\0\0" + starts + deltas + ranges
    sub = struct.pack(">7H", 4, 14 + len(body), 0, seg * 2, 2, 0, 0) + body
    return struct.pack(">HHHHI", 0, 1, 3, 1, 12) + sub


def cmap12(first: int, last: int, glyph: int) -> bytes:
    sub = struct.pack(">HHIII", 12, 0, 28, 0, 1) + struct.pack(">III", first, last, glyph)
    return struct.pack(">HHHHI", 0, 1, 3, 10, 12) + sub


def woff(tables: dict[str, bytes], compress: bool = True) -> bytes:
    """A WOFF file of the tables, each compressed where that makes it smaller."""
    header_size, entry_size = 44, 20
    offset = header_size + entry_size * len(tables)
    directory, body = b"", b""
    for tag, data in sorted(tables.items()):
        packed = zlib.compress(data) if compress else data
        if len(packed) >= len(data):
            packed = data
        directory += struct.pack(
            ">4sIIII", tag.encode(), offset + len(body), len(packed), len(data), 0
        )
        body += packed + b"\0" * (-len(packed) % 4)
    length = offset + len(body)
    header = struct.pack(
        ">4sIIHHIHHIIIII", b"wOFF", 0x10000, length, len(tables), 0, 0, 1, 0, 0, 0, 0, 0, 0
    )
    return header + directory + body


def font(cmap: bytes, advances: list[int], units: int = 1000, cap: int = 625) -> bytes:
    head = bytearray(54)
    struct.pack_into(">H", head, 18, units)
    hhea = bytearray(36)
    struct.pack_into(">H", hhea, 34, len(advances))
    hmtx = b"".join(struct.pack(">Hh", a, 0) for a in advances)
    os2 = bytearray(96)
    struct.pack_into(">H", os2, 0, 2)
    struct.pack_into(">h", os2, 88, cap)
    return woff(
        {"cmap": cmap, "head": bytes(head), "hhea": bytes(hhea), "hmtx": hmtx, "OS/2": bytes(os2)}
    )


def test_a_woff_subsets_cmap_advances_and_cap_height_read_back():
    subset = Subset.read(font(cmap4(ord("A"), ord("C"), 1), [0, 500, 600, 700]))
    assert subset.glyphs == {65: 1, 66: 2, 67: 3}
    assert subset.advance(ord("B")) == 0.6
    assert subset.cap == 625


def test_a_format_12_subtable_is_read_where_the_font_gives_one():
    subset = Subset.read(font(cmap12(0x1EA0, 0x1EA1, 1), [0, 500, 520]))
    assert subset.glyphs == {0x1EA0: 1, 0x1EA1: 2}


def test_uncompressed_tables_read_as_compressed_ones_do():
    raw = font(cmap4(ord("A"), ord("A"), 1), [0, 500])
    data = woff(woff_tables(raw), compress=False)
    assert Subset.read(data).glyphs == {65: 1}


def test_a_face_takes_each_character_from_the_first_subset_that_covers_it():
    latin = Subset({65: 1}, (0, 500), 1000, 625)
    vietnamese = Subset({65: 1, 0x1EA0: 2}, (0, 900, 640), 1000, 0)
    face = Face("Test", [latin, vietnamese])
    assert face.advance("A") == 0.5
    assert face.advance("Ạ") == 0.64
    assert face.width("AẠ") == pytest.approx(1.14)
    assert face.cap == 0.625
    assert face.missing("AẠB C B") == "BC"


def test_a_missing_file_names_the_command_that_installs_it(tmp_path):
    with pytest.raises(FaceError, match="run `npm ci` in app/"):
        read_face("Test", [tmp_path / "none.woff"])


def test_a_file_that_is_not_woff_fails():
    with pytest.raises(FaceError, match="not a WOFF file"):
        woff_tables(b"OTTO" + bytes(60))
