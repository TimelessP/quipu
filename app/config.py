from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.getenv("QUIPU_DATA_DIR", "./data")).resolve()
ITEMS_DIR = DATA_DIR / "items"
UPLOADS_DIR = DATA_DIR / "uploads"
CELLS_DIR = DATA_DIR / "cells"
META_FILE = DATA_DIR / "meta.json"

HOST = os.getenv("QUIPU_HOST", "0.0.0.0")
PORT = int(os.getenv("QUIPU_PORT", "8000"))

GPS_ACCURACY_THRESHOLD_METERS = float(os.getenv("QUIPU_GPS_ACCURACY_THRESHOLD_METERS", "50"))
AREA_OF_EFFECT_RADIUS_METERS = float(os.getenv("QUIPU_AREA_OF_EFFECT_RADIUS_METERS", "15"))
NEARBY_RADIUS_METERS = float(os.getenv("QUIPU_NEARBY_RADIUS_METERS", str(AREA_OF_EFFECT_RADIUS_METERS)))

# H3 resolution for global spatial indexing. 12 is a practical default for file-backed indices.
H3_RESOLUTION = int(os.getenv("QUIPU_H3_RESOLUTION", "12"))

_CORS_ALLOW_ORIGINS_RAW = os.getenv(
	"QUIPU_CORS_ALLOW_ORIGINS",
	"http://127.0.0.1:8000,http://localhost:8000,https://quipu.timelessprototype.com",
)
CORS_ALLOW_ORIGINS = [origin.strip() for origin in _CORS_ALLOW_ORIGINS_RAW.split(",") if origin.strip()]

CSP_REPORT_ONLY = os.getenv("QUIPU_CSP_REPORT_ONLY", "0").strip().lower() in {"1", "true", "yes", "on"}

_CSP_IMG_EXTRA_SOURCES_RAW = os.getenv(
	"QUIPU_CSP_IMG_EXTRA_SOURCES",
	"https://*.tile.openstreetmap.org",
)
CSP_IMG_EXTRA_SOURCES = [source.strip() for source in _CSP_IMG_EXTRA_SOURCES_RAW.split(",") if source.strip()]

_CSP_SCRIPT_HASHES_RAW = os.getenv(
	"QUIPU_CSP_SCRIPT_HASHES",
	"",
)
CSP_SCRIPT_HASHES = [hash_value.strip() for hash_value in _CSP_SCRIPT_HASHES_RAW.split(",") if hash_value.strip()]
