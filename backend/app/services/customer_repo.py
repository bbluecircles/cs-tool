"""Repository for secure.customer.

Primary key: customer_code (int, business key — NOT autoincrement).
Edit/Create allowed. Delete NOT allowed.

All non-timestamp columns are now sortable and filterable. The repo
defines two allowlists:
  - SORTABLE_COLUMNS  — column names accepted by sort_by
  - FILTERABLE_COLUMNS — column names accepted by filter=col:op:val

Both default to the same set; we keep them as separate names because
filter and sort have different downstream semantics and a future column
might be one but not the other.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.filter_parser import (
    ParsedFilter,
    build_where,
)

EDITABLE_COLUMNS: tuple[str, ...] = (
    "customer_name",
    "entity_code",
    "state",
    "customer_desc",
    "cancelled_date",
    "max_bytes",
    "5_digit_zip",
    "max_row_cnt",
)

# Every persisted column is sortable. Adding a new column = one entry here
# (and the repo's SELECT list) — same on the frontend's resourceConfigs.ts.
SORTABLE_COLUMNS: frozenset[str] = frozenset({
    "customer_code", "customer_name", "entity_code",
    "state", "customer_desc",
    "max_bytes", "5_digit_zip", "max_row_cnt",
    "create_date", "modify_date", "cancelled_date",
})

# Same set today. Kept distinct so a future column can be sortable but
# not filterable (e.g. computed columns) without a refactor.
FILTERABLE_COLUMNS: frozenset[str] = SORTABLE_COLUMNS


def list_customers(
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

    # Per-column filters. Caller has already validated columns/operators
    # against FILTERABLE_COLUMNS via the parser.
    if filters:
        flt_clauses, flt_params = build_where(filters)
        where_clauses.extend(flt_clauses)
        params.update(flt_params)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    if sort_by and sort_by in SORTABLE_COLUMNS:
        direction = "ASC" if sort_dir.lower() != "desc" else "DESC"
        # Backtick to handle column names starting with digit (5_digit_zip).
        order_sql = f"ORDER BY `{sort_by}` {direction}, customer_code ASC"
    else:
        order_sql = "ORDER BY customer_code ASC"

    offset = (page - 1) * page_size
    params["limit"] = page_size
    params["offset"] = offset

    total = int(conn.execute(
        text(f"SELECT COUNT(*) FROM secure.customer {where_sql}"), params
    ).scalar_one())

    rows = [dict(r) for r in conn.execute(
        text(
            f"""
            SELECT customer_code, customer_name, entity_code,
                   state, customer_desc,
                   max_bytes, `5_digit_zip`, max_row_cnt,
                   create_date, modify_date, cancelled_date
            FROM   secure.customer
            {where_sql}
            {order_sql}
            LIMIT  :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()]
    return rows, total


def get_customer(conn: Connection, customer_code: int) -> dict[str, Any] | None:
    row = conn.execute(
        text(
            """
            SELECT customer_code, customer_name, entity_code,
                   state, customer_desc,
                   max_bytes, `5_digit_zip`, max_row_cnt,
                   create_date, modify_date, cancelled_date
            FROM   secure.customer
            WHERE  customer_code = :cc
            LIMIT  1
            """
        ),
        {"cc": customer_code},
    ).mappings().first()
    return dict(row) if row else None


def create_customer(conn: Connection, data: dict[str, Any]) -> int:
    """Insert a new customer. customer_code is taken as MAX+1 since the
    schema uses it as a business key rather than AUTO_INCREMENT."""
    customer_code = int(conn.execute(
        text("SELECT COALESCE(MAX(customer_code), 0) + 1 FROM secure.customer")
    ).scalar_one())

    # entity_code defaults to customer_code when the caller doesn't
    # specify one. This matches the convention in the existing data:
    # most customers are their own entity, and cross-customer sharing is
    # the exception (handled by explicitly setting entity_code to an
    # existing bucket).
    entity_code = data.get("entity_code")
    if entity_code is None:
        entity_code = customer_code

    conn.execute(
        text(
            """
            INSERT INTO secure.customer
                (customer_code, customer_name, entity_code,
                 state, customer_desc,
                 max_bytes, `5_digit_zip`, max_row_cnt,
                 create_date, modify_date)
            VALUES
                (:customer_code, :customer_name, :entity_code,
                 :state, :customer_desc,
                 :max_bytes, :five_zip, :max_row_cnt,
                 NOW(), NOW())
            """
        ),
        {
            "customer_code": customer_code,
            "customer_name": data.get("customer_name"),
            "entity_code": entity_code,
            "state": data.get("state"),
            "customer_desc": data.get("customer_desc"),
            # Hidden in the UI but kept in the DB. Apply the historical
            # defaults so an INSERT with no incoming value still produces
            # a valid row (the schema may have NOT NULL on these).
            "max_bytes": data.get("max_bytes") if data.get("max_bytes") is not None else 24_000_000,
            "five_zip": data.get("5_digit_zip", 1),
            "max_row_cnt": data.get("max_row_cnt") if data.get("max_row_cnt") is not None else 200_000,
        },
    )
    return customer_code


def update_customer(
    conn: Connection, customer_code: int, changes: dict[str, Any]
) -> None:
    if not changes:
        return
    bad = set(changes.keys()) - set(EDITABLE_COLUMNS)
    if bad:
        raise ValueError(f"non-editable columns: {sorted(bad)}")

    set_clauses: list[str] = []
    params: dict[str, Any] = {"cc": customer_code}
    for i, (col, val) in enumerate(changes.items()):
        key = f"v{i}"
        set_clauses.append(f"`{col}` = :{key}")
        params[key] = val

    conn.execute(
        text(
            f"UPDATE secure.customer SET {', '.join(set_clauses)}, "
            f"modify_date = NOW() WHERE customer_code = :cc"
        ),
        params,
    )