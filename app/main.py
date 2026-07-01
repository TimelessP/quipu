from __future__ import annotations

import base64
import secrets
import tempfile
import uuid
from pathlib import Path

import h3
import json
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import HttpUrl
from app.routers.google_auth import router as google_router

from app import config
from app.dependencies.auth import get_current_user
from app.models import (
    FavoritePortalItemDocument,
    ItemDocument,
    ItemType,
    MediaItemDocument,
    LockBoxItemDocument,
    PlaceFavoritePortalItemRequest,
    PlaceLockBoxItemRequest,
    PlaceItemRequest,
    PlaceMediaItemRequest,
    PlacePortalMarkerItemRequest,
    PlaceVisitCounterItemRequest,
    PortalMarkerItemDocument,
    RenamePortalRequest,
    VisitCounterItemDocument,
)
from app.spatial import haversine_meters
from typing import cast
import app.storage as storage_module

app = FastAPI(title="Quipu MVP", version="0.1.9", max_upload_size=20 * 1024 * 1024)  # Set limit to 20MB
ASSET_VERSION = "20260628-20"
app.include_router(google_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ALLOW_ORIGINS,
    allow_credentials=False,  # uses bearer token auth, so no cookies
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

storage = storage_module.FileStorage()
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

@app.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {"email": user["sub"], "name": user["name"]}

@app.get("/api/dimensions/default")
def get_default_dimension(user: dict = Depends(get_current_user)) -> dict[str, str]:
    return {"root_id": storage.get_default_dimension_root_id()}


@app.get("/api/items/{item_id}")
def get_item(item_id: str, user: dict = Depends(get_current_user)) -> dict:
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


def _create_item_from_request(
    root_id: str,
    request: PlaceItemRequest,
    user: dict,
    upload_path: str | None = None,
) -> ItemDocument:
    cell_id = h3.latlng_to_cell(request.latitude, request.longitude, config.H3_RESOLUTION)
    id_ = str(uuid.uuid4())
    owner_ = user["sub"]  # old untrusted way: str(request.owner)
    latitude_ = float(request.latitude)
    longitude_ = float(request.longitude)
    accuracy_meters_ = request.accuracy_meters
    dimension_root_id_ = root_id

    if isinstance(request, PlaceMediaItemRequest):
        content_upload_path = upload_path or request.content_upload_path
        if content_upload_path:
            _validate_upload_path(content_upload_path)
        if not (request.content_name or request.content_text or request.content_url or content_upload_path):
            raise HTTPException(status_code=400, detail="Media items need at least one content field")
        payload = {
            "id": id_,
            "type": ItemType.MEDIA,
            "owner": owner_,
            "latitude": latitude_,
            "longitude": longitude_,
            "accuracy_meters": accuracy_meters_,
            "dimension_root_id": dimension_root_id_,
            "content_name": request.content_name.strip() if request.content_name else None,
            "content_text": request.content_text,
            "content_url": request.content_url,
            "content_upload_path": content_upload_path,
        }
        item = MediaItemDocument.model_validate(payload)
    elif isinstance(request, PlaceVisitCounterItemRequest):
        payload = {
            "id": id_,
            "type": ItemType.VISIT_COUNTER,
            "owner": owner_,
            "latitude": latitude_,
            "longitude": longitude_,
            "accuracy_meters": accuracy_meters_,
            "dimension_root_id": dimension_root_id_,
            "visit_counter_name": request.visit_counter_name.strip() if request.visit_counter_name else None,
            "visit_count": 0,
        }
        item = VisitCounterItemDocument.model_validate(payload)
    elif isinstance(request, PlacePortalMarkerItemRequest):
        if upload_path:
            _validate_upload_path(upload_path)
        payload = {
            "id": id_,
            "type": ItemType.PORTAL_MARKER,
            "owner": owner_,
            "latitude": latitude_,
            "longitude": longitude_,
            "accuracy_meters": accuracy_meters_,
            "dimension_root_id": dimension_root_id_,
            "portal_name": request.portal_name.strip() if request.portal_name else None,
            "content_text": request.content_text.strip() if request.content_text and request.content_text.strip() else None,
            "content_url": request.content_url,
            "content_upload_path": upload_path,
        }
        item = PortalMarkerItemDocument.model_validate(payload)
    elif isinstance(request, PlaceFavoritePortalItemRequest):
        if not request.favorite_portal_id:
            raise HTTPException(status_code=400, detail="favorite_portal_id is required for favorite portal items")
        if request.favorite_portal_latitude is None or request.favorite_portal_longitude is None:
            raise HTTPException(status_code=400, detail="favorite portal coordinates are required for favorite portal items")
        content_upload_path = upload_path or request.content_upload_path
        if content_upload_path:
            _validate_upload_path(content_upload_path)
        payload = {
            "id": id_,
            "type": ItemType.FAVORITE_PORTAL_ITEM,
            "owner": owner_,
            "latitude": latitude_,
            "longitude": longitude_,
            "accuracy_meters": accuracy_meters_,
            "dimension_root_id": dimension_root_id_,
            "favorite_portal_id": request.favorite_portal_id,
            "favorite_portal_latitude": request.favorite_portal_latitude,
            "favorite_portal_longitude": request.favorite_portal_longitude,
            "favorite_portal_name": request.favorite_portal_name.strip() if request.favorite_portal_name else None,
            "content_name": request.content_name.strip() if request.content_name else None,
            "content_text": request.content_text,
            "content_url": request.content_url,
            "content_upload_path": content_upload_path,
        }
        item = FavoritePortalItemDocument.model_validate(payload)
    elif isinstance(request, PlaceLockBoxItemRequest):
        payload = {
            "id": id_,
            "type": ItemType.LOCK_BOX,
            "owner": owner_,
            "latitude": latitude_,
            "longitude": longitude_,
            "accuracy_meters": accuracy_meters_,
            "dimension_root_id": dimension_root_id_,
            "box_name": request.box_name.strip() if request.box_name else None,
            "box_description": request.box_description,
            "box_image": request.box_image,
            "box_url": request.box_url,
            "encrypted_contents": request.encrypted_contents or None,
        }
        item = LockBoxItemDocument.model_validate(payload)
    else:
        raise HTTPException(status_code=400, detail="Unsupported item type")

    storage.save_item(item)
    storage.add_item_to_cell(root_id=root_id, cell_id=cell_id, item_id=item.id)
    return item


@app.post("/api/dimensions/{root_id}/items")
def place_item(root_id: str, request: PlaceItemRequest, user: dict = Depends(get_current_user)) -> dict:
    _validate_accuracy(request.accuracy_meters)

    if request.type == ItemType.PORTAL_MARKER:
        _validate_portal_spacing(root_id, request.latitude, request.longitude)

    item = _create_item_from_request(root_id, request, user=user)
    return item.model_dump(mode="json")


@app.post("/api/dimensions/{root_id}/portals")
async def place_portal_multipart(
    root_id: str,
    latitude: float = Form(...),
    longitude: float = Form(...),
    accuracy_meters: float | None = Form(default=None),
    portal_name: str | None = Form(default=None),
    content_text: str | None = Form(default=None),
    content_url: HttpUrl | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    user: dict = Depends(get_current_user)
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
        owner=user["sub"],  # old untrusted way: owner
        latitude=latitude,
        longitude=longitude,
        accuracy_meters=accuracy_meters,
        portal_name=portal_name.strip() if portal_name else None,
        content_text=content_text,
        content_url=content_url,
    )

    item = _create_item_from_request(root_id, request, upload_path=upload_path, user=user)
    return item.model_dump(mode="json")


@app.delete("/api/dimensions/{root_id}/items/{item_id}")
def pick_up_item(
    root_id: str,
    item_id: str,
    actor_latitude: float | None = None,
    actor_longitude: float | None = None,
    user: dict = Depends(get_current_user)
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
def increment_visit_counter(root_id: str, item_id: str, user: dict = Depends(get_current_user)) -> dict:
    item = storage.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.dimension_root_id != root_id:
        raise HTTPException(status_code=403, detail="Item does not belong to this dimension")
    if item.type != ItemType.VISIT_COUNTER:
        raise HTTPException(status_code=400, detail="Only visit counters can be incremented")

    vc = cast(VisitCounterItemDocument, item)
    vc.visit_count += 1
    storage.save_item(vc)
    return vc.model_dump(mode="json")


@app.patch("/api/dimensions/{root_id}/items/{item_id}/portal-name")
def rename_portal(root_id: str, item_id: str, request: RenamePortalRequest, user: dict = Depends(get_current_user)) -> dict:
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

    portal = cast(PortalMarkerItemDocument, item)
    portal.portal_name = request.portal_name.strip()
    storage.save_item(portal)
    return portal.model_dump(mode="json")


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
    user: dict = Depends(get_current_user),
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

    portal = cast(PortalMarkerItemDocument, item)
    if portal_name is not None and portal_name.strip() != "":
        portal.portal_name = portal_name.strip()
    if content_text is not None:
        portal.content_text = content_text.strip() if content_text.strip() else None
    if should_clear_content_url:
        portal.content_url = None
    elif content_url is not None:
        portal.content_url = content_url

    if should_clear_content_upload:
        portal.content_upload_path = None

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
        portal.content_upload_path = upload_path

    storage.save_item(portal)
    return portal.model_dump(mode="json")


@app.patch("/api/dimensions/{root_id}/items/{item_id}/content")
async def update_world_item_content(
    root_id: str,
    item_id: str,
    actor_latitude: float = Form(...),
    actor_longitude: float = Form(...),
    content_name: str | None = Form(default=None),
    content_name_clear: str | None = Form(default=None),
    content_text: str | None = Form(default=None),
    content_text_clear: str | None = Form(default=None),
    content_url: HttpUrl | None = Form(default=None),
    content_url_clear: str | None = Form(default=None),
    content_upload_clear: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    user: dict = Depends(get_current_user),
) -> dict:
    item = storage.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.dimension_root_id != root_id:
        raise HTTPException(status_code=403, detail="Item does not belong to this dimension")
    if item.type not in {ItemType.MEDIA, ItemType.FAVORITE_PORTAL_ITEM}:
        raise HTTPException(status_code=400, detail="Only media/favourite world items can be edited in place")

    distance_to_item = haversine_meters(actor_latitude, actor_longitude, item.latitude, item.longitude)
    distance = distance_to_item
    if isinstance(item, FavoritePortalItemDocument) and item.favorite_portal_latitude is not None and item.favorite_portal_longitude is not None:
        distance_to_portal = haversine_meters(actor_latitude, actor_longitude, item.favorite_portal_latitude, item.favorite_portal_longitude)
        distance = min(distance_to_item, distance_to_portal)

    if distance > AREA_OF_EFFECT_RADIUS_METERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Item updates require physical presence within {AREA_OF_EFFECT_RADIUS_METERS}m "
                f"(current distance: {distance:.1f}m)."
            ),
        )

    should_clear_name = _parse_form_flag(content_name_clear)
    should_clear_text = _parse_form_flag(content_text_clear)
    should_clear_url = _parse_form_flag(content_url_clear)
    should_clear_upload = _parse_form_flag(content_upload_clear)

    has_name = content_name is not None or should_clear_name
    has_text = content_text is not None or should_clear_text
    has_url = content_url is not None or should_clear_url
    has_file = file is not None
    has_upload_clear = should_clear_upload

    if not (has_name or has_text or has_url or has_file or has_upload_clear):
        raise HTTPException(status_code=400, detail="Provide at least one content field to update")

    if content_name is not None and content_name.strip() == "" and not should_clear_name:
        raise HTTPException(status_code=400, detail="content_name cannot be blank when provided")

    if should_clear_name:
        # item may be MediaItemDocument or FavoritePortalItemDocument
        if item.type == ItemType.MEDIA:
            media = cast(MediaItemDocument, item)
            media.content_name = None
        else:
            fav = cast(FavoritePortalItemDocument, item)
            fav.content_name = None
    elif content_name is not None:
        if item.type == ItemType.MEDIA:
            media = cast(MediaItemDocument, item)
            media.content_name = content_name.strip() if content_name.strip() else None
        else:
            fav = cast(FavoritePortalItemDocument, item)
            fav.content_name = content_name.strip() if content_name.strip() else None

    if should_clear_text:
        if item.type == ItemType.MEDIA:
            cast(MediaItemDocument, item).content_text = None
        else:
            cast(FavoritePortalItemDocument, item).content_text = None
    elif content_text is not None:
        if item.type == ItemType.MEDIA:
            cast(MediaItemDocument, item).content_text = content_text.strip() if content_text.strip() else None
        else:
            cast(FavoritePortalItemDocument, item).content_text = content_text.strip() if content_text.strip() else None

    if should_clear_url:
        if item.type == ItemType.MEDIA:
            cast(MediaItemDocument, item).content_url = None
        else:
            cast(FavoritePortalItemDocument, item).content_url = None
    elif content_url is not None:
        if item.type == ItemType.MEDIA:
            cast(MediaItemDocument, item).content_url = content_url
        else:
            cast(FavoritePortalItemDocument, item).content_url = content_url

    if should_clear_upload:
        if item.type == ItemType.MEDIA:
            cast(MediaItemDocument, item).content_upload_path = None
        else:
            cast(FavoritePortalItemDocument, item).content_upload_path = None

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

        if item.type == ItemType.MEDIA:
            cast(MediaItemDocument, item).content_upload_path = upload_path
        else:
            cast(FavoritePortalItemDocument, item).content_upload_path = upload_path

    storage.save_item(item)
    return item.model_dump(mode="json")


