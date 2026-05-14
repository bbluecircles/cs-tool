"""Repository for secure.ppi_dataset.

Primary key: rec_id (autoincrement).
Edit/Create/Delete all allowed.
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
    "rec_id", "customer_code", "ppi_state",
    "ppi_detail", "ppi_summary",
    "cell_size_limit", "export_detail",
    "create_date", "modify_date",
})

FILTERABLE_COLUMNS: frozenset[str] = SORTABLE_COLUMNS

_LIST_COLUMNS = """
    rec_id, customer_code, ppi_state, ppi_detail, ppi_summary,
    cell_size_limit, export_detail, create_date, modify_date
""".strip()


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
        flt_clauses, flt_params = build_where(filters)
        where_clauses.extend(flt_clauses)
        params.update(flt_params)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    if sort_by and sort_by in SORTABLE_COLUMNS:
        direction = "ASC" if sort_dir.lower() != "desc" else "DESC"
        order_sql = f"ORDER BY `{sort_by}` {direction}, rec_id ASC"
    else:
        order_sql = "ORDER BY customer_code ASC, ppi_state ASC"

    offset = (page - 1) * page_size
    params["limit"] = page_size
    params["offset"] = offset

    total = int(conn.execute(
        text(f"SELECT COUNT(*) FROM secure.ppi_dataset {where_sql}"), params
    ).scalar_one())

    rows = [dict(r) for r in conn.execute(
        text(
            f"""
            SELECT {_LIST_COLUMNS}
            FROM   secure.ppi_dataset
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
            FROM   secure.ppi_dataset
            WHERE  rec_id = :rid
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
    """Hard delete. Returns 1 if a row was deleted, 0 otherwise.

    PPI rows aren't joined to individual users the way customer_dataset
    rows are, so there's no per-row user-fanout to warn about. Customer-
    level PPI access is gated by the ``ppiuser`` flag on customer_users,
    which is unaffected by deleting a row here.
    """
    result = conn.execute(
        text("DELETE FROM secure.ppi_dataset WHERE rec_id = :rid"),
        {"rid": rec_id},
    )
    return result.rowcount