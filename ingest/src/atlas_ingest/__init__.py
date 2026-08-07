"""ATLAS ingest: read the Traceability Matrix and emit the JSON bundles the app reads.

The classification logic here is lifted from the previous generator,
build_cuas_tool_v4.py, which produced a single HTML file. Only the front half
moved: reading, classifying and validating. The HTML generation has no
successor.
"""

__version__ = "0.1.0"
