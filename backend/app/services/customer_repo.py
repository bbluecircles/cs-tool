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


def next_entity_code(conn: Connection) -> tuple[int | None, int]:
    """Largest existing entity_code (numeric) and the next value (max + 1).

    entity_code is stored as VARCHAR, so a plain MAX() would sort
    lexicographically ("9" > "842"). We CAST to UNSIGNED for a numeric max
    instead. Empty / non-numeric values cast to 0 and are effectively
    ignored. Returns (max_or_None, next); max is None only when the table
    has no rows at all, in which case next is 1.
    """
    max_code = conn.execute(
        text(
            "SELECT MAX(CAST(`entity_code` AS UNSIGNED)) FROM secure.customer"
        )
    ).scalar_one()
    max_int = int(max_code) if max_code is not None else None
    return max_int, (max_int or 0) + 1


def create_customer(conn: Connection, data: dict[str, Any]) -> int:
    """Insert a new customer. customer_code is taken as MAX+1 since the
    schema uses it as a business key rather than AUTO_INCREMENT."""
    customer_code = int(conn.execute(
        text("SELECT COALESCE(MAX(customer_code), 0) + 1 FROM secure.customer")
    ).scalar_one())

    # entity_code auto-increments: when the caller doesn't specify one, it
    # becomes the largest existing entity_code + 1 (computed here at insert
    # time so the stored value is authoritative, not a stale UI preview).
    # An explicit value in the payload is respected (the create form lets
    # the agent override the suggestion).
    entity_code = data.get("entity_code")
    if entity_code is None or entity_code == "":
        _, entity_code = next_entity_code(conn)

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
            # Description was removed from the UI; always store empty.
            "customer_desc": data.get("customer_desc") or "",
            # Hidden in the UI but kept in the DB. Apply the historical
            # defaults so an INSERT with no incoming value still produces
            # a valid row (the schema may have NOT NULL on these).
            "max_bytes": data.get("max_bytes") if data.get("max_bytes") is not None else 24_000_000,
            "five_zip": data.get("5_digit_zip", 1),
            "max_row_cnt": data.get("max_row_cnt") if data.get("max_row_cnt") is not None else 200_000,
        },
    )
    return customer_code


def customer_code_exists(conn: Connection, customer_code: int) -> bool:
    return conn.execute(
        text(
            "SELECT 1 FROM secure.customer WHERE customer_code = :cc LIMIT 1"
        ),
        {"cc": customer_code},
    ).first() is not None


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


# ---------------------------------------------------------------------------
# Changing a customer's code
# ---------------------------------------------------------------------------
# customer_code is the business key, not a surrogate: secure.customer_users,
# secure.customer_dataset and secure.ppi_dataset each carry it as a plain
# column with no DB-level foreign key (see create_user._customer_exists —
# referential integrity is checked in application code, not by the schema).
#
# So renumbering a customer means renumbering those tables in the SAME
# transaction. Skip them and every user and dataset under the customer is
# orphaned: they'd point at a code no customer row has, and the JOINs in
# sync_sql's refresh would silently drop them from the user_details views.
#
# customer_code is NOT in EDITABLE_COLUMNS and deliberately stays out —
# update_customer's generic SET builder has no way to cascade. This is the
# only supported path for a code change.

# (label, table). The label is the key the API/UI reports counts under.
CODE_CHILD_TABLES: tuple[tuple[str, str], ...] = (
    ("customer_users", "secure.customer_users"),
    ("customer_datasets", "secure.customer_dataset"),
    ("ppi_datasets", "secure.ppi_dataset"),
)


class CustomerCodeInUse(ValueError):
    """The requested code already belongs to another customer.

    A subclass of ValueError so callers that only care about "bad request"
    can catch broadly, while the router can answer 409 rather than 422.
    """


def child_row_counts(conn: Connection, customer_code: int) -> dict[str, int]:
    """Rows in each child table pointing at this customer_code.

    Drives the change-code modal's impact summary, so the agent sees how
    much moves with the customer before confirming.
    """
    # Table names come from the hardcoded CODE_CHILD_TABLES tuple, so
    # inlining them is injection-safe; the code itself is parameterized.
    return {
        label: int(conn.execute(
            text(f"SELECT COUNT(*) FROM {table} WHERE customer_code = :cc"),
            {"cc": customer_code},
        ).scalar_one())
        for label, table in CODE_CHILD_TABLES
    }


def change_customer_code(
    conn: Connection, old_code: int, new_code: int
) -> dict[str, int]:
    """Renumber a customer and every row that references it.

    Returns rows affected per table, keyed "customer" plus one entry per
    CODE_CHILD_TABLES label.

    Raises CustomerCodeInUse when new_code is taken, ValueError for any
    other bad request. Everything runs in the caller's transaction, so a
    failure part-way through leaves nothing renumbered.
    """
    if new_code == old_code:
        raise ValueError("The new code is the same as the current one.")
    if new_code < 1:
        raise ValueError("Customer code must be a positive whole number.")
    if not customer_code_exists(conn, old_code):
        raise ValueError(f"Customer {old_code} does not exist.")
    # The friendly guard. It has a TOCTOU window, but customer_code is the
    # primary key, so a code claimed between here and the UPDATE below
    # surfaces as a duplicate-key IntegrityError instead of a silent
    # overwrite — the router maps that to the same 409.
    if customer_code_exists(conn, new_code):
        raise CustomerCodeInUse(
            f"Customer code {new_code} is already in use by another customer."
        )

    # Parent first, so a duplicate fails before any child row is touched.
    affected: dict[str, int] = {
        "customer": conn.execute(
            text(
                "UPDATE secure.customer SET customer_code = :new, "
                "modify_date = NOW() WHERE customer_code = :old"
            ),
            {"new": new_code, "old": old_code},
        ).rowcount or 0
    }
    # Confirm the row actually landed on the requested code before the
    # children chase it. On a non-strict server an out-of-range value is
    # silently clamped to the column's max, which would otherwise commit a
    # code nobody asked for. Raising here rolls the whole thing back.
    if not customer_code_exists(conn, new_code):
        raise ValueError(
            f"The database would not store customer code {new_code} as "
            f"given — it is out of range for the column. Pick a smaller "
            f"number."
        )
    # Children hold customer_code as data, not as a constraint. Their own
    # modify_date is left alone on purpose: nothing about the user or the
    # dataset changed, only the customer they hang off.
    for label, table in CODE_CHILD_TABLES:
        affected[label] = conn.execute(
            text(
                f"UPDATE {table} SET customer_code = :new "
                f"WHERE customer_code = :old"
            ),
            {"new": new_code, "old": old_code},
        ).rowcount or 0
    return affected