@app.post("/api/dimensions/{root_id}/media")
@app.post("/api/dimensions/{root_id}/photos")
async def place_media(
    root_id: str,
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
    user: dict = Depends(get_current_user)
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
        payload = {
            "id": str(uuid.uuid4()),
            "type": item_type,
            "owner": user["sub"],
            "latitude": latitude,
            "longitude": longitude,
            "accuracy_meters": accuracy_meters,
            "content_name": content_name.strip() if content_name else None,
            "content_text": content_text,
            "content_url": content_url,
            "content_upload_path": upload_path,
            "dimension_root_id": root_id,
        }
        item = MediaItemDocument.model_validate(payload)
    else:
        payload = {
            "id": str(uuid.uuid4()),
            "type": item_type,
            "owner":  user["sub"],
            "latitude": latitude,
            "longitude": longitude,
            "accuracy_meters": accuracy_meters,
            "favorite_portal_id": favorite_portal_id,
            "favorite_portal_latitude": favorite_portal_latitude,
            "favorite_portal_longitude": favorite_portal_longitude,
            "favorite_portal_name": favorite_portal_name.strip() if favorite_portal_name else None,
            "content_name": content_name.strip() if content_name else None,
            "content_text": content_text,
            "content_url": content_url,
            "content_upload_path": upload_path,
            "dimension_root_id": root_id,
        }
        item = FavoritePortalItemDocument.model_validate(payload)

    storage.save_item(item)
    storage.add_item_to_cell(root_id=root_id, cell_id=cell_id, item_id=item.id)
    return item.model_dump(mode="json")


@app.get("/api/dimensions/{root_id}/cells/{cell_id}/item-ids")
def get_cell_item_ids(root_id: str, cell_id: str, user: dict = Depends(get_current_user)) -> dict:
    cell = storage.get_cell(root_id, cell_id)
    if cell is None:
        return {"item_ids": []}
    return {"item_ids": list(cell.get("item_ids", []))}


# Lock box contents are encrypted and decrypted entirely on the client. The
# client reads the opaque `encrypted_contents` blob via GET /api/items/{id} and
# writes it back through set-contents below. The server never sees the numeric
# code or the decrypted contents.
@app.post("/api/dimensions/{root_id}/items/{item_id}/set-contents")
def set_lock_box_contents(root_id: str, item_id: str, encrypted_contents: str = Form(...), user: dict = Depends(get_current_user)) -> dict:
    """
    Persist the provided encrypted payload for the lock box. The server does not accept or inspect plaintext contents or codes.
    Responsibility for validating ownership of moved items is on the client when constructing the encrypted payload.
    """
    item = storage.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.dimension_root_id != root_id:
        raise HTTPException(status_code=403, detail="Item does not belong to this dimension")
    if item.type != ItemType.LOCK_BOX:
        raise HTTPException(status_code=400, detail="Only lock boxes can have contents set")

    box = cast(LockBoxItemDocument, item)
    box.encrypted_contents = encrypted_contents or ""
    storage.save_item(box)
    return {"ok": True}


@app.patch("/api/dimensions/{root_id}/items/{item_id}/lockbox")
async def update_lock_box_metadata(
    root_id: str,
    item_id: str,
    actor_latitude: float = Form(...),
    actor_longitude: float = Form(...),
    box_name: str | None = Form(default=None),
    box_description: str | None = Form(default=None),
    box_image: str | None = Form(default=None),
    box_image_clear: str | None = Form(default=None),
    box_image_file: UploadFile | None = File(default=None),
    box_url: HttpUrl | None = Form(default=None),
    box_url_clear: str | None = Form(default=None),
    user: dict = Depends(get_current_user)
) -> dict:
    item = storage.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.dimension_root_id != root_id:
        raise HTTPException(status_code=403, detail="Item does not belong to this dimension")
    if item.type != ItemType.LOCK_BOX:
        raise HTTPException(status_code=400, detail="Only lock boxes can be updated with this endpoint")

    distance = haversine_meters(actor_latitude, actor_longitude, item.latitude, item.longitude)
    if distance > AREA_OF_EFFECT_RADIUS_METERS:
        raise HTTPException(status_code=400, detail=f"Lock box updates require presence within {AREA_OF_EFFECT_RADIUS_METERS}m")

    should_clear_image = _parse_form_flag(box_image_clear)
    should_clear_url = _parse_form_flag(box_url_clear)

    if box_name is not None and box_name.strip() == "":
        raise HTTPException(status_code=400, detail="box_name cannot be blank when provided")

    box = cast(LockBoxItemDocument, item)
    if box_name is not None:
        box.box_name = box_name.strip() if box_name.strip() else None
    if box_description is not None:
        box.box_description = box_description.strip() if box_description.strip() else None

    if should_clear_image:
        box.box_image = None
        box.box_image_upload_path = None
    elif box_image_file:
        suffix = Path(box_image_file.filename or "image.bin").suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
            content = await box_image_file.read()
            tmp.write(content)
        try:
            upload_path = storage.save_upload(tmp_path, box_image_file.filename or "image.bin")
            box.box_image_upload_path = upload_path
            box.box_image = None
        finally:
            if tmp_path.exists():
                tmp_path.unlink()
    elif box_image is not None:
        box.box_image = box_image

    if should_clear_url:
        box.box_url = None
    elif box_url is not None:
        box.box_url = box_url

    storage.save_item(box)
    return box.model_dump(mode="json")



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
    # The following parameters mean:
    # - Cache-Control:
    #   public: allow caching by any cache
    #   max-age=31536000: cache for 1 year
    #   immutable: the resource will never change, so caches can store it indefinitely
    CacheControlStaticFiles(directory=config.UPLOADS_DIR, cache_control="public, max-age=31536000, immutable"),
    name="uploads",
)

