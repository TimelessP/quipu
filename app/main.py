from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

import h3
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import config
from app.models import ItemDocument, ItemType, PlaceItemRequest
from app.spatial import haversine_meters, path_for_coordinate
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
    portals = [item for item in storage.iter_items_in_dimension(root_id) if item.type == ItemType.PORTAL_MARKER]
    for portal in portals:
        distance = haversine_meters(latitude, longitude, portal.latitude, portal.longitude)
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


@app.get("/api/nodes/{node_id}")
def get_node(node_id: str) -> dict:
    node = storage.get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return node.model_dump(mode="json")


@app.get("/api/items/{item_id}")
def get_item(item_id: str) -> dict:
    item = storage.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item.model_dump(mode="json")


@app.post("/api/dimensions/{root_id}/items")
def place_item(root_id: str, request: PlaceItemRequest) -> dict:
    _validate_accuracy(request.accuracy_meters)

    if request.type == ItemType.LETTER and not request.content_text:
        raise HTTPException(status_code=400, detail="content_text is required for letter items")
    if request.type == ItemType.PORTAL_MARKER and request.content_text:
        raise HTTPException(status_code=400, detail="portal_marker cannot include content_text")
    if request.type == ItemType.PHOTOGRAPH:
        if not request.content_upload_path:
            raise HTTPException(status_code=400, detail="content_upload_path required for photograph placement")
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

    quadrants = path_for_coordinate(request.latitude, request.longitude, config.TREE_DEPTH)
    node_id = storage.ensure_path(root_id=root_id, quadrants=quadrants)
    cell_id = h3.latlng_to_cell(request.latitude, request.longitude, config.H3_RESOLUTION)

    item = ItemDocument(
        id=str(uuid.uuid4()),
        type=request.type,
        owner=request.owner,
        latitude=request.latitude,
        longitude=request.longitude,
        accuracy_meters=request.accuracy_meters,
        content_text=request.content_text,
        content_upload_path=request.content_upload_path,
        node_id=node_id,
        dimension_root_id=root_id,
    )
    storage.save_item(item)
    storage.add_item_to_node(node_id=node_id, item_id=item.id)
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
    storage.remove_item_from_node(item.node_id, item_id)
    storage.remove_item_from_cell(root_id=root_id, cell_id=cell_id, item_id=item_id)
    storage.delete_item(item_id)

    quadrants = path_for_coordinate(item.latitude, item.longitude, config.TREE_DEPTH)
    storage.prune_empty_nodes(root_id, quadrants)

    return {"deleted": item_id}


@app.post("/api/dimensions/{root_id}/photos")
async def place_photo(
    root_id: str,
    owner: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    accuracy_meters: float | None = Form(default=None),
    content_text: str | None = Form(default=None),
    file: UploadFile = File(...),
) -> dict:
    _validate_accuracy(accuracy_meters)

    quadrants = path_for_coordinate(latitude, longitude, config.TREE_DEPTH)
    node_id = storage.ensure_path(root_id=root_id, quadrants=quadrants)
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
        type=ItemType.PHOTOGRAPH,
        owner=owner,
        latitude=latitude,
        longitude=longitude,
        accuracy_meters=accuracy_meters,
        content_text=content_text,
        content_upload_path=upload_path,
        node_id=node_id,
        dimension_root_id=root_id,
    )
    storage.save_item(item)
    storage.add_item_to_node(node_id=node_id, item_id=item.id)
    storage.add_item_to_cell(root_id=root_id, cell_id=cell_id, item_id=item.id)
    return item.model_dump(mode="json")


@app.get("/api/dimensions/{root_id}/cells/{cell_id}/item-ids")
def get_cell_item_ids(root_id: str, cell_id: str) -> dict:
    cell = storage.get_cell(root_id, cell_id)
    if cell is None:
        return {"item_ids": []}
    return {"item_ids": list(cell.get("item_ids", []))}


@app.get("/api/dimensions/{root_id}/resolve-node")
def resolve_node_for_coordinate(root_id: str, lat: float, lng: float) -> dict:
    """Resolve the sparse-tree node path for a coordinate without mutating storage."""
    quadrants = path_for_coordinate(lat, lng, config.TREE_DEPTH)

    current = storage.get_node(root_id)
    if current is None:
        return {"leaf_node_id": None, "node_path": [], "quadrants": [q.value for q in quadrants]}

    node_path: list[str] = [current.id]
    for q in quadrants:
        child_id = current.children[q]
        if child_id is None:
            break
        child = storage.get_node(child_id)
        if child is None:
            break
        node_path.append(child.id)
        current = child

    leaf_node_id = node_path[-1] if node_path else None
    return {
        "leaf_node_id": leaf_node_id,
        "node_path": node_path,
        "quadrants": [q.value for q in quadrants],
    }


@app.get("/api/dimensions/{root_id}/items-in-bbox")
def get_items_in_bbox(
    root_id: str,
    min_lat: float,
    max_lat: float,
    min_lng: float,
    max_lng: float,
    item_type: ItemType | None = None,
) -> dict:
    if min_lat > max_lat or min_lng > max_lng:
        raise HTTPException(status_code=400, detail="Invalid bbox")

    items = storage.iter_items_in_dimension(root_id)
    found: list[ItemDocument] = []

    for item in items:
        if item_type is not None and item.type != item_type:
            continue
        if not (min_lat <= item.latitude <= max_lat and min_lng <= item.longitude <= max_lng):
            continue
        found.append(item)

    return {"items": [item.model_dump(mode="json") for item in found]}


app.mount("/uploads", StaticFiles(directory=config.UPLOADS_DIR), name="uploads")
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse("app/static/index.html")
