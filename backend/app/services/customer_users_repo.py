"""Repository for secure.customer_users.

Composite primary key: (user_id, customer_code).
Edit/Create allowed. Delete NOT allowed.

user_password is stored plaintext in the underlying schema (legacy). We
NEVER return it on the list endpoint; a separate reveal endpoint handles
that with audit logging. user_password is also DELIBERATELY excluded from
FILTERABLE_COLUMNS — we don't want filter strings carrying password
fragments to land in HTTP access logs.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.filter_parser import ParsedFilter, build_where

EDITABLE_COLUMNS: tuple[str, ...] = (
    "e_mail", "first_name", "last_name",
    "disable", "user_password", "pw_flag", "logging_flag",
    "esri_access", "esri_tap_access", "esri_state",
    "webuser", "ppiuser", "mapping", "user_priority",
    "max_birt_processes", "ppi_detail_user",
    "web_esri_access", "web_esri_tap_access",
    "web_inpatient_access", "web_outpatient_access",
    "web_ed_access", "web_claims_access",
)

# Every projected column is sortable.
SORTABLE_COLUMNS: frozenset[str] = frozenset({
    "user_id", "customer_code", "e_mail", "disable",
    "first_name", "last_name", "pw_flag", "logging_flag",
    "esri_access", "esri_tap_access", "esri_state",
    "webuser", "ppiuser", "mapping", "user_priority",
    "max_birt_processes", "ppi_detail_user",
    "web_esri_access", "web_esri_tap_access",
    "web_inpatient_access", "web_outpatient_access",
    "web_ed_access", "web_claims_access",
    "create_date", "modify_date",
})

# Same set — minus nothing today, but the password column was never on
# the SELECT list so it's already absent.
FILTERABLE_COLUMNS: frozenset[str] = SORTABLE_COLUMNS

_LIST_COLUMNS = """
    user_id, customer_code, e_mail, `disable`, first_name, last_name,
    pw_flag, logging_flag,
    esri_access, esri_tap_access, esri_state,
    webuser, ppiuser, mapping, user_priority,
    max_birt_processes, ppi_detail_user,
    web_esri_access, web_esri_tap_access,
    web_inpatient_access, web_outpatient_access,
    web_ed_access, web_claims_access,
    create_date, modify_date
""".strip()


def list_customer_users(
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
        order_sql = f"ORDER BY `{sort_by}` {direction}, user_id ASC"
    else:
        order_sql = "ORDER BY user_id ASC"

    offset = (page - 1) * page_size
    params["limit"] = page_size
    params["offset"] = offset

    total = int(conn.execute(
        text(f"SELECT COUNT(*) FROM secure.customer_users {where_sql}"), params
    ).scalar_one())

    rows = [dict(r) for r in conn.execute(
        text(
            f"""
            SELECT {_LIST_COLUMNS}
            FROM   secure.customer_users
            {where_sql}
            {order_sql}
            LIMIT  :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()]
    return rows, total


def get_customer_user(
    conn: Connection, user_id: str, customer_code: int
) -> dict[str, Any] | None:
    row = conn.execute(
        text(
            f"""
            SELECT {_LIST_COLUMNS}
            FROM   secure.customer_users
            WHERE  user_id = :uid AND customer_code = :cc
            LIMIT  1
            """
        ),
        {"uid": user_id, "cc": customer_code},
    ).mappings().first()
    return dict(row) if row else None


def get_password(
    conn: Connection, user_id: str, customer_code: int
) -> str | None:
    """Read the plaintext password for a single (user_id, customer_code).

    Reads from the canonical customer_users table directly rather than the
    denormalized view, so the value is always current regardless of whether
    view refreshes are running.
    """
    row = conn.execute(
        text(
            """
            SELECT user_password
            FROM   secure.customer_users
            WHERE  user_id = :uid AND customer_code = :cc
            LIMIT  1
            """
        ),
        {"uid": user_id, "cc": customer_code},
    ).mappings().first()
    return row["user_password"] if row else None


