from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, HttpUrl


class ItemType(str, Enum):
    MEDIA = "media"
    VISIT_COUNTER = "visit_counter"
    PORTAL_MARKER = "portal_marker"
    FAVORITE_PORTAL_ITEM = "favorite_portal_item"


class ItemDocument(BaseModel):
    id: str
    type: ItemType
    owner: str
    placement_timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    latitude: float
    longitude: float
    accuracy_meters: float | None = None
    dimension_root_id: str


class ContentItemDocument(ItemDocument):
    content_name: str | None = Field(default=None, max_length=128)
    content_text: str | None = Field(default=None, max_length=5000)
    content_url: HttpUrl | None = None
    content_upload_path: str | None = None


class MediaItemDocument(ContentItemDocument):
    type: Literal[ItemType.MEDIA]  # pyright: ignore[reportIncompatibleVariableOverride]


class VisitCounterItemDocument(ItemDocument):
    type: Literal[ItemType.VISIT_COUNTER]  # pyright: ignore[reportIncompatibleVariableOverride]
    visit_counter_name: str | None = Field(default=None, max_length=128)
    visit_count: int = Field(default=0, ge=0)


class PortalMarkerItemDocument(ItemDocument):
    type: Literal[ItemType.PORTAL_MARKER]  # pyright: ignore[reportIncompatibleVariableOverride]
    portal_name: str | None = None


class FavoritePortalItemDocument(ContentItemDocument):
    type: Literal[ItemType.FAVORITE_PORTAL_ITEM]  # pyright: ignore[reportIncompatibleVariableOverride]
    favorite_portal_id: str | None = None
    favorite_portal_latitude: float | None = Field(default=None, ge=-90, le=90)
    favorite_portal_longitude: float | None = Field(default=None, ge=-180, le=180)
    favorite_portal_name: str | None = None


class BasePlacementRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=128)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, ge=0)


class PlaceMediaItemRequest(BasePlacementRequest):
    type: Literal[ItemType.MEDIA]
    content_name: str | None = Field(default=None, max_length=128)
    content_text: str | None = Field(default=None, max_length=5000)
    content_url: HttpUrl | None = None
    content_upload_path: str | None = None


class PlaceVisitCounterItemRequest(BasePlacementRequest):
    type: Literal[ItemType.VISIT_COUNTER]
    visit_counter_name: str | None = Field(default=None, max_length=128)


class PlacePortalMarkerItemRequest(BasePlacementRequest):
    type: Literal[ItemType.PORTAL_MARKER]
    portal_name: str | None = Field(default=None, max_length=128)


class PlaceFavoritePortalItemRequest(BasePlacementRequest):
    type: Literal[ItemType.FAVORITE_PORTAL_ITEM]
    favorite_portal_id: str | None = Field(default=None, min_length=1, max_length=128)
    favorite_portal_latitude: float | None = Field(default=None, ge=-90, le=90)
    favorite_portal_longitude: float | None = Field(default=None, ge=-180, le=180)
    favorite_portal_name: str | None = Field(default=None, max_length=128)
    content_name: str | None = Field(default=None, max_length=128)
    content_text: str | None = Field(default=None, max_length=5000)
    content_url: HttpUrl | None = None
    content_upload_path: str | None = None


PlaceItemRequest = Annotated[
    Union[
        PlaceMediaItemRequest,
        PlaceVisitCounterItemRequest,
        PlacePortalMarkerItemRequest,
        PlaceFavoritePortalItemRequest,
    ],
    Field(discriminator="type"),
]


class PlacePhotoItemRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=128)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, ge=0)
    content_name: str | None = Field(default=None, max_length=128)
    content_text: str | None = Field(default=None, max_length=5000)
    content_url: HttpUrl | None = None
    favorite_portal_id: str | None = Field(default=None, min_length=1, max_length=128)
    favorite_portal_latitude: float | None = Field(default=None, ge=-90, le=90)
    favorite_portal_longitude: float | None = Field(default=None, ge=-180, le=180)
    favorite_portal_name: str | None = Field(default=None, max_length=128)
    content_upload_path: str | None = None


ItemPayload = Annotated[
    Union[MediaItemDocument, VisitCounterItemDocument, PortalMarkerItemDocument, FavoritePortalItemDocument],
    Field(discriminator="type"),
]


class RenamePortalRequest(BaseModel):
    actor_latitude: float = Field(ge=-90, le=90)
    actor_longitude: float = Field(ge=-180, le=180)
    portal_name: str = Field(min_length=1, max_length=128)
