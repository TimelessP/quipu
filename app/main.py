from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

import h3
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import HttpUrl

from app import config
from app.models import ItemDocument, ItemType, PlaceItemRequest, RenamePortalRequest
from app.spatial import haversine_meters
from app.storage import FileStorage

app = FastAPI(title="Quipu MVP", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

storage = FileStorage()
MIN_PORTAL_SPACING_METERS = 8
PORTAL_REMOVE_RANGE_METERS = 8
PORTAL_NAME_RANGE_METERS = 30


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


@app.post("/api/dimensions/{root_id}/items")
def place_item(root_id: str, request: PlaceItemRequest) -> dict:
    _validate_accuracy(request.accuracy_meters)

    portal_name = request.portal_name.strip() if request.portal_name else None
    favorite_portal_name = request.favorite_portal_name.strip() if request.favorite_portal_name else None

    if request.type == ItemType.LETTER and not request.content_text and not request.content_url:
        raise HTTPException(status_code=400, detail="content_text or content_url is required for letter items")
    if request.type == ItemType.PORTAL_MARKER and (request.content_text or request.content_url or request.content_upload_path):
        raise HTTPException(status_code=400, detail="portal_marker cannot include content content")
    if request.type != ItemType.PORTAL_MARKER and request.portal_name:
        raise HTTPException(status_code=400, detail="portal_name is only allowed for portal markers")
    if request.type == ItemType.FAVORITE_PORTAL_ITEM:
        if not request.favorite_portal_id:
            raise HTTPException(status_code=400, detail="favorite_portal_id is required for favorite portal items")
        if request.favorite_portal_latitude is None or request.favorite_portal_longitude is None:
            raise HTTPException(status_code=400, detail="favorite portal coordinates are required for favorite portal items")
    if request.type == ItemType.PHOTOGRAPH and not request.content_upload_path:
        raise HTTPException(status_code=400, detail="content_upload_path required for photograph placement")
    if request.type in (ItemType.PHOTOGRAPH, ItemType.FAVORITE_PORTAL_ITEM) and request.content_upload_path:
        # Validate path is safe — must reference an existing upload, no traversal
        if not request.content_upload_path.startswith("/uploads/"):
            raise HTTPException(status_code=400, detail="Invalid upload path")
        filename = request.content_upload_path[len("/uploads/"):]
        if "/" in filename or ".." in filename:
            raise HTTPException(status_code=400, detail="Invalid upload path")
        if not (config.UPLOADS_DIR / filename).exists():
            raise HTTPException(status_code=400, detail="Upload file not found")

    if request.type == ItemType.PORTAL_MARKER:
        _validate_portal_spacing(root_id, request.latitude, request.longitude)

    cell_id = h3.latlng_to_cell(request.latitude, request.longitude, config.H3_RESOLUTION)

    item = ItemDocument(
        id=str(uuid.uuid4()),
        type=request.type,
        owner=request.owner,
        latitude=request.latitude,
        longitude=request.longitude,
        accuracy_meters=request.accuracy_meters,
        portal_name=portal_name if request.type == ItemType.PORTAL_MARKER else None,
        favorite_portal_id=request.favorite_portal_id if request.type == ItemType.FAVORITE_PORTAL_ITEM else None,
        favorite_portal_latitude=request.favorite_portal_latitude if request.type == ItemType.FAVORITE_PORTAL_ITEM else None,
        favorite_portal_longitude=request.favorite_portal_longitude if request.type == ItemType.FAVORITE_PORTAL_ITEM else None,
        favorite_portal_name=favorite_portal_name if request.type == ItemType.FAVORITE_PORTAL_ITEM else None,
        content_text=request.content_text,
        content_url=request.content_url,
        content_upload_path=request.content_upload_path,
        dimension_root_id=root_id,
    )
    storage.save_item(item)
    storage.add_item_to_cell(root_id=root_id, cell_id=cell_id, item_id=item.id)
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

    has_portal_name = portal_name is not None and portal_name.strip() != ""
    has_content_text = content_text is not None and content_text.strip() != ""
    has_content_url = content_url is not None
    has_file = file is not None

    if not (has_portal_name or has_content_text or has_content_url or has_file):
        raise HTTPException(status_code=400, detail="Provide at least one portal field to update")

    if portal_name is not None and portal_name.strip() == "":
        raise HTTPException(status_code=400, detail="portal_name cannot be blank when provided")

    if portal_name is not None and portal_name.strip() != "":
        item.portal_name = portal_name.strip()
    if content_text is not None:
        item.content_text = content_text.strip() if content_text.strip() else None
    if content_url is not None:
        item.content_url = content_url

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


@app.post("/api/dimensions/{root_id}/photos")
async def place_photo(
    root_id: str,
    owner: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    accuracy_meters: float | None = Form(default=None),
    item_type: ItemType = Form(default=ItemType.PHOTOGRAPH),
    content_text: str | None = Form(default=None),
    content_url: HttpUrl | None = Form(default=None),
    favorite_portal_id: str | None = Form(default=None),
    favorite_portal_latitude: float | None = Form(default=None),
    favorite_portal_longitude: float | None = Form(default=None),
    favorite_portal_name: str | None = Form(default=None),
    file: UploadFile = File(...),
) -> dict:
    _validate_accuracy(accuracy_meters)

    if item_type not in (ItemType.PHOTOGRAPH, ItemType.FAVORITE_PORTAL_ITEM):
        raise HTTPException(status_code=400, detail="Multipart upload only supports photograph and favorite portal items")
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

    item = ItemDocument(
        id=str(uuid.uuid4()),
        type=item_type,
        owner=owner,
        latitude=latitude,
        longitude=longitude,
        accuracy_meters=accuracy_meters,
        favorite_portal_id=favorite_portal_id if item_type == ItemType.FAVORITE_PORTAL_ITEM else None,
        favorite_portal_latitude=favorite_portal_latitude if item_type == ItemType.FAVORITE_PORTAL_ITEM else None,
        favorite_portal_longitude=favorite_portal_longitude if item_type == ItemType.FAVORITE_PORTAL_ITEM else None,
        favorite_portal_name=favorite_portal_name.strip() if item_type == ItemType.FAVORITE_PORTAL_ITEM and favorite_portal_name else None,
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


app.mount("/uploads", StaticFiles(directory=config.UPLOADS_DIR), name="uploads")
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse("app/static/index.html")