def user_id_available(conn: Connection, user_id: str) -> bool:
    """user_id is the MariaDB username, so we forbid global collision across
    all customers even though the PK is composite."""
    row = conn.execute(
        text("SELECT 1 FROM secure.customer_users WHERE user_id = :uid LIMIT 1"),
        {"uid": user_id},
    ).first()
    return row is None


def create_customer_user(conn: Connection, data: dict[str, Any]) -> None:
    """Insert a new customer_user. Caller is responsible for pre-checking
    user_id_available() and for ensuring customer_code references an
    existing customer."""
    conn.execute(
        text(
            """
            INSERT INTO secure.customer_users
                (user_id, customer_code, e_mail, `disable`,
                 first_name, last_name,
                 user_password, pw_flag, logging_flag,
                 esri_access, esri_tap_access, esri_state,
                 webuser, ppiuser, mapping, user_priority,
                 max_birt_processes, ppi_detail_user,
                 web_esri_access, web_esri_tap_access,
                 web_inpatient_access, web_outpatient_access,
                 web_ed_access, web_claims_access,
                 create_date, modify_date)
            VALUES
                (:user_id, :customer_code, :e_mail, :disable,
                 :first_name, :last_name,
                 :user_password, :pw_flag, :logging_flag,
                 :esri_access, :esri_tap_access, :esri_state,
                 :webuser, :ppiuser, :mapping, :user_priority,
                 :max_birt_processes, :ppi_detail_user,
                 :web_esri_access, :web_esri_tap_access,
                 :web_inpatient_access, :web_outpatient_access,
                 :web_ed_access, :web_claims_access,
                 NOW(), NOW())
            """
        ),
        {
            "user_id": data["user_id"],
            "customer_code": data["customer_code"],
            "e_mail": data.get("e_mail"),
            "disable": data.get("disable", 0),
            "first_name": data.get("first_name"),
            "last_name": data.get("last_name"),
            "user_password": data.get("user_password"),
            "pw_flag": data.get("pw_flag", 0),
            "logging_flag": data.get("logging_flag", 0),
            "esri_access": data.get("esri_access", 0),
            "esri_tap_access": data.get("esri_tap_access", 0),
            "esri_state": data.get("esri_state", ""),
            "webuser": data.get("webuser", 1),
            "ppiuser": data.get("ppiuser", 0),
            "mapping": data.get("mapping", 0),
            "user_priority": data.get("user_priority", 1),
            "max_birt_processes": data.get("max_birt_processes", 1),
            "ppi_detail_user": data.get("ppi_detail_user", 0),
            "web_esri_access": data.get("web_esri_access", 0),
            "web_esri_tap_access": data.get("web_esri_tap_access", 0),
            "web_inpatient_access": data.get("web_inpatient_access", 0),
            "web_outpatient_access": data.get("web_outpatient_access", 0),
            "web_ed_access": data.get("web_ed_access", 0),
            "web_claims_access": data.get("web_claims_access", 0),
        },
    )


def update_customer_user(
    conn: Connection,
    user_id: str,
    customer_code: int,
    changes: dict[str, Any],
) -> None:
    if not changes:
        return
    bad = set(changes.keys()) - set(EDITABLE_COLUMNS)
    if bad:
        raise ValueError(f"non-editable columns: {sorted(bad)}")

    set_clauses: list[str] = []
    params: dict[str, Any] = {"uid": user_id, "cc": customer_code}
    for i, (col, val) in enumerate(changes.items()):
        key = f"v{i}"
        set_clauses.append(f"`{col}` = :{key}")
        params[key] = val

    conn.execute(
        text(
            f"UPDATE secure.customer_users SET {', '.join(set_clauses)}, "
            f"modify_date = NOW() "
            f"WHERE user_id = :uid AND customer_code = :cc"
        ),
        params,
    )