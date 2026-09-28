import tomllib

import pytest

from prebuild.wikidata import (
    QUERY,
    WikidataError,
    check_unpinned,
    class_query,
    pin,
    source_entry,
)

OTHERS = """# GEBCO, as pinned.
[gebco-2026]
name = "GEBCO"

[[gebco-2026.files]]
path = "sources/gebco-2026/GEBCO_2026.zip"
"""
OLD = """# An earlier export.
[wikidata-events-20260101]
name = "old"

[[wikidata-events-20260101.files]]
path = "sources/wikidata-events-20260101/events.tsv.gz"
"""


def test_the_query_asks_for_one_class_with_its_subclasses():
    query = class_query(QUERY.read_text(encoding="utf-8"), "Q8068")
    assert "VALUES ?class { wd:Q8068 }" in query
    assert "wd:Q178561" not in query


def test_an_export_is_appended_after_every_other_source():
    entry = source_entry("wikidata-events-20260927", "2026-09-27T20:00:00Z", "index", {"x": b"1"})
    pinned = tomllib.loads(pin(OTHERS, entry))
    assert list(pinned) == ["gebco-2026", "wikidata-events-20260927"]
    assert pinned["wikidata-events-20260927"]["files"][0]["bytes"] == 1
    assert "source_url" not in pinned["wikidata-events-20260927"]["files"][0]


def test_an_export_waits_until_the_last_is_unpinned_by_hand():
    with pytest.raises(WikidataError, match="wikidata-events-20260101"):
        check_unpinned(OTHERS + "\n" + OLD)
