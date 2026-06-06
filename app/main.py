from __future__ import annotations

import base64
import secrets
import tempfile
import uuid
from pathlib import Path

import h3
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import HttpUrl

from app import config
from app.models import (
    FavoritePortalItemDocument,
    ItemDocument,
    ItemType,
    MediaItemDocument,
    PlaceFavoritePortalItemRequest,
    PlaceItemRequest,
    PlaceMediaItemRequest,
    PlacePortalMarkerItemRequest,
    PlaceVisitCounterItemRequest,
    PortalMarkerItemDocument,
    RenamePortalRequest,
    VisitCounterItemDocument,
)
from app.spatial import haversine_meters
from app.storage import FileStorage

app = FastAPI(title="Quipu MVP", version="0.1.0")
ASSET_VERSION = "20260606-06"

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_img_src_tokens = ["'self'", "data:", "blob:", *config.CSP_IMG_EXTRA_SOURCES]


def _normalize_csp_script_source(token: str) -> str:
    source = token.strip()
    if not source:
        return source
    if source.startswith("'") and source.endswith("'"):
        return source
    if source.startswith(("sha256-", "sha384-", "sha512-")):
        return f"'{source}'"
    return source


_script_src_tokens = ["'self'", *[_normalize_csp_script_source(token) for token in config.CSP_SCRIPT_HASHES]]

def _build_security_csp_policy(script_nonce: str | None = None) -> str:
    script_tokens = list(_script_src_tokens)
    if script_nonce:
        script_tokens.append(f"'nonce-{script_nonce}'")

    return "; ".join(
        [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            f"script-src {' '.join(script_tokens)}",
            "style-src 'self' 'unsafe-inline'",
            f"img-src {' '.join(_img_src_tokens)}",
            "font-src 'self' data:",
            "connect-src 'self'",
            "worker-src 'self' blob:",
            "manifest-src 'self'",
            "upgrade-insecure-requests",
        ]
    )


def _generate_csp_nonce() -> str:
    return base64.b64encode(secrets.token_bytes(16)).decode("ascii")


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    request.state.csp_nonce = _generate_csp_nonce()
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "geolocation=(self), camera=(), microphone=()")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    csp_policy = _build_security_csp_policy(getattr(request.state, "csp_nonce", None))
    csp_header_name = "Content-Security-Policy-Report-Only" if config.CSP_REPORT_ONLY else "Content-Security-Policy"
    response.headers.setdefault(csp_header_name, csp_policy)
    return response

storage = FileStorage()
MIN_PORTAL_SPACING_METERS = 8
AREA_OF_EFFECT_RADIUS_METERS = config.AREA_OF_EFFECT_RADIUS_METERS
PORTAL_NAME_RANGE_METERS = AREA_OF_EFFECT_RADIUS_METERS
PORTAL_INTERACTION_RANGE_METERS = PORTAL_NAME_RANGE_METERS
PORTAL_REMOVE_RANGE_METERS = PORTAL_INTERACTION_RANGE_METERS


def _validate_accuracy(accuracy: float | None) -> None:
    if accuracy is None:
        return
    if accuracy > config.GPS_ACCURACY_THRESHOLD_METERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"GPS accuracy {accuracy:.1f}m exceeds threshold "
                f"{config.GPS_ACCURACY_THRESHOLD_METERS:.1f}m"
            ),
        )


def _parse_form_flag(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "t", "yes", "y", "on"}


