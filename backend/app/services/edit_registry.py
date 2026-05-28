"""Editable-column registry.

For each editable column on the user-list view, this registry records:

  * target table (one of secure.customer_users / secure.customer /
    secure.customer_dataset)
  * the WHERE-clause columns needed to uniquely identify the row
  * the SQL type and allowed value shape
  * whether the column is actually editable at all

This is the single source of truth for both the update path and the scope
preview. If you want a column to become editable, add it here and nowhere
else.

Columns NOT in this registry are read-only by construction. Anything in
`secure.user_details_internal_2026` that is not listed below cannot be
edited through this tool.

Scope semantics:

  * user     — UPDATE secure.customer_users WHERE user_id = :user_id
               Changes ALL rows for this user_id (if they have multiple
               datasets, the change propagates across all of them).

  * customer — UPDATE secure.customer WHERE customer_code = :customer_code
               Changes every user under this customer, across every dataset.

  * dataset  — UPDATE secure.customer_dataset
                    WHERE customer_code = :customer_code
                      AND database_name = :database_name
               Changes every user attached to this customer on this dataset.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal

Scope = Literal["user", "customer", "dataset"]
ValueKind = Literal["int", "str", "bigint"]


@dataclass(frozen=True)
class EditableColumn:
    name: str
    scope: Scope
    target_table: str            # fully-qualified, backticked where needed
    column: str                  # physical column name in the target table
    kind: ValueKind
    max_length: int | None = None
    min_value: int | None = None
    max_value: int | None = None
    allowed_values: tuple[Any, ...] | None = None
    nullable: bool = False

    def coerce(self, raw: Any) -> Any:
        """Normalize an incoming value; raise ValueError on bad input."""
        if raw is None:
            if not self.nullable:
                raise ValueError(f"{self.name} may not be null")
            return None

        if self.kind in ("int", "bigint"):
            # Accept numeric strings too — form inputs arrive as strings.
            try:
                v = int(raw)
            except (TypeError, ValueError) as e:
                raise ValueError(f"{self.name} must be an integer") from e
            if self.min_value is not None and v < self.min_value:
                raise ValueError(f"{self.name} must be >= {self.min_value}")
            if self.max_value is not None and v > self.max_value:
                raise ValueError(f"{self.name} must be <= {self.max_value}")
            if self.allowed_values is not None and v not in self.allowed_values:
                raise ValueError(
                    f"{self.name} must be one of {self.allowed_values}"
                )
            return v

        # str
        s = str(raw)
        if self.max_length is not None and len(s) > self.max_length:
            raise ValueError(
                f"{self.name} must be <= {self.max_length} characters"
            )
        if self.allowed_values is not None and s not in self.allowed_values:
            raise ValueError(
                f"{self.name} must be one of {self.allowed_values}"
            )
        return s


# --- Helpers -----------------------------------------------------------------

def _flag(name: str, scope: Scope, table: str, column: str | None = None) -> EditableColumn:
    """0/1 flag."""
    return EditableColumn(
        name=name,
        scope=scope,
        target_table=table,
        column=column or name,
        kind="int",
        allowed_values=(0, 1),
    )


def _small_int(
    name: str, scope: Scope, table: str, *, column: str | None = None,
    min_value: int = 0, max_value: int = 32767,
) -> EditableColumn:
    return EditableColumn(
        name=name,
        scope=scope,
        target_table=table,
        column=column or name,
        kind="int",
        min_value=min_value,
        max_value=max_value,
    )


def _varchar(
    name: str, scope: Scope, table: str, max_length: int,
    *, column: str | None = None, nullable: bool = False,
) -> EditableColumn:
    return EditableColumn(
        name=name,
        scope=scope,
        target_table=table,
        column=column or name,
        kind="str",
        max_length=max_length,
        nullable=nullable,
    )


_CU = "`secure`.`customer_users`"
_C  = "`secure`.`customer`"
_CD = "`secure`.`customer_dataset`"

# --- The registry ------------------------------------------------------------

_REGISTRY_LIST: tuple[EditableColumn, ...] = (
    # ----- customer_users (user-scoped) -----
    _varchar("e_mail",       "user", _CU, 200),
    _varchar("first_name",   "user", _CU, 35),
    _varchar("last_name",    "user", _CU, 35),
    _flag   ("disable",      "user", _CU),
    _flag   ("logging_flag", "user", _CU),
    _flag   ("pw_flag",      "user", _CU),
    _flag   ("esri_access",  "user", _CU),
    _flag   ("esri_tap_access", "user", _CU),
    _varchar("esri_state",   "user", _CU, 254),
    _flag   ("webuser",      "user", _CU),
    _flag   ("ppiuser",      "user", _CU),
    _flag   ("mapping",      "user", _CU),
    _small_int("user_priority", "user", _CU, min_value=0, max_value=10),
    _small_int("max_birt_processes", "user", _CU, min_value=1, max_value=20),
    _flag   ("ppi_detail_user", "user", _CU),
    _flag   ("web_esri_access",      "user", _CU),
    _flag   ("web_esri_tap_access",  "user", _CU),
    _flag   ("web_inpatient_access", "user", _CU),
    _flag   ("web_outpatient_access","user", _CU),
    _flag   ("web_ed_access",        "user", _CU),
    _flag   ("web_claims_access",    "user", _CU),

    # ----- customer (customer-scoped) -----
    _varchar("customer_name",  "customer", _C, 80, nullable=True),
    # entity_code is INTEGER-typed even though the DB column is varchar.
    # See the comment on NewCustomerInput.entity_code in create_user.py:
    # empty / non-integer values break tsp_entity_users in the main app.
    _small_int("entity_code", "customer", _C, min_value=1, max_value=32767),
    _varchar("state",          "customer", _C,   2, nullable=True),
    _varchar("customer_desc",  "customer", _C, 255, nullable=True),
    EditableColumn(
        name="max_bytes", scope="customer", target_table=_C, column="max_bytes",
        kind="bigint", min_value=0, max_value=10_000_000_000_000, nullable=True,
    ),
    _small_int("5_digit_zip", "customer", _C, column="`5_digit_zip`",
               min_value=0, max_value=1),
    EditableColumn(
        name="max_row_cnt", scope="customer", target_table=_C, column="max_row_cnt",
        kind="int", min_value=0, max_value=2_000_000_000, nullable=True,
    ),

    # ----- customer_dataset (dataset-scoped) -----
    _flag   ("sg2",          "dataset", _CD),
    _flag   ("sg2_op",       "dataset", _CD),
    _flag   ("inpatient",    "dataset", _CD),
    _flag   ("outpatient",   "dataset", _CD),
    _flag   ("ed",           "dataset", _CD),
    _flag   ("claritas_flag","dataset", _CD),
    _varchar("claritas_state","dataset", _CD, 254),
    _flag   ("prism_flag",   "dataset", _CD),
    _flag   ("projection_flag","dataset", _CD),
    _varchar("cms_states",   "dataset", _CD, 255, nullable=True),
    _flag   ("transfers_flag","dataset", _CD),
    _varchar("dataset_type", "dataset", _CD, 1, nullable=True),
    _small_int("cell_size_limit", "dataset", _CD, min_value=0, max_value=100000),
    _varchar("export_detail","dataset", _CD, 5),
    _flag   ("aprdrg_flag",  "dataset", _CD),
    _flag   ("export_flag",  "dataset", _CD),
    EditableColumn(
        name="export_row_limit", scope="dataset", target_table=_CD,
        column="export_row_limit", kind="int",
        min_value=0, max_value=2_000_000_000,
    ),
    _flag   ("webapp_flag",  "dataset", _CD),
)

REGISTRY: dict[str, EditableColumn] = {c.name: c for c in _REGISTRY_LIST}


def get_editable(name: str) -> EditableColumn:
    """Look up an editable column or raise KeyError."""
    return REGISTRY[name]


def is_editable(name: str) -> bool:
    return name in REGISTRY