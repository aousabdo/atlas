import pytest

from atlas_ingest.network import NetworkError, load_network


@pytest.fixture(scope="module")
def northgate(networks):
    return networks["northgate"]


@pytest.fixture(scope="module")
def westfield(networks):
    return networks["westfield"]


def test_northgate_shape(northgate):
    assert len(northgate["zones"]) == 14
    assert len(northgate["devices"]) == 71
    assert len(northgate["edges"]) == 86


def test_westfield_shape(westfield):
    assert len(westfield["zones"]) == 2
    assert len(westfield["devices"]) == 8
    assert len(westfield["edges"]) == 8


def test_classification_is_carried_through(northgate, westfield):
    """The marking is on both files and the old tool never displayed it. It
    must reach the UI here."""
    assert northgate["meta"]["classification"] == "UNCLASSIFIED//SAMPLE"
    assert westfield["meta"]["classification"] == "UNCLASSIFIED//SAMPLE"


def test_optional_graph_metadata_is_absent_at_westfield(westfield, northgate):
    assert northgate["meta"].get("visio_tabs")
    assert westfield["meta"].get("visio_tabs") in (None, [])


def test_every_device_zone_exists_in_zones(northgate, westfield):
    for net in (northgate, westfield):
        zone_ids = set(net["zones"])
        for d in net["devices"]:
            assert d["zone"] in zone_ids


def test_every_edge_endpoint_is_a_known_device(northgate, westfield):
    for net in (northgate, westfield):
        ids = {d["id"] for d in net["devices"]}
        for e in net["edges"]:
            assert e["source"] in ids
            assert e["target"] in ids


def test_the_loader_hands_back_device_addressing_byte_for_byte(tmp_path):
    """`ip` is opaque: the loader must not parse, normalise or reformat it.

    This replaces a test that read the fixture's devices and asserted each
    `ip` was a string or None. load_network passes nodes straight through, so
    that assertion held for whatever the fixture happened to contain and would
    have held just as well against an empty device list. It was a property of
    the fixture, not of any code, and a loader that started parsing addresses
    would not have troubled it.

    Stated against the loader, on values chosen because parsing would visibly
    damage them: a CIDR block loses its prefix length, a range or a
    non-address note becomes unrepresentable, and an empty string becomes None
    under any "clean it up" pass. The UI prints these verbatim, so any of those
    is a silent change to what an operator reads.
    """
    import json

    quirky = [
        ("bare", "192.0.2.11"),
        ("cidr", "198.51.100.64/29"),
        ("range", "203.0.113.10-203.0.113.20"),
        ("note", "DHCP, see site records"),
        ("blank", ""),
        ("padded", "  192.0.2.12  "),
        ("absent", None),
    ]
    net = {
        "graph": {},
        "zones": {"z": {"label": "Z"}},
        "nodes": [{"id": did, "label": did.upper(), "zone": "z", "type": "server",
                   "ip": value, "subnet": None, "description": None}
                  for did, value in quirky],
        "edges": [],
    }
    path = tmp_path / "addressing.json"
    path.write_text(json.dumps(net), encoding="utf-8")

    devices = {d["id"]: d["ip"] for d in load_network(path, site_id="s")["devices"]}
    assert devices == dict(quirky)


def test_a_null_description_survives_the_loader(tmp_path):
    """A device with no description has to come back as None rather than "" or
    a placeholder string: the UI renders a blank cell for one and prints the
    other as if it were content.

    This used to assert that some Westfield device had a null description.
    That is a fact about one topology file rather than about the loader, it is
    not true of the generated sample, and the test skipped everywhere so
    nothing found out. Stated against the loader it holds for any input.
    """
    import json

    net = {"graph": {}, "zones": {"z": {"label": "Z"}},
           "nodes": [{"id": "a", "label": "A", "zone": "z", "type": "server",
                      "ip": None, "subnet": None, "description": None}],
           "edges": []}
    path = tmp_path / "nulldesc.json"
    path.write_text(json.dumps(net), encoding="utf-8")

    loaded = load_network(path, site_id="s")
    assert loaded["devices"][0]["description"] is None


def test_a_dangling_edge_is_fatal(tmp_path):
    import json

    bad = {"graph": {"name": "x", "classification": "TEST"},
           "zones": {"z": {"label": "Z"}},
           "nodes": [{"id": "a", "label": "A", "zone": "z", "type": "server",
                      "ip": None, "subnet": None, "description": None}],
           "edges": [{"source": "a", "target": "ghost", "link_type": "ethernet",
                      "label": None}]}
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(bad), encoding="utf-8")

    with pytest.raises(NetworkError, match="ghost"):
        load_network(path, site_id="bad")


def test_a_device_in_an_undeclared_zone_is_fatal(tmp_path):
    import json

    bad = {"graph": {}, "zones": {"z": {"label": "Z"}},
           "nodes": [{"id": "a", "label": "A", "zone": "nosuchzone", "type": "server",
                      "ip": None, "subnet": None, "description": None}],
           "edges": []}
    path = tmp_path / "badzone.json"
    path.write_text(json.dumps(bad), encoding="utf-8")

    with pytest.raises(NetworkError, match="nosuchzone"):
        load_network(path, site_id="bad")
