"""Request/response schemas for the four canonical-table resources.

Kept deliberately loose (Any + dict) for the create/update payloads — the
repos validate which columns are editable. This avoids a wall of Field(...)
declarations for 50+ columns across four tables.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ListResponse(BaseModel):
    rows: list[dict[str, Any]]
    total: int
    page: int
    page_size: int


class CreateResponse(BaseModel):
    """Returned after a successful create. The key fields echo back so the
    UI can locate the freshly-created row."""
    created: dict[str, Any]


class UpdateResponse(BaseModel):
    updated: dict[str, Any]


class DeleteResponse(BaseModel):
    deleted: bool
    rec_id: int


class EditPayload(BaseModel):
    """Generic inline-edit body: a dict of {column: value}."""
    changes: dict[str, Any] = Field(default_factory=dict)


class PasswordRevealResponse(BaseModel):
    user_id: str
    customer_code: int
    user_password: str


class UserIdCheckResponse(BaseModel):
    user_id: str
    available: bool


class ChangePreviewImpact(BaseModel):
    """Returned by the preview endpoint when ENABLE_EDIT_CONFIRMATION is on."""
    column: str
    old_value: Any | None = None
    new_value: Any | None = None


class PreviewResponse(BaseModel):
    impacts: list[ChangePreviewImpact]
    # Echoed so the frontend knows whether to show the confirm modal
    # without a separate /config call.
    confirmation_required: bool


# Config exposure
class ClientConfig(BaseModel):
    enable_edit_confirmation: bool
    enable_view_refresh: bool
    admin_customer_codes: str
