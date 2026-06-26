"""Repository for secure.ppi_dataset.

Primary key: rec_id (autoincrement).
Edit/Create allowed. Delete NOT allowed.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.filter_parser import ParsedFilter, build_where

EDITABLE_COLUMNS: tuple[str, ...] = (
    "ppi_state", "ppi_detail", "ppi_summary",
    "cell_size_limit", "export_detail",
)

SORTABLE_COLUMNS: frozenset[str] = frozenset({
    "rec_id", "customer_code", "customer_name", "ppi_state",
    "ppi_detail", "ppi_summary",
    "cell_size_limit", "export_detail",
    "create_date", "modify_date",
})

FILTERABLE_COLUMNS: frozenset[str] = SORTABLE_COLUMNS

_LIST_COLUMNS = """
    p.rec_id, p.customer_code, c.customer_name AS customer_name,
    p.ppi_state, p.ppi_detail, p.ppi_summary,
    p.cell_size_limit, p.export_detail,
    p.create_date, p.modify_date
""".strip()

# JOIN with aliases — secure.customer has create_date / modify_date
# columns that would collide with secure.ppi_dataset under USING.
_FROM_JOINED = (
    "secure.ppi_dataset AS p "
    "LEFT JOIN secure.customer AS c ON c.customer_code = p.customer_code"
)

# Map filter / sort column names to qualified SQL. See
# customer_dataset_repo._COLUMN_MAP for rationale.
_COLUMN_MAP: dict[str, str] = {
    "rec_id":          "p.rec_id",
    "customer_code":   "p.customer_code",
    "customer_name":   "c.customer_name",
    "ppi_state":       "p.ppi_state",
    "ppi_detail":      "p.ppi_detail",
    "ppi_summary":     "p.ppi_summary",
    "cell_size_limit": "p.cell_size_limit",
    "export_detail":   "p.export_detail",
    "create_date":     "p.create_date",
    "modify_date":     "p.modify_date",
}


def list_ppi_datasets(
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
        sort_sql = _COLUMN_MAP.get(sort_by, f"`{sort_by}`")
        order_sql = f"ORDER BY {sort_sql} {direction}, p.rec_id ASC"
    else:
        order_sql = "ORDER BY p.customer_code ASC, p.ppi_state ASC"

    offset = (page - 1) * page_size
    params["limit"] = page_size
    params["offset"] = offset

    total = int(conn.execute(
        text(f"SELECT COUNT(*) FROM {_FROM_JOINED} {where_sql}"), params
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


def get_ppi_dataset(conn: Connection, rec_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        text(
            f"""
            SELECT {_LIST_COLUMNS}
            FROM   {_FROM_JOINED}
            WHERE  p.rec_id = :rid
            LIMIT  1
            """
        ),
        {"rid": rec_id},
    ).mappings().first()
    return dict(row) if row else None


def create_ppi_dataset(conn: Connection, data: dict[str, Any]) -> int:
    result = conn.execute(
        text(
            """
            INSERT INTO secure.ppi_dataset
                (customer_code, ppi_state, ppi_detail, ppi_summary,
                 cell_size_limit, export_detail, create_date, modify_date)
            VALUES
                (:customer_code, :ppi_state, :ppi_detail, :ppi_summary,
                 :cell_size_limit, :export_detail, NOW(), NOW())
            """
        ),
        {
            "customer_code": data["customer_code"],
            "ppi_state": data["ppi_state"],
            "ppi_detail": data.get("ppi_detail", 1),
            "ppi_summary": data.get("ppi_summary", 1),
            "cell_size_limit": data.get("cell_size_limit", 0),
            "export_detail": data.get("export_detail", "y"),
        },
    )
    return int(result.lastrowid)


def ppi_state_exists(
    conn: Connection, customer_code: int, ppi_state: str
) -> bool:
    """True if this customer already has this claim state. Used to return a
    clear 'already exists' error on create instead of a raw SQL error."""
    row = conn.execute(
        text(
            "SELECT 1 FROM secure.ppi_dataset "
            "WHERE customer_code = :cc AND ppi_state = :st LIMIT 1"
        ),
        {"cc": customer_code, "st": ppi_state},
    ).first()
    return row is not None


def update_ppi_dataset(
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
            f"UPDATE secure.ppi_dataset SET {', '.join(set_clauses)}, "
            f"modify_date = NOW() WHERE rec_id = :rid"
        ),
        params,
    )


def delete_ppi_dataset(conn: Connection, rec_id: int) -> int:
    """Delete a PPI dataset row. Returns rowcount (0 if rec_id was
    already gone, 1 on a normal delete). Matches the shape of
    customer_dataset_repo.delete_customer_dataset.
    """
    result = conn.execute(
        text("DELETE FROM secure.ppi_dataset WHERE rec_id = :rid"),
        {"rid": rec_id},
    )
    return result.rowcount