def _validate_portal_spacing(root_id: str, latitude: float, longitude: float) -> None:
    # Bounded cell ring lookup — never a global scan.
    # At H3 res 12 (edge ~9.4 m, inradius ~8.1 m) k=2 covers every point within
    # MIN_PORTAL_SPACING_METERS of any location inside the center cell.
    center_cell = h3.latlng_to_cell(latitude, longitude, config.H3_RESOLUTION)
    candidate_cells = h3.grid_disk(center_cell, 2)
    seen: set[str] = set()
    for cell in candidate_cells:
        cell_data = storage.get_cell(root_id, cell)
        if not cell_data:
            continue
        for item_id in cell_data.get("item_ids", []):
            if item_id in seen:
                continue
            seen.add(item_id)
            item = storage.get_item(item_id)
            if item is None or item.type != ItemType.PORTAL_MARKER:
                continue
            distance = haversine_meters(latitude, longitude, item.latitude, item.longitude)
            if distance < MIN_PORTAL_SPACING_METERS:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Portal too close to existing portal ({distance:.1f}m). "
                        f"Minimum spacing is {MIN_PORTAL_SPACING_METERS}m."
                    ),
                )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/dimensions/default")
def get_default_dimension() -> dict[str, str]:
    return {"root_id": storage.get_default_dimension_root_id()}


@app.get("/api/items/{item_id}")
def get_item(item_id: str) -> dict:
    item = storage.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item.model_dump(mode="json")


def _validate_upload_path(upload_path: str) -> None:
    if not upload_path.startswith("/uploads/"):
        raise HTTPException(status_code=400, detail="Invalid upload path")
    filename = upload_path[len("/uploads/"):]
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid upload path")
    if not (config.UPLOADS_DIR / filename).exists():
        raise HTTPException(status_code=400, detail="Upload file not found")


def _create_item_from_request(root_id: str, request: PlaceItemRequest, upload_path: str | None = None) -> ItemDocument:
    cell_id = h3.latlng_to_cell(request.latitude, request.longitude, config.H3_RESOLUTION)
    common_kwargs = dict(
        id=str(uuid.uuid4()),
        owner=request.owner,
        latitude=request.latitude,
        longitude=request.longitude,
        accuracy_meters=request.accuracy_meters,
        dimension_root_id=root_id,
    )

    if isinstance(request, PlaceMediaItemRequest):
        content_upload_path = upload_path or request.content_upload_path
        if content_upload_path:
            _validate_upload_path(content_upload_path)
        if not (request.content_name or request.content_text or request.content_url or content_upload_path):
            raise HTTPException(status_code=400, detail="Media items need at least one content field")
        item = MediaItemDocument(
            type=ItemType.MEDIA,
            content_name=request.content_name.strip() if request.content_name else None,
            content_text=request.content_text,
            content_url=request.content_url,
            content_upload_path=content_upload_path,
            **common_kwargs,
        )
    elif isinstance(request, PlaceVisitCounterItemRequest):
        item = VisitCounterItemDocument(
            type=ItemType.VISIT_COUNTER,
            visit_counter_name=request.visit_counter_name.strip() if request.visit_counter_name else None,
            visit_count=0,
            **common_kwargs,
        )
    elif isinstance(request, PlacePortalMarkerItemRequest):
        if upload_path:
            _validate_upload_path(upload_path)
        item = PortalMarkerItemDocument(
            type=ItemType.PORTAL_MARKER,
            portal_name=request.portal_name.strip() if request.portal_name else None,
            content_text=request.content_text.strip() if request.content_text and request.content_text.strip() else None,
            content_url=request.content_url,
            content_upload_path=upload_path,
            **common_kwargs,
        )
    elif isinstance(request, PlaceFavoritePortalItemRequest):
        if not request.favorite_portal_id:
            raise HTTPException(status_code=400, detail="favorite_portal_id is required for favorite portal items")
        if request.favorite_portal_latitude is None or request.favorite_portal_longitude is None:
            raise HTTPException(status_code=400, detail="favorite portal coordinates are required for favorite portal items")
        content_upload_path = upload_path or request.content_upload_path
        if content_upload_path:
            _validate_upload_path(content_upload_path)
        item = FavoritePortalItemDocument(
            type=ItemType.FAVORITE_PORTAL_ITEM,
            favorite_portal_id=request.favorite_portal_id,
            favorite_portal_latitude=request.favorite_portal_latitude,
            favorite_portal_longitude=request.favorite_portal_longitude,
            favorite_portal_name=request.favorite_portal_name.strip() if request.favorite_portal_name else None,
            content_name=request.content_name.strip() if request.content_name else None,
            content_text=request.content_text,
            content_url=request.content_url,
            content_upload_path=content_upload_path,
            **common_kwargs,
        )
    else:
        raise HTTPException(status_code=400, detail="Unsupported item type")

    storage.save_item(item)
    storage.add_item_to_cell(root_id=root_id, cell_id=cell_id, item_id=item.id)
    return item


