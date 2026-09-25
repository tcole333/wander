import re

from prebuild.constants import CUBE, FORMATS, LAYERS, SENTINELS
from prebuild.paths import REPO_ROOT

DESIGN_DOC = (REPO_ROOT / "docs" / "design" / "streaming.md").read_text(encoding="utf-8")

U16_MAX = 0xFFFF


def test_every_binary_magic_in_the_design_doc_is_shared():
    documented = set(re.findall(r"^\s*'(W[A-Z]{2}\d)' u8 version", DESIGN_DOC, flags=re.MULTILINE))
    shared = {fmt["magic"] for fmt in FORMATS.values()}
    assert documented == shared


def test_magics_are_four_ascii_bytes():
    for name, fmt in FORMATS.items():
        assert len(str(fmt["magic"]).encode("ascii")) == 4, name


def test_format_versions_fit_a_u8():
    for name, fmt in FORMATS.items():
        assert 0 <= int(fmt["version"]) <= 0xFF, name


def test_layer_order_matches_the_design_doc_canonical_order():
    match = re.search(r"the `\?l=` bit order: ([^.]+)\.", DESIGN_DOC.replace("\n  ", " "))
    assert match, "canonical layer order not found in streaming.md 3.9"
    documented = [name.strip() for name in match.group(1).split(",")]
    assert documented == LAYERS


def test_real_feature_ids_stay_below_the_u16_sentinels():
    assert SENTINELS["featureNone"] == 0
    assert SENTINELS["featureMax"] < SENTINELS["hasFileOrConstant"] < SENTINELS["empty"] <= U16_MAX


MINUS = "\u2212"  # the design doc writes negative numbers with U+2212


def _vector(cell: str) -> list[int]:
    return [int(part) for part in cell.strip("()").replace(MINUS, "-").split(",")]


def test_cube_face_table_matches_the_design_doc():
    rows = re.findall(
        rf"^\s*\| (\d) \([+{MINUS}][XYZ]\) \| (\([^|]+\)) \| (\([^|]+\)) \| (\([^|]+\)) \|$",
        DESIGN_DOC,
        flags=re.MULTILINE,
    )
    assert [int(row[0]) for row in rows] == list(range(6))
    documented = [{"c": _vector(c), "u": _vector(u), "v": _vector(v)} for _, c, u, v in rows]
    assert documented == CUBE["faces"]


def test_cube_radius_matches_the_design_doc():
    assert "R = 6,371,008.8 m" in DESIGN_DOC
    assert CUBE["earthRadiusM"] == 6_371_008.8


def test_cube_tile_and_border_match_the_design_doc():
    assert f"i, j in {MINUS}4..259" in DESIGN_DOC
    assert (CUBE["tile"], CUBE["border"]) == (256, 4)
