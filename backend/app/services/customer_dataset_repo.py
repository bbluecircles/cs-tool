"""Repository for secure.customer_dataset.

Primary key: rec_id (autoincrement).
Edit/Create/DELETE all allowed — this is the only resource with delete.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.filter_parser import ParsedFilter, build_where

EDITABLE_COLUMNS: tuple[str, ...] = (
    "database_name", "odbc_dataset",
    "sg2", "sg2_op", "inpatient", "outpatient", "ed",
    "claritas_flag", "claritas_state",
    "prism_flag", "projection_flag",
    "cms_states", "transfers_flag", "dataset_type",
    "cell_size_limit", "export_detail",
    "aprdrg_flag", "export_flag", "export_row_limit", "webapp_flag",
)

SORTABLE_COLUMNS: frozenset[str] = frozenset({
    "rec_id", "customer_code", "customer_name",
    "database_name", "odbc_dataset",
    "sg2", "sg2_op", "inpatient", "outpatient", "ed",
    "claritas_flag", "claritas_state",
    "prism_flag", "projection_flag",
    "cms_states", "transfers_flag", "dataset_type",
    "cell_size_limit", "export_detail",
    "aprdrg_flag", "export_flag", "export_row_limit", "webapp_flag",
    "create_date", "modify_date",
})

FILTERABLE_COLUMNS: frozenset[str] = SORTABLE_COLUMNS

# customer_name is projected from secure.customer via the JOIN below.
# Because secure.customer also has create_date, modify_date, and a few
# other columns that collide with secure.customer_dataset, we alias both
# tables and qualify EVERY SELECT/WHERE/ORDER BY reference. The filter
# pipeline uses _COLUMN_MAP via build_where(column_map=...) so the
# WHERE clauses come back already qualified.
_LIST_COLUMNS = """
    cd.rec_id, cd.customer_code, c.customer_name AS customer_name,
    cd.database_name, cd.odbc_dataset,
    cd.sg2, cd.sg2_op, cd.inpatient, cd.outpatient, cd.ed,
    cd.claritas_flag, cd.claritas_state,
    cd.prism_flag, cd.projection_flag, cd.cms_states,
    cd.transfers_flag, cd.dataset_type,
    cd.cell_size_limit, cd.export_detail,
    cd.aprdrg_flag, cd.export_flag, cd.export_row_limit, cd.webapp_flag,
    cd.create_date, cd.modify_date
""".strip()


# JOIN with explicit aliases. ON instead of USING because USING would
# only merge customer_code, leaving create_date / modify_date ambiguous.
_FROM_JOINED = (
    "secure.customer_dataset AS cd "
    "LEFT JOIN secure.customer AS c ON c.customer_code = cd.customer_code"
)


# Maps logical column names to their qualified SQL forms. Passed to
# build_where so WHERE clauses come back qualified. Columns that are
# only on customer_dataset don't strictly need an entry, but we list
# all the SORTABLE/FILTERABLE ones explicitly so adding a new column
# requires updating this in one place.
_COLUMN_MAP: dict[str, str] = {
    "rec_id":           "cd.rec_id",
    "customer_code":    "cd.customer_code",
    "customer_name":    "c.customer_name",
    "database_name":    "cd.database_name",
    "odbc_dataset":     "cd.odbc_dataset",
    "sg2":              "cd.sg2",
    "sg2_op":           "cd.sg2_op",
    "inpatient":        "cd.inpatient",
    "outpatient":       "cd.outpatient",
    "ed":               "cd.ed",
    "claritas_flag":    "cd.claritas_flag",
    "claritas_state":   "cd.claritas_state",
    "prism_flag":       "cd.prism_flag",
    "projection_flag":  "cd.projection_flag",
    "cms_states":       "cd.cms_states",
    "transfers_flag":   "cd.transfers_flag",
    "dataset_type":     "cd.dataset_type",
    "cell_size_limit":  "cd.cell_size_limit",
    "export_detail":    "cd.export_detail",
    "aprdrg_flag":      "cd.aprdrg_flag",
    "export_flag":      "cd.export_flag",
    "export_row_limit": "cd.export_row_limit",
    "webapp_flag":      "cd.webapp_flag",
    "create_date":      "cd.create_date",
    "modify_date":      "cd.modify_date",
}


def list_customer_datasets(
    conn: Connection,
    *,
    page: int,
    page_size: int,
    filters: list[ParsedFilter] | None = None,
    sort_by: str | None = None,
    sort_dir: str = "asc",
) -> tuple[list[dict[str, Any]], int]:
    where_clauses: list[str] = []
    params: dict[str, Any] = {}

    if filters:
        flt_clauses, flt_params = build_where(filters, column_map=_COLUMN_MAP)
        where_clauses.extend(flt_clauses)
        params.update(flt_params)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    if sort_by and sort_by in SORTABLE_COLUMNS:
        direction = "ASC" if sort_dir.lower() != "desc" else "DESC"
        # Qualify sort column via the same map so e.g. "create_date"
        # becomes "cd.create_date" instead of an ambiguous bare ref.
        sort_sql = _COLUMN_MAP.get(sort_by, f"`{sort_by}`")
        order_sql = f"ORDER BY {sort_sql} {direction}, cd.rec_id ASC"
    else:
        order_sql = "ORDER BY cd.customer_code ASC, cd.database_name ASC"

    offset = (page - 1) * page_size
    params["limit"] = page_size
    params["offset"] = offset

    total = int(conn.execute(
        text(f"SELECT COUNT(*) FROM {_FROM_JOINED} {where_sql}"),
        params,
    ).scalar_one())

    rows = [dict(r) for r in conn.execute(
        text(
            f"""
            SELECT {_LIST_COLUMNS}
            FROM   {_FROM_JOINED}
            {where_sql}
            {order_sql}
            LIMIT  :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()]
    return rows, total