@app.post("/api/dimensions/{root_id}/items")
def place_item(root_id: str, request: PlaceItemRequest) -> dict:
    _validate_accuracy(request.accuracy_meters)

    if request.type == ItemType.PORTAL_MARKER:
        _validate_portal_spacing(root_id, request.latitude, request.longitude)

    item = _create_item_from_request(root_id, request)
    return item.model_dump(mode="json")


@app.post("/api/dimensions/{root_id}/portals")
async def place_portal_multipart(
    root_id: str,
    owner: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    accuracy_meters: float | None = Form(default=None),
    portal_name: str | None = Form(default=None),
    content_text: str | None = Form(default=None),
    content_url: HttpUrl | None = Form(default=None),
    file: UploadFile | None = File(default=None),
) -> dict:
    _validate_accuracy(accuracy_meters)
    _validate_portal_spacing(root_id, latitude, longitude)

    upload_path = None
    if file is not None:
        suffix = Path(file.filename or "upload.bin").suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
            content = await file.read()
            tmp.write(content)

        try:
            upload_path = storage.save_upload(tmp_path, file.filename or "upload.bin")
        finally:
            if tmp_path.exists():
                tmp_path.unlink()

    request = PlacePortalMarkerItemRequest(
        type=ItemType.PORTAL_MARKER,
        owner=owner,
        latitude=latitude,
        longitude=longitude,
        accuracy_meters=accuracy_meters,
        portal_name=portal_name.strip() if portal_name else None,
        content_text=content_text,
        content_url=content_url,
    )

    item = _create_item_from_request(root_id, request, upload_path=upload_path)
    return item.model_dump(mode="json")


@app.delete("/api/dimensions/{root_id}/items/{item_id}")
def pick_up_item(
    root_id: str,
    item_id: str,
    actor_latitude: float | None = None,
    actor_longitude: float | None = None,
) -> dict:
    """Remove an item from the world.

    Portal markers may only be removed when the actor is physically at that portal.
    """
    item = storage.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.dimension_root_id != root_id:
        raise HTTPException(status_code=403, detail="Item does not belong to this dimension")
    if item.type == ItemType.PORTAL_MARKER:
        if actor_latitude is None or actor_longitude is None:
            raise HTTPException(
                status_code=400,
                detail="actor_latitude and actor_longitude are required to remove portal markers",
            )
        distance = haversine_meters(actor_latitude, actor_longitude, item.latitude, item.longitude)
        if distance > PORTAL_REMOVE_RANGE_METERS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Portal removal requires physical presence within {PORTAL_REMOVE_RANGE_METERS}m "
                    f"(current distance: {distance:.1f}m)."
                ),
            )

    cell_id = h3.latlng_to_cell(item.latitude, item.longitude, config.H3_RESOLUTION)
    storage.remove_item_from_cell(root_id=root_id, cell_id=cell_id, item_id=item_id)
    storage.delete_item(item_id)

    return {"deleted": item_id}


@app.post("/api/dimensions/{root_id}/items/{item_id}/visit-counter")
def increment_visit_counter(root_id: str, item_id: str) -> dict:
    item = storage.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.dimension_root_id != root_id:
        raise HTTPException(status_code=403, detail="Item does not belong to this dimension")
    if item.type != ItemType.VISIT_COUNTER:
        raise HTTPException(status_code=400, detail="Only visit counters can be incremented")

    item.visit_count += 1
    storage.save_item(item)
    return item.model_dump(mode="json")


