from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from app import config
from app.models import ItemDocument, NodeDocument, Quadrant


class FileStorage:
    def __init__(self) -> None:
        for path in (config.DATA_DIR, config.NODES_DIR, config.ITEMS_DIR, config.UPLOADS_DIR, config.CELLS_DIR):
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
            self.save_node(NodeDocument(id=root_id))
        return meta

    def get_default_dimension_root_id(self) -> str:
        return str(self.get_meta()["default_dimension_root_id"])

    def get_node(self, node_id: str) -> NodeDocument | None:
        payload = self._read_json(config.NODES_DIR / f"{node_id}.json")
        if payload is None:
            return None
        return NodeDocument.model_validate(payload)

    def save_node(self, node: NodeDocument) -> None:
        self._write_json(config.NODES_DIR / f"{node.id}.json", node.model_dump(mode="json"))

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

    def ensure_path(self, root_id: str, quadrants: list[Quadrant]) -> str:
        node = self.get_node(root_id)
        if node is None:
            node = NodeDocument(id=root_id)
            self.save_node(node)

        current = node
        for quadrant in quadrants:
            child_id = current.children[quadrant]
            if child_id is None:
                child_id = str(uuid.uuid4())
                current.children[quadrant] = child_id
                self.save_node(current)
                self.save_node(NodeDocument(id=child_id))
            child = self.get_node(child_id)
            if child is None:
                child = NodeDocument(id=child_id)
                self.save_node(child)
            current = child
        return current.id

    def resolve_path(self, root_id: str, quadrants: list[Quadrant]) -> str | None:
        current = self.get_node(root_id)
        if current is None:
            return None

        for quadrant in quadrants:
            child_id = current.children[quadrant]
            if child_id is None:
                return None
            child = self.get_node(child_id)
            if child is None:
                return None
            current = child
        return current.id

    def add_item_to_node(self, node_id: str, item_id: str) -> None:
        node = self.get_node(node_id)
        if node is None:
            raise ValueError(f"Node {node_id} does not exist")
        if item_id not in node.items:
            node.items.append(item_id)
            self.save_node(node)

    def remove_item_from_node(self, node_id: str, item_id: str) -> None:
        node = self.get_node(node_id)
        if node is None:
            return
        if item_id in node.items:
            node.items.remove(item_id)
            self.save_node(node)

    def delete_item(self, item_id: str) -> ItemDocument | None:
        item = self.get_item(item_id)
        if item is None:
            return None
        (config.ITEMS_DIR / f"{item_id}.json").unlink(missing_ok=True)
        return item

    def prune_empty_nodes(self, root_id: str, quadrants: list[Quadrant]) -> None:
        """Walk root→leaf path, then prune empty leaf nodes back toward root.
        The root node itself is never deleted."""
        # Build list of (parent_id, quadrant) pairs along the path
        ancestry: list[tuple[str, Quadrant]] = []
        current = self.get_node(root_id)
        if current is None:
            return
        for q in quadrants:
            child_id = current.children[q]
            if child_id is None:
                break
            ancestry.append((current.id, q))
            child = self.get_node(child_id)
            if child is None:
                break
            current = child

        # Walk from deepest ancestor toward root, pruning nodes that are now empty
        for parent_id, q in reversed(ancestry):
            parent = self.get_node(parent_id)
            if parent is None:
                break
            child_id = parent.children[q]
            if child_id is None:
                break
            if child_id == root_id:
                break  # never delete the root
            child = self.get_node(child_id)
            if child is None:
                continue
            has_items = bool(child.items)
            has_children = any(v is not None for v in child.children.values())
            if has_items or has_children:
                break  # not empty — stop pruning
            (config.NODES_DIR / f"{child.id}.json").unlink(missing_ok=True)
            parent.children[q] = None
            self.save_node(parent)

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
