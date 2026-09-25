import zipfile

import numpy as np
import pyogrio.raw
import pytest
import shapely

from prebuild.config import WaterConfig
from prebuild.natural_earth import (
    SEGMENT_DEG,
    Layer,
    Vectors,
    from_wkb,
    lakes,
    land,
    read_excerpt_layer,
    read_zip_layer,
    rivers,
    to_wkb,
    write_excerpt_layer,
)

WATER = WaterConfig(
    half_width_km={rank: 0.1 for rank in range(13)},
    rivers_max_scalerank={},
    river_classes=("River", "Lake Centerline"),
    lake_classes=("Lake", "Alkaline Lake"),
    reservoir_allowlist=frozenset({42}),
)


def layer(geoms, **attrs) -> Layer:
    return Layer(
        np.array(geoms, dtype=object), {k: np.array(v, dtype=object) for k, v in attrs.items()}
    )


def even_odd(geom, x: float, y: float) -> bool:
    """Whether a point is inside under the even-odd rule the fields rasterize with: an odd number
    of the geometry's rings enclose it."""
    rings = []
    for polygon in shapely.get_parts(geom):
        rings.append(shapely.get_exterior_ring(polygon))
        rings += [
            shapely.get_interior_ring(polygon, i)
            for i in range(shapely.get_num_interior_rings(polygon))
        ]
    return int(shapely.contains_xy(shapely.polygons(np.array(rings)), x, y).sum()) % 2 == 1


def square(x0, y0, size):
    return shapely.box(x0, y0, x0 + size, y0 + size)


def test_land_drops_null_island_and_keeps_the_feature_with_no_class():
    prepared = land(
        layer(
            [square(0, 0, 0.01), square(10, 10, 1), square(20, 20, 1)],
            featurecla=["Null island", "Land", None],
        ),
        None,
    )
    assert not shapely.contains_xy(prepared, 0.005, 0.005)
    assert shapely.contains_xy(prepared, 10.5, 10.5)
    assert shapely.contains_xy(prepared, 20.5, 20.5)


def test_minor_islands_count_as_land():
    prepared = land(layer([square(10, 10, 1)], featurecla=["Land"]), layer([square(30, 5, 0.01)]))
    assert shapely.contains_xy(prepared, 30.005, 5.005)


def test_an_island_overlapping_land_does_not_cancel_it():
    coast = square(0, 0, 2)
    island = square(1.5, 0.5, 1)  # half on the coast, half at sea
    raw = shapely.MultiPolygon([coast, island])
    assert not even_odd(raw, 1.75, 1.0)  # covered twice: even-odd would read sea
    prepared = land(layer([coast], featurecla=["Land"]), layer([island]))
    assert even_odd(prepared, 1.75, 1.0)
    assert even_odd(prepared, 2.25, 1.0)


def test_a_bay_inside_a_lake_stays_water():
    # Lake Huron with Georgian Bay drawn again as its own feature over the lake's polygon.
    huron = square(-84.0, 43.0, 3.0)
    bay = square(-82.5, 44.7, 0.6)
    prepared = lakes(layer([huron, bay], featurecla=["Lake", "Lake"], ne_id=[1, 2]), WATER)
    assert not even_odd(shapely.MultiPolygon([huron, bay]), -82.2, 45.0)
    assert even_odd(prepared, -82.2, 45.0)
    assert even_odd(prepared, -83.0, 44.0)


def test_make_valid_keeps_a_self_intersecting_lakes_area():
    bowtie = shapely.Polygon([(0, 0), (2, 2), (2, 0), (0, 2)])  # two triangles of area 1
    assert not shapely.is_valid(bowtie)
    prepared = lakes(layer([bowtie], featurecla=["Lake"], ne_id=[1]), WATER)
    assert shapely.is_valid(prepared)
    assert shapely.area(prepared) == pytest.approx(2.0)


def test_lakes_keep_their_classes_and_allowlisted_reservoirs_only():
    features = layer(
        [square(0, 0, 1), square(2, 0, 1), square(4, 0, 1), square(6, 0, 1)],
        featurecla=["Lake", "Alkaline Lake", "Reservoir", "Reservoir"],
        ne_id=[1, 2, 42, 43],
    )
    prepared = lakes(features, WATER)
    inside = [bool(shapely.contains_xy(prepared, x + 0.5, 0.5)) for x in (0, 2, 4, 6)]
    assert inside == [True, True, True, False]