@app.patch("/api/dimensions/{root_id}/items/{item_id}/portal-name")
def rename_portal(root_id: str, item_id: str, request: RenamePortalRequest) -> dict:
    item = storage.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.dimension_root_id != root_id:
        raise HTTPException(status_code=403, detail="Item does not belong to this dimension")
    if item.type != ItemType.PORTAL_MARKER:
        raise HTTPException(status_code=400, detail="Only portal markers can be renamed")

    distance = haversine_meters(request.actor_latitude, request.actor_longitude, item.latitude, item.longitude)
    if distance > PORTAL_NAME_RANGE_METERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Portal naming requires physical presence within {PORTAL_NAME_RANGE_METERS}m "
                f"(current distance: {distance:.1f}m)."
            ),
        )

    item.portal_name = request.portal_name.strip()
    storage.save_item(item)
    return item.model_dump(mode="json")


@app.patch("/api/dimensions/{root_id}/items/{item_id}/portal-details")
async def update_portal_details(
    root_id: str,
    item_id: str,
    actor_latitude: float = Form(...),
    actor_longitude: float = Form(...),
    portal_name: str | None = Form(default=None),
    content_text: str | None = Form(default=None),
    content_url: HttpUrl | None = Form(default=None),
    content_url_clear: str | None = Form(default=None),
    content_upload_clear: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
) -> dict:
    item = storage.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.dimension_root_id != root_id:
        raise HTTPException(status_code=403, detail="Item does not belong to this dimension")
    if item.type != ItemType.PORTAL_MARKER:
        raise HTTPException(status_code=400, detail="Only portal markers can be updated from Portal modal")

    distance = haversine_meters(actor_latitude, actor_longitude, item.latitude, item.longitude)
    if distance > PORTAL_NAME_RANGE_METERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Portal updates require physical presence within {PORTAL_NAME_RANGE_METERS}m "
                f"(current distance: {distance:.1f}m)."
            ),
        )

    should_clear_content_url = _parse_form_flag(content_url_clear)
    should_clear_content_upload = _parse_form_flag(content_upload_clear)

    has_portal_name = portal_name is not None and portal_name.strip() != ""
    has_content_text = content_text is not None and content_text.strip() != ""
    has_content_url = content_url is not None or should_clear_content_url
    has_file = file is not None
    has_content_upload_clear = should_clear_content_upload

    if not (has_portal_name or has_content_text or has_content_url or has_file or has_content_upload_clear):
        raise HTTPException(status_code=400, detail="Provide at least one portal field to update")

    if portal_name is not None and portal_name.strip() == "":
        raise HTTPException(status_code=400, detail="portal_name cannot be blank when provided")

    if portal_name is not None and portal_name.strip() != "":
        item.portal_name = portal_name.strip()
    if content_text is not None:
        item.content_text = content_text.strip() if content_text.strip() else None
    if should_clear_content_url:
        item.content_url = None
    elif content_url is not None:
        item.content_url = content_url

    if should_clear_content_upload:
        item.content_upload_path = None

    if file is not None:
        suffix = Path(file.filename or "upload.bin").suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
            content = await file.read()
            tmp.write(content)

        try:
            upload_path = storage.save_upload(tmp_path, file.filename or "upload.bin")
        finally:
            if tmp_path.exists():
                tmp_path.unlink()
        item.content_upload_path = upload_path

    storage.save_item(item)
    return item.model_dump(mode="json")


