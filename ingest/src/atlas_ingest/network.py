"""Per-site physical topology, read from the NetworkX-style JSON exports.

Referential integrity is checked here rather than deferred: an edge pointing at
a device that does not exist renders as a line to nowhere, and the old tool's
warn-and-continue posture is what let that ship.

Device `ip` is an opaque string. The source mixes bare addresses
("192.0.2.3") with CIDR ("198.51.100.65/29"), so nothing may parse it.
"""
import json
from pathlib import Path


class NetworkError(ValueError):
    """The topology file is internally inconsistent."""


def load_network(path, site_id):
    """-> {site_id, meta, zones, devices, edges}."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))

    graph = raw.get("graph", {})
    zones = raw.get("zones", {})
    devices = raw.get("nodes", [])
    edges = raw.get("edges", [])

    zone_ids = set(zones)
    device_ids = {d["id"] for d in devices}

    for d in devices:
        if d["zone"] not in zone_ids:
            raise NetworkError(
                f"{site_id}: device '{d['id']}' is in zone '{d['zone']}', "
                f"which is not declared in zones"
            )
    for e in edges:
        for end in ("source", "target"):
            if e[end] not in device_ids:
                raise NetworkError(
                    f"{site_id}: edge {e['source']}->{e['target']} references "
                    f"unknown device '{e[end]}'"
                )

    return {
        "site_id": site_id,
        "meta": {
            "label": graph.get("location") or graph.get("name") or site_id,
            "name": graph.get("name", ""),
            "description": graph.get("description", ""),
            "classification": graph.get("classification", ""),
            "version": graph.get("version", ""),
            "updated": graph.get("updated", ""),
            # Northgate only; Westfield omits both.
            "source_images": graph.get("source_images"),
            "visio_tabs": graph.get("visio_tabs", []),
            "device_count": len(devices),
            "edge_count": len(edges),
        },
        "zones": zones,
        "devices": devices,
        "edges": edges,
    }
