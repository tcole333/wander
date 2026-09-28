import json
import math
from copy import deepcopy
from itertools import pairwise

import pytest

from prebuild.constants import CUBE
from prebuild.fx import RouteError, bounds, build_route, date_day, direction, run
from prebuild.hashing import sha256_bytes
from prebuild.paths import REPO_ROOT
from prebuild.profiles import Profile, make_context
from prebuild.records import read_record


def source():
    return {
        "type": "Feature",
        "properties": {
            "kind": "route",
            "epoch": "1519-09-20",
            "dates": ["1519-09-20", "1519-09-30", "1519-10-10", "1519-10-10"],
            "vertices": [{"name": "Departure"}, {}, {"name": "Port"}, {}],
            "legs": [
                {"from": 0, "to": 1, "uncertain": True, "sea": True},
                {"from": 1, "to": 2, "uncertain": False, "sea": True},
                {"from": 2, "to": 3, "uncertain": False, "sea": False},
            ],
        },
        "geometry": {
            "type": "LineString",
            "coordinates": [[170, 30], [-170, 30], [-170, 30], [-169, 30]],
        },
    }


def arc(a, b):
    dot = sum(x * y for x, y in zip(direction(a[:2]), direction(b[:2]), strict=True))
    return math.acos(max(-1, min(1, dot))) * CUBE["earthRadiusM"] / 1000


def test_short_great_circles_across_dateline_and_dates_by_distance():
    built = build_route(source())
    pts = built["pts"]
    end = next(i for i, p in enumerate(pts) if p[2] == 10)
    sailed = pts[: end + 1]
    assert built["epochDay"] == date_day("1519-09-20") == 554699
    assert all(abs(p[0]) >= 170 for p in sailed)
    assert max(p[1] for p in sailed) > 30.3  # great circle bows poleward
    distances = [arc(a, b) for a, b in pairwise(sailed)]
    assert max(distances) <= 50.001
    for i, distance in enumerate(distances):
        assert sailed[i + 1][2] - sailed[i][2] == pytest.approx(
            10 * distance / sum(distances), abs=2e-6
        )
    assert bounds(pts)[0] == 170
    assert bounds(pts)[2] == 191


def test_stays_same_day_controls_outgoing_flags_and_label_indexes_survive():
    built = build_route(source())
    pts = built["pts"]
    arrival = next(p for p in pts if p[2] == 10)
    departure = next(p for p in pts if p[2] == 20)
    assert arrival[:2] == departure[:2] == [-170, 30]
    assert arrival[3] == 2
    assert departure[3] == 0
    assert all(p[3] == 3 for p in pts if p[2] < 10)
    assert pts[built["labels"][1]["i"]] == departure
    assert built["labels"][0] == {"i": 0, "text": "Departure"}


@pytest.mark.parametrize(
    "problem", ["dates", "backward", "invalid_day", "coords", "legs", "antipodal"]
)
def test_invalid_source_fails_before_writing(problem):
    raw = source()
    p = raw["properties"]
    if problem == "dates":
        p["dates"].pop()
    elif problem == "backward":
        p["dates"][1] = "1519-09-19"
    elif problem == "invalid_day":
        p["dates"][1] = "1519-02-29"
    elif problem == "coords":
        raw["geometry"]["coordinates"][0] = [float("nan"), 30]
    elif problem == "legs":
        p["legs"][0]["to"] = 2
    else:
        raw["geometry"]["coordinates"][:2] = [[0, 0], [180, 0]]
    with pytest.raises(RouteError):
        build_route(raw)


def test_stage_builds_only_named_routes_namespaced_and_reproducibly(tmp_path):
    for story in ["one", "two"]:
        folder = tmp_path / "stories" / story
        (folder / "data").mkdir(parents=True)
        (folder / "story.md").write_text(
            "```beat\neffects:\n  - route: {dataset: route}\n  - route: {dataset: route}\n"
            "  - spread: {dataset: not-built}\n```\n"
        )
        (folder / "data/route.geojson").write_text(json.dumps(source()))
        (folder / "data/unused.geojson").write_text("invalid")
    ctx = make_context(Profile.FIXTURE, 1, tmp_path)
    run(ctx)
    record = read_record(ctx, "fx")
    assert set(record) == {"one/route", "two/route"}
    entry = record["one/route"]
    assert entry == record["two/route"]
    data = (ctx.out / entry["key"]).read_bytes()
    assert entry["key"] == f"fx/{sha256_bytes(data)[:16]}.json"
    assert entry["bytes"] == len(data)
    assert entry["kind"] == "route"
    assert set(entry) == {"key", "kind", "epochDay", "bbox", "bytes"}
    run(ctx)
    assert record == read_record(ctx, "fx")
    assert data == (ctx.out / entry["key"]).read_bytes()
    (ctx.out / entry["key"]).write_bytes(b"wrong")
    with pytest.raises(RouteError, match="different bytes"):
        run(ctx)


def test_magellan_fits_the_core_and_keeps_mactan_at_the_ships():
    raw = json.loads((REPO_ROOT / "stories/magellan/data/route.geojson").read_text())
    built = build_route(deepcopy(raw))
    assert len(json.dumps(built, separators=(",", ":")).encode()) < 100_000
    assert len(built["pts"]) > len(raw["geometry"]["coordinates"])
    assert bounds(built["pts"])[::2] == [-180, 180]
    day = date_day("1521-04-27") - built["epochDay"]
    assert next(p[:2] for p in built["pts"] if p[2] == day) == [123.92, 10.29]
    assert all(p[3] == 3 for p in built["pts"])