def test_rivers_keep_their_classes_and_scalerank_and_drop_canals():
    features = layer(
        [shapely.LineString([(0, 0), (1, 0)])] * 3,
        featurecla=["River", "Canal", "Lake Centerline"],
        scalerank=[3, 5, 7],
    )
    kept = rivers(features, WATER)
    assert kept.attrs["scalerank"].tolist() == [3, 7]
    assert kept.attrs["scalerank"].dtype == np.int64


def max_step(geom) -> float:
    """The largest change in lon or in lat between consecutive vertices, less rounding error."""
    steps = []
    for part in shapely.get_parts(geom):
        lines = [part]
        if shapely.get_type_id(part) == shapely.GeometryType.POLYGON:
            lines = [shapely.get_exterior_ring(part)] + [
                shapely.get_interior_ring(part, i)
                for i in range(shapely.get_num_interior_rings(part))
            ]
        for line in lines:
            steps.append(np.abs(np.diff(shapely.get_coordinates(line), axis=0)).max())
    return max(steps) - 1e-12


def test_every_prepared_segment_spans_at_most_a_tenth_of_a_degree():
    polygon = shapely.Polygon([(0, 0), (3, 0), (3, 2), (0, 2)], [[(1, 0.5), (2, 0.5), (2, 1.5)]])
    line = shapely.LineString([(10, 10), (12.5, 11.3)])
    assert max_step(land(layer([polygon], featurecla=["Land"]), None)) <= SEGMENT_DEG
    assert max_step(lakes(layer([polygon], featurecla=["Lake"], ne_id=[1]), WATER)) <= SEGMENT_DEG
    river = rivers(layer([line], featurecla=["River"], scalerank=[1]), WATER)
    assert max_step(river.geoms[0]) <= SEGMENT_DEG


def test_a_zipped_shapefile_reads_with_every_attribute(tmp_path):
    folder = tmp_path / "shp"
    folder.mkdir()
    geoms = shapely.to_wkb(np.array([square(0, 0, 1), square(5, 5, 1)]))
    pyogrio.raw.write(
        folder / "demo.shp",
        geoms,
        [np.array(["Lake", "Reservoir"], dtype=object), np.array([7, 42], dtype=np.int64)],
        ["featurecla", "ne_id"],
        crs="EPSG:4326",
        geometry_type="Polygon",
        driver="ESRI Shapefile",
    )
    with zipfile.ZipFile(tmp_path / "demo.zip", "w") as archive:
        for part in sorted(folder.iterdir()):
            archive.write(part, part.name)
    read = read_zip_layer(tmp_path / "demo.zip")
    assert read.attrs["featurecla"].tolist() == ["Lake", "Reservoir"]
    assert read.attrs["ne_id"].tolist() == [7, 42]
    assert shapely.equals(read.geoms[1], square(5, 5, 1))


def test_an_excerpt_layer_round_trips_with_its_attributes(tmp_path):
    written = layer(
        [square(0, 0, 1), shapely.LineString([(0, 0), (1, 1)])],
        featurecla=["Lake", None],
        ne_id=[1159123281, 2],
    )
    write_excerpt_layer(tmp_path, "demo", written, {"source": "demo"})
    read = read_excerpt_layer(tmp_path, "demo")
    assert read.attrs["featurecla"].tolist() == ["Lake", None]
    assert read.attrs["ne_id"].dtype == np.int64
    assert all(
        shapely.equals_exact(a, b, 0) for a, b in zip(read.geoms, written.geoms, strict=True)
    )
    first = (tmp_path / "demo.wkb.gz").read_bytes()
    write_excerpt_layer(tmp_path, "demo", written, {"source": "demo"})
    assert (tmp_path / "demo.wkb.gz").read_bytes() == first
    assert first[4:8] == b"\0\0\0\0"  # gzip mtime


def test_prepared_layers_survive_the_hand_off_to_workers():
    vectors = Vectors(
        land=square(0, 0, 1),
        lakes=shapely.MultiPolygon([square(0, 0, 0.2), square(0.5, 0.5, 0.2)]),
        rivers=Layer(
            np.array([shapely.LineString([(0, 0), (0.05, 0.05)])] * 2),
            {"scalerank": np.array([4, 12], dtype=np.int64)},
        ),
    )
    back = from_wkb(to_wkb(vectors))
    assert shapely.equals_exact(back.land, vectors.land, 0)
    assert shapely.equals_exact(back.lakes, vectors.lakes, 0)
    assert back.rivers.attrs["scalerank"].tolist() == [4, 12]
    assert len(back.rivers) == 2
