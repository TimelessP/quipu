from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class ItemType(str, Enum):
    LETTER = "letter"
    PHOTOGRAPH = "photograph"
    PORTAL_MARKER = "portal_marker"


class ItemDocument(BaseModel):
    id: str
    type: ItemType
    owner: str
    placement_timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    latitude: float
    longitude: float
    accuracy_meters: float | None = None
    portal_name: str | None = None
    content_text: str | None = None
    content_url: HttpUrl | None = None
    content_upload_path: str | None = None
    dimension_root_id: str


class PlaceItemRequest(BaseModel):
    type: Literal[ItemType.LETTER, ItemType.PORTAL_MARKER, ItemType.PHOTOGRAPH]
    owner: str = Field(min_length=1, max_length=128)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, ge=0)
    portal_name: str | None = Field(default=None, max_length=128)
    content_text: str | None = Field(default=None, max_length=5000)
    # For re-placing a picked-up photograph: reference existing upload path
    content_upload_path: str | None = None


class PlacePhotoItemRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=128)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, ge=0)
    content_text: str | None = Field(default=None, max_length=5000)


class RenamePortalRequest(BaseModel):
    actor_latitude: float = Field(ge=-90, le=90)
    actor_longitude: float = Field(ge=-180, le=180)
    portal_name: str = Field(min_length=1, max_length=128)
