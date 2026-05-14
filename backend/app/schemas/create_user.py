"""Create-user payload schemas.

A create request is one of two shapes, discriminated on the ``customer``
field:

  mode = 'existing' → { customer: {mode, customer_code} }
  mode = 'new'      → { customer: {mode, customer_name, ...},
                        datasets: [...],
                        ppi_datasets: [...]? }

The ``user`` block is identical in both modes.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, StringConstraints

# ---------------------------------------------------------------------------
# Customer block
# ---------------------------------------------------------------------------

class ExistingCustomerRef(BaseModel):
    mode: Literal["existing"] = "existing"
    customer_code: int = Field(ge=0)


class NewCustomerInput(BaseModel):
    mode: Literal["new"] = "new"
    customer_name: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    # Optional integer (1..32767). When omitted, customer_repo defaults
    # this to the auto-assigned customer_code — matching the convention
    # in the existing data where each customer is its own entity unless
    # explicitly grouped for cross-customer sharing. Empty / non-integer
    # values are still rejected here so they never reach the main app's
    # tsp_entity_users stored proc, which SELECTs entity_code INTO an
    # INT variable.
    entity_code: int | None = Field(default=None, ge=1, le=32767)
    max_bytes: int | None = Field(default=None, ge=0, le=10_000_000_000_000)
    field_5_digit_zip: Literal[0, 1] = Field(default=1, alias="5_digit_zip")
    max_row_cnt: int | None = Field(default=5000, ge=0, le=2_000_000_000)

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Dataset blocks
# ---------------------------------------------------------------------------

class DatasetInput(BaseModel):
    """One row in secure.customer_dataset."""
    database_name: Annotated[str, StringConstraints(min_length=1, max_length=25)]
    odbc_dataset: Annotated[str, StringConstraints(max_length=25)] | None = None
    sg2: Literal[0, 1] = 0
    sg2_op: Literal[0, 1] = 0
    inpatient: Literal[0, 1] = 1
    outpatient: Literal[0, 1] = 0
    ed: Literal[0, 1] = 0
    claritas_flag: Literal[0, 1] = 1
    claritas_state: Annotated[str, StringConstraints(max_length=254)] = ""
    prism_flag: Literal[0, 1] = 0
    projection_flag: Literal[0, 1] = 0
    cms_states: Annotated[str, StringConstraints(max_length=255)] | None = None
    transfers_flag: Literal[0, 1] = 0
    dataset_type: Annotated[str, StringConstraints(max_length=1)] | None = None
    cell_size_limit: int = Field(default=0, ge=0, le=100_000)
    export_detail: Annotated[str, StringConstraints(max_length=5)] = "y"
    aprdrg_flag: Literal[0, 1] = 0
    export_flag: Literal[0, 1] = 1
    export_row_limit: int = Field(default=100_000_000, ge=0, le=2_000_000_000)
    webapp_flag: Literal[0, 1] = 0


class PpiDatasetInput(BaseModel):
    """One row in secure.ppi_dataset."""
    ppi_state: Annotated[str, StringConstraints(min_length=1, max_length=25)]
    ppi_detail: int = Field(default=1, ge=0, le=1)
    ppi_summary: int = Field(default=1, ge=0, le=1)
    cell_size_limit: int = Field(default=0, ge=0, le=100_000)
    export_detail: Annotated[str, StringConstraints(max_length=5)] = "y"


# ---------------------------------------------------------------------------
# User block
# ---------------------------------------------------------------------------

# user_id is the MariaDB username for the end user. Keep it conservative:
# lowercase alphanumerics + underscores, <= 15 chars to match the schema PK
# width limit and the 15-char password column legacy quirk.
class UserInput(BaseModel):
    user_id: Annotated[
        str,
        StringConstraints(
            min_length=1, max_length=15,
            pattern=r"^[a-zA-Z0-9_.-]+$",
        ),
    ]
    user_password: Annotated[str, StringConstraints(min_length=1, max_length=15)]
    pw_flag: Literal[0, 1] = 0
    e_mail: EmailStr
    first_name: Annotated[str, StringConstraints(min_length=1, max_length=35)]
    last_name: Annotated[str, StringConstraints(min_length=1, max_length=35)]

    # Per-user access flags. All default to sensible starter values mirroring
    # what CS usually sets for a new account.
    logging_flag: Literal[0, 1] = 0
    esri_access: Literal[0, 1] = 0
    esri_tap_access: Literal[0, 1] = 0
    esri_state: Annotated[str, StringConstraints(max_length=254)] = (
        "AL,AK,AZ,AR,CA,CO,CT,DC,DE,FL,GA,HI,ID,IL,IN,IA,KS,KY,LA,ME,MD,MA,"
        "MI,MN,MS,MO,MT,NE,NV,NH,NJ,NM,NY,NC,ND,OH,OK,OR,PA,RI,SC,SD,TN,TX,"
        "UT,VT,VA,WA,WV,WI,WY"
    )
    webuser: Literal[0, 1] = 1
    ppiuser: Literal[0, 1] = 0
    mapping: Literal[0, 1] = 0
    user_priority: int = Field(default=1, ge=0, le=10)
    max_birt_processes: int = Field(default=1, ge=1, le=20)
    ppi_detail_user: Literal[0, 1] = 0
    web_esri_access: Literal[0, 1] = 0
    web_esri_tap_access: Literal[0, 1] = 0
    web_inpatient_access: Literal[0, 1] = 0
    web_outpatient_access: Literal[0, 1] = 0
    web_ed_access: Literal[0, 1] = 0
    web_claims_access: Literal[0, 1] = 0


# ---------------------------------------------------------------------------
# Full create request
# ---------------------------------------------------------------------------

class CreateUserRequest(BaseModel):
    # Discriminated by mode. FastAPI/Pydantic v2 supports tagged unions via
    # Field(discriminator=...); we keep it simple by hand-branching in the
    # endpoint because one of the arms has extra fields.
    customer: NewCustomerInput | ExistingCustomerRef
    datasets: list[DatasetInput] = Field(default_factory=list)
    ppi_datasets: list[PpiDatasetInput] = Field(default_factory=list)
    user: UserInput


class UserIdCheckResponse(BaseModel):
    user_id: str
    available: bool


class CreateUserResponse(BaseModel):
    user_id: str
    customer_code: int
    datasets_created: int
    ppi_datasets_created: int
    customer_created: bool
    refresh_ok: bool
    grants_ok: bool
    refresh_error: str | None = None
    grants_error: str | None = None