app.mount(
    "/static",
    # The following parameters mean:
    # - Cache-Control:
    #   public: allow caching by any cache
    #   max-age=31536000: cache for 1 year
    #   immutable: the resource will never change, so caches can store it indefinitely
    # These can only be cleared from server-side by changing the ASSET_VERSION in the HTML, which will cause clients to request new assets.
    # As such, we will need to have a specific route for the version, and that will expressly have a short cache period.
    CacheControlStaticFiles(directory="app/static", cache_control="public, max-age=31536000, immutable"),
    name="static",
)

# TODO: Consider using a more robust solution for cache-busting static assets, such as including a hash of the file contents in the filename or using a build tool to manage asset versioning.
@app.get("/manifest.json")
def get_manifest() -> JSONResponse:
    manifest = Path("app/static/manifest.json").read_text(encoding="utf-8").replace("__ASSET_VERSION__", ASSET_VERSION)
    # return json.loads(manifest)
    # shows the response with double quotes around it instead of json data.
    return JSONResponse(
        content=json.loads(manifest),
        # The following parameters mean:
        # - Cache-Control: public, max-age=5: cache for 5 seconds
        # - stale-while-revalidate=86400: allow serving stale content for 1 day while revalidating in the background
        headers={"Cache-Control": "public, max-age=5, stale-while-revalidate=86400"},
    )


@app.get("/version")
def get_version() -> JSONResponse:
    return JSONResponse(
        {"version": ASSET_VERSION},
        # The following parameters mean:
        # - Cache-Control: public, max-age=5: cache for 5 seconds
        # - stale-while-revalidate=86400: allow serving stale content for 1 day while revalidating in the background
        headers={"Cache-Control": "public, max-age=5, stale-while-revalidate=86400"},
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
        # The following parameters mean:
        # - Cache-Control: public, max-age=300: cache for 5 minutes
        # - stale-while-revalidate=86400: allow serving stale content for 1 day while revalidating in the background
        headers={"Cache-Control": "public, max-age=300, stale-while-revalidate=86400"},
    )
