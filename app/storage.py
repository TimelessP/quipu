from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from app import config
from app.models import ItemDocument


class FileStorage:
    def __init__(self) -> None:
        for path in (config.DATA_DIR, config.ITEMS_DIR, config.UPLOADS_DIR, config.CELLS_DIR):
            path.mkdir(parents=True, exist_ok=True)

    def _cell_path(self, root_id: str, cell_id: str) -> Path:
        return config.CELLS_DIR / f"{root_id}__{cell_id}.json"

    def _read_json(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        temp_path = path.with_suffix(path.suffix + ".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=True, indent=2, default=str)
        temp_path.replace(path)

    def get_meta(self) -> dict[str, Any]:
        meta = self._read_json(config.META_FILE)
        if meta is None:
            root_id = str(uuid.uuid4())
            meta = {"default_dimension_root_id": root_id}
            self._write_json(config.META_FILE, meta)
        return meta

    def get_default_dimension_root_id(self) -> str:
        return str(self.get_meta()["default_dimension_root_id"])

    def get_item(self, item_id: str) -> ItemDocument | None:
        payload = self._read_json(config.ITEMS_DIR / f"{item_id}.json")
        if payload is None:
            return None
        return ItemDocument.model_validate(payload)

    def save_item(self, item: ItemDocument) -> None:
        self._write_json(config.ITEMS_DIR / f"{item.id}.json", item.model_dump(mode="json"))

    def get_cell(self, root_id: str, cell_id: str) -> dict[str, Any] | None:
        return self._read_json(self._cell_path(root_id, cell_id))

    def save_cell(self, root_id: str, cell_id: str, item_ids: list[str]) -> None:
        payload = {
            "dimension_root_id": root_id,
            "cell_id": cell_id,
            "item_ids": item_ids,
        }
        self._write_json(self._cell_path(root_id, cell_id), payload)

    def add_item_to_cell(self, root_id: str, cell_id: str, item_id: str) -> None:
        cell = self.get_cell(root_id, cell_id)
        item_ids = list(cell.get("item_ids", [])) if cell else []
        if item_id not in item_ids:
            item_ids.append(item_id)
            self.save_cell(root_id, cell_id, item_ids)

    def remove_item_from_cell(self, root_id: str, cell_id: str, item_id: str) -> None:
        cell = self.get_cell(root_id, cell_id)
        if not cell:
            return
        item_ids = list(cell.get("item_ids", []))
        if item_id in item_ids:
            item_ids.remove(item_id)
        if item_ids:
            self.save_cell(root_id, cell_id, item_ids)
        else:
            self._cell_path(root_id, cell_id).unlink(missing_ok=True)

    def delete_item(self, item_id: str) -> ItemDocument | None:
        item = self.get_item(item_id)
        if item is None:
            return None
        (config.ITEMS_DIR / f"{item_id}.json").unlink(missing_ok=True)
        return item

    def save_upload(self, src_path: Path, original_name: str) -> str:
        safe_name = original_name.replace("/", "_").replace("..", "_")
        filename = f"{uuid.uuid4()}-{safe_name}"
        dest = config.UPLOADS_DIR / filename
        shutil.copyfile(src_path, dest)
        return f"/uploads/{filename}"

    def iter_items_in_dimension(self, root_id: str) -> list[ItemDocument]:
        items: list[ItemDocument] = []
        for item_file in config.ITEMS_DIR.glob("*.json"):
            payload = self._read_json(item_file)
            if payload is None:
                continue
            item = ItemDocument.model_validate(payload)
            if item.dimension_root_id == root_id:
                items.append(item)
        return items