@app.post("/api/dimensions/{root_id}/media")
@app.post("/api/dimensions/{root_id}/photos")
async def place_media(
    root_id: str,
    owner: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    accuracy_meters: float | None = Form(default=None),
    item_type: ItemType = Form(default=ItemType.MEDIA),
    content_name: str | None = Form(default=None),
    content_text: str | None = Form(default=None),
    content_url: HttpUrl | None = Form(default=None),
    favorite_portal_id: str | None = Form(default=None),
    favorite_portal_latitude: float | None = Form(default=None),
    favorite_portal_longitude: float | None = Form(default=None),
    favorite_portal_name: str | None = Form(default=None),
    file: UploadFile = File(...),
) -> dict:
    _validate_accuracy(accuracy_meters)

    if item_type not in (ItemType.MEDIA, ItemType.FAVORITE_PORTAL_ITEM):
        raise HTTPException(status_code=400, detail="Multipart upload only supports media and favorite portal items")
    if item_type == ItemType.FAVORITE_PORTAL_ITEM:
        if not favorite_portal_id:
            raise HTTPException(status_code=400, detail="favorite_portal_id is required for favorite portal items")
        if favorite_portal_latitude is None or favorite_portal_longitude is None:
            raise HTTPException(status_code=400, detail="favorite portal coordinates are required for favorite portal items")

    cell_id = h3.latlng_to_cell(latitude, longitude, config.H3_RESOLUTION)

    suffix = Path(file.filename or "upload.bin").suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = Path(tmp.name)
        content = await file.read()
        tmp.write(content)

    try:
        upload_path = storage.save_upload(tmp_path, file.filename or "upload.bin")
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    if item_type == ItemType.MEDIA:
        item = MediaItemDocument(
            id=str(uuid.uuid4()),
            type=item_type,
            owner=owner,
            latitude=latitude,
            longitude=longitude,
            accuracy_meters=accuracy_meters,
            content_name=content_name.strip() if content_name else None,
            content_text=content_text,
            content_url=content_url,
            content_upload_path=upload_path,
            dimension_root_id=root_id,
        )
    else:
        item = FavoritePortalItemDocument(
            id=str(uuid.uuid4()),
            type=item_type,
            owner=owner,
            latitude=latitude,
            longitude=longitude,
            accuracy_meters=accuracy_meters,
            favorite_portal_id=favorite_portal_id,
            favorite_portal_latitude=favorite_portal_latitude,
            favorite_portal_longitude=favorite_portal_longitude,
            favorite_portal_name=favorite_portal_name.strip() if favorite_portal_name else None,
            content_name=content_name.strip() if content_name else None,
            content_text=content_text,
            content_url=content_url,
            content_upload_path=upload_path,
            dimension_root_id=root_id,
        )

    storage.save_item(item)
    storage.add_item_to_cell(root_id=root_id, cell_id=cell_id, item_id=item.id)
    return item.model_dump(mode="json")


@app.get("/api/dimensions/{root_id}/cells/{cell_id}/item-ids")
def get_cell_item_ids(root_id: str, cell_id: str) -> dict:
    cell = storage.get_cell(root_id, cell_id)
    if cell is None:
        return {"item_ids": []}
    return {"item_ids": list(cell.get("item_ids", []))}



class CacheControlStaticFiles(StaticFiles):
    def __init__(self, *args, cache_control: str, **kwargs):
        super().__init__(*args, **kwargs)
        self.cache_control = cache_control

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers.setdefault("Cache-Control", self.cache_control)
        return response


app.mount(
    "/uploads",
    CacheControlStaticFiles(directory=config.UPLOADS_DIR, cache_control="public, max-age=31536000, immutable"),
    name="uploads",
)
app.mount(
    "/static",
    CacheControlStaticFiles(directory="app/static", cache_control="public, max-age=31536000, immutable"),
    name="static",
)


@app.get("/")
def index(request: Request) -> HTMLResponse:
    csp_nonce = getattr(request.state, "csp_nonce", "")
    html = (
        Path("app/static/index.html")
        .read_text(encoding="utf-8")
        .replace("__ASSET_VERSION__", ASSET_VERSION)
        .replace("__CSP_NONCE__", csp_nonce)
    )
    return HTMLResponse(
        html,
        headers={"Cache-Control": "public, max-age=300, stale-while-revalidate=86400"},
    )
