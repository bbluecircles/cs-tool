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


class ChangeCodePayload(BaseModel):
    """Body of POST /api/customers/{customer_code}/change-code.

    Bounded at INT max as a sanity rail. The repo additionally verifies
    the value round-trips, which catches a narrower column (e.g. SMALLINT)
    silently clamping the code on a non-strict server.
    """
    new_code: int = Field(ge=1, le=2_147_483_647)


class ChangeCodeImpact(BaseModel):
    """What a code change would drag along with it. `counts` is keyed by
    the labels in customer_repo.CODE_CHILD_TABLES."""
    customer_code: int
    customer_name: str | None = None
    counts: dict[str, int]


class ChangeCodeResponse(BaseModel):
    customer_code: int
    previous_code: int
    # Rows updated per table: "customer" plus one entry per child table.
    affected: dict[str, int]
    # Rows renumbered across the denormalized user_details* tables.
    user_details_rows: int
    updated: dict[str, Any]


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
