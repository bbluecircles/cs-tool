from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class EditPayload(BaseModel):
    """Body for both preview and apply."""
    changes: dict[str, Any] = Field(default_factory=dict)


class ChangeImpactResponse(BaseModel):
    column: str
    scope: Literal["user", "customer", "dataset"]
    old_value: Any | None = None
    new_value: Any | None = None
    affected_row_count: int


class PreviewResponse(BaseModel):
    impacts: list[ChangeImpactResponse]


class ApplyResponse(BaseModel):
    impacts: list[ChangeImpactResponse]
    refresh_ok: bool
    grants_ok: bool
    refresh_error: str | None = None
    grants_error: str | None = None


class EditableColumnDescriptor(BaseModel):
    """Surfaced by /api/edit/columns so the frontend knows what's editable
    without duplicating the registry."""
    name: str
    scope: Literal["user", "customer", "dataset"]
    kind: Literal["int", "str", "bigint"]
    nullable: bool
    max_length: int | None = None
    min_value: int | None = None
    max_value: int | None = None
    allowed_values: list[Any] | None = None
