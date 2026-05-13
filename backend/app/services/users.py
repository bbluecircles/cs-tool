"""Data access for the user-details view.

Reads go against ``secure.user_details_internal_2026`` — the denormalized,
joined view that is already the source of truth for the main app's login
flow. This module never reads passwords on the list path; there's a
separate method for password reveals that the audit layer wraps.

SQL injection surface: dynamic WHERE and ORDER BY. We handle the WHERE side
with parameter binding (no string interpolation of values) and the ORDER BY
side with a strict whitelist of column names.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

# --- Sort whitelist ----------------------------------------------------------
# Keep this small. These are the columns CS is likely to sort by in practice.
# Adding a new column requires appearing here and in the UserRow schema.
SORTABLE_COLUMNS: frozenset[str] = frozenset({
    "user_id",
    "e_mail",
    "first_name",
    "last_name",
    "customer_code",
    "customer_name",
    "database_name",
    "disable",
    "create_date",
    "modify_date",
})

# Columns searched by the free-text ``search`` parameter.
SEARCH_COLUMNS: tuple[str, ...] = (
    "user_id",
    "e_mail",
    "first_name",
    "last_name",
    "customer_name",
)

# Every projected column on the list endpoint. We spell them out instead of
# SELECT * so a schema drift on the DB side surfaces as a clear error rather
# than a silently-widening response.
_LIST_COLUMNS = """
    user_id, database_name, customer_code, customer_name, entity_code,
    e_mail, first_name, last_name, `disable`, pw_flag,
    sg2, sg2_op, inpatient, outpatient, ed, claritas_flag, claritas_state,
    prism_flag, projection_flag, cms_states, transfers_flag, dataset_type,
    cell_size_limit, export_detail, aprdrg_flag, export_flag,
    export_row_limit, webapp_flag,
    logging_flag, esri_access, esri_tap_access, esri_state, webuser,
    ppiuser, mapping, user_priority, max_birt_processes, ppi_detail_user,
    web_esri_access, web_esri_tap_access, web_inpatient_access,
    web_outpatient_access, web_ed_access, web_claims_access,
    max_bytes, `5_digit_zip`, max_row_cnt,
    create_date, modify_date
""".strip()


def list_users(
    conn: Connection,
    *,
    page: int,
    page_size: int,
    search: str | None = None,
    customer_code: int | None = None,
    database_name: str | None = None,
    disable: int | None = None,
    sort_by: str | None = None,
    sort_dir: str = "asc",
) -> tuple[list[dict[str, Any]], int]:
    """Return (rows, total_count) for the requested page.

    Two queries intentionally — one for COUNT(*) and one for the page. We
    run them in a single connection/transaction so they see the same
    snapshot.
    """
    where_clauses: list[str] = []
    params: dict[str, Any] = {}

    if search:
        like = f"%{search}%"
        parts = []
        for i, col in enumerate(SEARCH_COLUMNS):
            key = f"search_{i}"
            parts.append(f"`{col}` LIKE :{key}")
            params[key] = like
        where_clauses.append("(" + " OR ".join(parts) + ")")

    if customer_code is not None:
        where_clauses.append("customer_code = :customer_code")
        params["customer_code"] = customer_code

    if database_name is not None:
        where_clauses.append("database_name = :database_name")
        params["database_name"] = database_name

    if disable is not None:
        where_clauses.append("`disable` = :disable")
        params["disable"] = disable

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    # ORDER BY — strict whitelist. Default ordering gives CS agents a stable,
    # alphabetical view that matches what they're used to from SQL clients.
    if sort_by and sort_by in SORTABLE_COLUMNS:
        direction = "ASC" if sort_dir.lower() != "desc" else "DESC"
        order_sql = f"ORDER BY `{sort_by}` {direction}, user_id ASC, database_name ASC"
    else:
        order_sql = "ORDER BY user_id ASC, database_name ASC"

    offset = (page - 1) * page_size
    params["limit"] = page_size
    params["offset"] = offset

    count_sql = f"""
        SELECT COUNT(*) AS c
        FROM   secure.user_details_internal_2026
        {where_sql}
    """
    total = int(
        conn.execute(text(count_sql), params).scalar_one()
    )

    rows_sql = f"""
        SELECT {_LIST_COLUMNS}
        FROM   secure.user_details_internal_2026
        {where_sql}
        {order_sql}
        LIMIT  :limit OFFSET :offset
    """
    rows = [
        dict(r) for r in conn.execute(text(rows_sql), params).mappings().all()
    ]
    return rows, total


def get_password(
    conn: Connection, *, user_id: str, database_name: str
) -> str | None:
    """Return plaintext password for a single (user_id, database_name).

    The view stores it plaintext (legacy schema); we only read it, and only
    when the API layer has decided the reveal is authorized and logged.
    """
    row = conn.execute(
        text(
            """
            SELECT user_password
            FROM   secure.user_details_internal_2026
            WHERE  user_id = :user_id
              AND  database_name = :database_name
            LIMIT  1
            """
        ),
        {"user_id": user_id, "database_name": database_name},
    ).mappings().first()

    return row["user_password"] if row else None


def list_customers_brief(conn: Connection) -> list[dict[str, Any]]:
    """Distinct customer_code/customer_name pairs — for the filter dropdown.

    Comes from the same view so the filter only offers customers that
    actually have users in it.
    """
    return [
        dict(r)
        for r in conn.execute(
            text(
                """
                SELECT DISTINCT customer_code, customer_name
                FROM   secure.user_details_internal_2026
                ORDER  BY customer_name
                """
            )
        ).mappings().all()
    ]


def list_databases_brief(conn: Connection) -> list[str]:
    """Distinct database_name values — for the filter dropdown."""
    return [
        r[0]
        for r in conn.execute(
            text(
                """
                SELECT DISTINCT database_name
                FROM   secure.user_details_internal_2026
                ORDER  BY database_name
                """
            )
        ).all()
    ]
