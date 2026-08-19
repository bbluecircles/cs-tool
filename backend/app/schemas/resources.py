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


class ChangeCustomerPayload(BaseModel):
    """Body of POST /api/customer-users/{user_id}/{customer_code}/change-customer."""
    new_customer_code: int = Field(ge=1)
    # Drop the user's MariaDB account after the move, clearing privileges
    # they held for the OLD customer's databases. Defaults on: the move
    # already costs them access until grants are re-run (their lookup rows
    # are purged either way), so revoking adds no extra downtime and is the
    # safer end state. Turn it off for a move between related customers
    # where the existing database access should carry over.
    revoke_access: bool = True


class ChangeCustomerResponse(BaseModel):
    user_id: str
    customer_code: int
    previous_customer_code: int
    # Lookup rows dropped from the denormalized user_details* tables. They
    # come back, pointing at the new customer, on the next refresh.
    user_details_rows_removed: int
    # Post-commit account revoke. ok=True with attempted=False means it was
    # not requested. A failure here does NOT fail the move — the user is
    # reassigned either way; they just keep their old privileges.
    revoke_attempted: bool = False
    revoke_ok: bool = True
    revoke_error: str | None = None
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
