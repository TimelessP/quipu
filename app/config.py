from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.getenv("QUIPU_DATA_DIR", "./data")).resolve()
NODES_DIR = DATA_DIR / "nodes"
ITEMS_DIR = DATA_DIR / "items"
UPLOADS_DIR = DATA_DIR / "uploads"
CELLS_DIR = DATA_DIR / "cells"
META_FILE = DATA_DIR / "meta.json"

HOST = os.getenv("QUIPU_HOST", "0.0.0.0")
PORT = int(os.getenv("QUIPU_PORT", "8000"))

TREE_DEPTH = int(os.getenv("QUIPU_TREE_DEPTH", "25"))
GPS_ACCURACY_THRESHOLD_METERS = float(os.getenv("QUIPU_GPS_ACCURACY_THRESHOLD_METERS", "50"))
NEARBY_RADIUS_METERS = float(os.getenv("QUIPU_NEARBY_RADIUS_METERS", "30"))

# H3 resolution for global spatial indexing. 12 is a practical default for file-backed indices.
H3_RESOLUTION = int(os.getenv("QUIPU_H3_RESOLUTION", "12"))

# Maximum number of H3 cells a single bbox query may cover. Guards against global-size fans.
# At res 12 (~0.31 km² / cell) this allows roughly 150 km² before rejecting the request.
MAX_BBOX_CELLS = int(os.getenv("QUIPU_MAX_BBOX_CELLS", "500"))
