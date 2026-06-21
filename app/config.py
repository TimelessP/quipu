from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

IS_PRODUCTION: bool = os.getenv("ENV", "development").strip().lower() == "production"

GOOGLE_CLIENT_ID     = os.getenv("OIDC_GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("OIDC_GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI  = os.getenv("OIDC_GOOGLE_REDIRECT_URI")  # differs per env
APP_SECRET_KEY: str  = os.getenv("APP_SECRET_KEY", "")        # for your own JWTs
if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI and APP_SECRET_KEY):
    raise ValueError("Missing required environment variables: OIDC_GOOGLE_CLIENT_ID, OIDC_GOOGLE_CLIENT_SECRET, OIDC_GOOGLE_REDIRECT_URI, APP_SECRET_KEY")

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
