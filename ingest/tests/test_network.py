import pytest

from atlas_ingest.network import NetworkError, load_network

from conftest import NETWORK_JSON, _require


@pytest.fixture(scope="module")
def northgate():
    return load_network(_require(NETWORK_JSON["northgate"]), site_id="northgate")


@pytest.fixture(scope="module")
def westfield():
    return load_network(_require(NETWORK_JSON["westfield"]), site_id="westfield")


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


def test_device_ip_is_an_opaque_string_or_null(northgate):
    """Values mix bare addresses and CIDR. Never parse these as plain IPs."""
    for d in northgate["devices"]:
        assert d["ip"] is None or isinstance(d["ip"], str)


def test_nullable_description_survives(westfield):
    assert any(d["description"] is None for d in westfield["devices"])


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
