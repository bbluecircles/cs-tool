"""User list endpoint schemas.

Mirrors the shape of ``secure.user_details_internal_2026``.

Password is intentionally NOT in this model. CS agents see a masked value in
the table and call a separate endpoint to reveal it, which creates an audit
entry.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class UserRow(BaseModel):
    # Identity / composite key
    user_id: str
    database_name: str

    # Customer-level
    customer_code: int
    customer_name: str | None = None
    entity_code: str | None = None

    # User-level
    e_mail: str
    first_name: str
    last_name: str
    disable: int
    pw_flag: int | None = None

    # Dataset-level flags
    sg2: int | None = None
    sg2_op: int | None = None
    inpatient: int | None = None
    outpatient: int | None = None
    ed: int | None = None
    claritas_flag: int | None = None
    claritas_state: str | None = None
    prism_flag: int | None = None
    projection_flag: int | None = None
    cms_states: str | None = None
    transfers_flag: int | None = None
    dataset_type: str | None = None
    cell_size_limit: int | None = None
    export_detail: str | None = None
    aprdrg_flag: int | None = None
    export_flag: int | None = None
    export_row_limit: int | None = None
    webapp_flag: int | None = None

    # User-level access flags
    logging_flag: int | None = None
    esri_access: int | None = None
    esri_tap_access: int | None = None
    esri_state: str | None = None
    webuser: int | None = None
    ppiuser: int | None = None
    mapping: int | None = None
    user_priority: int | None = None
    max_birt_processes: int | None = None
    ppi_detail_user: int | None = None
    web_esri_access: int | None = None
    web_esri_tap_access: int | None = None
    web_inpatient_access: int | None = None
    web_outpatient_access: int | None = None
    web_ed_access: int | None = None
    web_claims_access: int | None = None

    # Customer-level quotas
    max_bytes: int | None = None
    field_5_digit_zip: int | None = Field(default=None, alias="5_digit_zip")
    max_row_cnt: int | None = None

    # Timestamps
    create_date: datetime | None = None
    modify_date: datetime | None = None

    model_config = {"populate_by_name": True}


class UserListResponse(BaseModel):
    rows: list[UserRow]
    total: int
    page: int
    page_size: int


class UserListQuery(BaseModel):
    """Validated query params for the list endpoint."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)
    search: str | None = Field(default=None, max_length=200)
    customer_code: int | None = Field(default=None, ge=0)
    database_name: str | None = Field(default=None, max_length=25)
    disable: Literal[0, 1] | None = None
    sort_by: str | None = Field(default=None, max_length=32)
    sort_dir: Literal["asc", "desc"] = "asc"


class PasswordRevealResponse(BaseModel):
    user_id: str
    user_password: str