def get_customer_dataset(conn: Connection, rec_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        text(
            f"""
            SELECT {_LIST_COLUMNS}
            FROM   {_FROM_JOINED}
            WHERE  cd.rec_id = :rid
            LIMIT  1
            """
        ),
        {"rid": rec_id},
    ).mappings().first()
    return dict(row) if row else None


def create_customer_dataset(conn: Connection, data: dict[str, Any]) -> int:
    result = conn.execute(
        text(
            """
            INSERT INTO secure.customer_dataset
                (customer_code, database_name, odbc_dataset,
                 sg2, sg2_op, inpatient, outpatient, ed,
                 claritas_flag, claritas_state,
                 prism_flag, projection_flag, cms_states,
                 transfers_flag, dataset_type,
                 cell_size_limit, export_detail,
                 aprdrg_flag, export_flag, export_row_limit, webapp_flag,
                 create_date, modify_date)
            VALUES
                (:customer_code, :database_name, :odbc_dataset,
                 :sg2, :sg2_op, :inpatient, :outpatient, :ed,
                 :claritas_flag, :claritas_state,
                 :prism_flag, :projection_flag, :cms_states,
                 :transfers_flag, :dataset_type,
                 :cell_size_limit, :export_detail,
                 :aprdrg_flag, :export_flag, :export_row_limit, :webapp_flag,
                 NOW(), NOW())
            """
        ),
        {
            "customer_code": data["customer_code"],
            "database_name": data["database_name"],
            # odbc_dataset defaults to database_name when not provided.
            # The Create Discharge modal no longer surfaces this field
            # (showInCreate: false in resourceConfigs), so on create the
            # value always comes from database_name. Inline-edit can
            # still override it after the fact.
            "odbc_dataset": data.get("odbc_dataset") or data["database_name"],
            "sg2": data.get("sg2", 0),
            "sg2_op": data.get("sg2_op", 0),
            "inpatient": data.get("inpatient", 1),
            "outpatient": data.get("outpatient", 0),
            "ed": data.get("ed", 0),
            "claritas_flag": data.get("claritas_flag", 1),
            "claritas_state": data.get("claritas_state", ""),
            "prism_flag": data.get("prism_flag", 0),
            "projection_flag": data.get("projection_flag", 0),
            "cms_states": data.get("cms_states"),
            "transfers_flag": data.get("transfers_flag", 0),
            # Always discharge from this repo. The Type field was removed
            # from the Create Discharge modal; PPI rows go through a
            # different repo (ppi_dataset_repo) with their own dataset_type.
            "dataset_type": data.get("dataset_type") or "d",
            "cell_size_limit": data.get("cell_size_limit", 0),
            "export_detail": data.get("export_detail", "y"),
            "aprdrg_flag": data.get("aprdrg_flag", 0),
            "export_flag": data.get("export_flag", 1),
            "export_row_limit": data.get("export_row_limit", 100_000_000),
            "webapp_flag": data.get("webapp_flag", 0),
        },
    )
    return int(result.lastrowid)


def dataset_exists(
    conn: Connection, customer_code: int, database_name: str
) -> bool:
    """True if this customer already has a dataset for this database. Used to
    return a clear 'already exists' error on create instead of a raw SQL
    duplicate-key error (or a silent duplicate row if the legacy table has no
    unique key)."""
    row = conn.execute(
        text(
            "SELECT 1 FROM secure.customer_dataset "
            "WHERE customer_code = :cc AND database_name = :db LIMIT 1"
        ),
        {"cc": customer_code, "db": database_name},
    ).first()
    return row is not None


def update_customer_dataset(
    conn: Connection, rec_id: int, changes: dict[str, Any]
) -> None:
    if not changes:
        return
    bad = set(changes.keys()) - set(EDITABLE_COLUMNS)
    if bad:
        raise ValueError(f"non-editable columns: {sorted(bad)}")

    set_clauses: list[str] = []
    params: dict[str, Any] = {"rid": rec_id}
    for i, (col, val) in enumerate(changes.items()):
        key = f"v{i}"
        set_clauses.append(f"`{col}` = :{key}")
        params[key] = val

    conn.execute(
        text(
            f"UPDATE secure.customer_dataset SET {', '.join(set_clauses)}, "
            f"modify_date = NOW() WHERE rec_id = :rid"
        ),
        params,
    )


def delete_customer_dataset(conn: Connection, rec_id: int) -> int:
    """Hard delete. Returns 1 if a row was deleted, 0 otherwise.

    Note: deleting a dataset that has active users in customer_users will
    orphan the dependency — the denormalized user_details views will drop
    those user×dataset rows on the next refresh. The caller / UI is
    responsible for warning the agent before this happens.
    """
    result = conn.execute(
        text("DELETE FROM secure.customer_dataset WHERE rec_id = :rid"),
        {"rid": rec_id},
    )
    return result.rowcount


def active_user_count_for_dataset(
    conn: Connection, customer_code: int, database_name: str
) -> int:
    """Count users who are active on the same customer — approximation of
    'who will be affected if this dataset is deleted'. Used by the delete
    confirmation modal."""
    row = conn.execute(
        text(
            """
            SELECT COUNT(*)
            FROM   secure.customer_users
            WHERE  customer_code = :cc AND `disable` = 0
            """
        ),
        {"cc": customer_code},
    ).scalar_one()
    return int(row)