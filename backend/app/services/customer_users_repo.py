"""Repository for secure.customer_users.

Composite primary key: (user_id, customer_code).
Edit/Create allowed. Delete NOT allowed.

user_password is stored plaintext in the underlying schema (legacy). We
NEVER return it on the list endpoint; a separate reveal endpoint handles
that with audit logging. user_password is also DELIBERATELY excluded from
FILTERABLE_COLUMNS — we don't want filter strings carrying password
fragments to land in HTTP access logs.

ESRI_ACCESS_NOTE
----------------
Two columns look like they control ESRI, and only one of them does
anything at the database level:

  * ``esri_access``     — the ONLY input to the MariaDB grant. The
                          generator in sync_sql reads
                          ``WHERE ... AND esri_access = 1`` and emits
                          ``GRANT SELECT ON `esri`.*``. Matches the DBA's
                          reference grant script.
  * ``web_esri_access`` — a web-app feature flag. It appears in the
                          refresh SELECT lists and NOWHERE in any grant
                          generator, so on its own it grants nothing.

The Users tab only ever exposed "Web ESRI"; ``esri_access`` is hidden in
resourceConfigs.ts. Agents turned on the visible flag, reasonably assumed
ESRI was granted, and the privilege was never issued — users then got
"no permissions for ESRI" from the app.

So writes here keep ``esri_access`` in step with ``web_esri_access``, in
both directions. Mirroring only the on-direction would strand the flag
permanently on, since nothing in the UI can turn the hidden column back
off. An explicit ``esri_access`` in the payload still wins.

Existing rows are corrected by db/migrations/002_esri_access_backfill.sql.
Note that ``esri_state`` is a separate concern: it scopes WHICH states the
user sees and is NOT part of the grant, so enabling access without setting
it can still leave the user with an empty list.
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

# Every projected column is sortable. customer_name comes from the JOIN to
# secure.customer (see _FROM_JOINED / _COLUMN_MAP).
SORTABLE_COLUMNS: frozenset[str] = frozenset({
    "user_id", "customer_code", "customer_name", "e_mail", "disable",
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

# customer_name is projected from secure.customer via the JOIN below. Both
# tables carry customer_code / create_date / modify_date, so we alias both
# and qualify every reference. The filter pipeline uses _COLUMN_MAP via
# build_where(column_map=...) so WHERE clauses come back already qualified.
_LIST_COLUMNS = """
    cu.user_id, cu.customer_code, c.customer_name AS customer_name,
    cu.e_mail, cu.`disable`, cu.first_name, cu.last_name,
    cu.pw_flag, cu.logging_flag,
    cu.esri_access, cu.esri_tap_access, cu.esri_state,
    cu.webuser, cu.ppiuser, cu.mapping, cu.user_priority,
    cu.max_birt_processes, cu.ppi_detail_user,
    cu.web_esri_access, cu.web_esri_tap_access,
    cu.web_inpatient_access, cu.web_outpatient_access,
    cu.web_ed_access, cu.web_claims_access,
    cu.create_date, cu.modify_date
""".strip()


# JOIN with explicit aliases. LEFT JOIN so a user whose customer row is
# somehow missing still appears (customer_name comes back NULL).
_FROM_JOINED = (
    "secure.customer_users AS cu "
    "LEFT JOIN secure.customer AS c ON c.customer_code = cu.customer_code"
)


# Logical column name → qualified SQL. Passed to build_where so WHERE
# clauses are unambiguous, and used to qualify ORDER BY. customer_code /
# create_date / modify_date exist on BOTH tables, so qualifying them is
# required, not optional.
_COLUMN_MAP: dict[str, str] = {
    "user_id":               "cu.user_id",
    "customer_code":         "cu.customer_code",
    "customer_name":         "c.customer_name",
    "e_mail":                "cu.e_mail",
    "disable":               "cu.`disable`",
    "first_name":            "cu.first_name",
    "last_name":             "cu.last_name",
    "pw_flag":               "cu.pw_flag",
    "logging_flag":          "cu.logging_flag",
    "esri_access":           "cu.esri_access",
    "esri_tap_access":       "cu.esri_tap_access",
    "esri_state":            "cu.esri_state",
    "webuser":               "cu.webuser",
    "ppiuser":               "cu.ppiuser",
    "mapping":               "cu.mapping",
    "user_priority":         "cu.user_priority",
    "max_birt_processes":    "cu.max_birt_processes",
    "ppi_detail_user":       "cu.ppi_detail_user",
    "web_esri_access":       "cu.web_esri_access",
    "web_esri_tap_access":   "cu.web_esri_tap_access",
    "web_inpatient_access":  "cu.web_inpatient_access",
    "web_outpatient_access": "cu.web_outpatient_access",
    "web_ed_access":         "cu.web_ed_access",
    "web_claims_access":     "cu.web_claims_access",
    "create_date":           "cu.create_date",
    "modify_date":           "cu.modify_date",
}


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
        flt_clauses, flt_params = build_where(filters, column_map=_COLUMN_MAP)
        where_clauses.extend(flt_clauses)
        params.update(flt_params)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    if sort_by and sort_by in SORTABLE_COLUMNS:
        direction = "ASC" if sort_dir.lower() != "desc" else "DESC"
        sort_sql = _COLUMN_MAP.get(sort_by, f"`{sort_by}`")
        order_sql = f"ORDER BY {sort_sql} {direction}, cu.user_id ASC"
    else:
        order_sql = "ORDER BY cu.user_id ASC"

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


def get_customer_user(
    conn: Connection, user_id: str, customer_code: int
) -> dict[str, Any] | None:
    row = conn.execute(
        text(
            f"""
            SELECT {_LIST_COLUMNS}
            FROM   {_FROM_JOINED}
            WHERE  cu.user_id = :uid AND cu.customer_code = :cc
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
            "pw_flag": data.get("pw_flag", 1),
            "logging_flag": data.get("logging_flag", 0),
            # esri_access mirrors web_esri_access unless explicitly given.
            # See ESRI_ACCESS_NOTE below — the UI only exposes the "Web
            # ESRI" flag, but the MariaDB `esri` grant keys off this one.
            "esri_access": data.get(
                "esri_access", data.get("web_esri_access", 0)
            ),
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

    # Stamp/clear disable_date whenever the disable flag is toggled.
    # Disabling (1) records when it happened; re-enabling (0) clears the
    # stale date so disable_date always reflects the current disable state.
    if "disable" in changes:
        try:
            disabling = int(changes["disable"]) == 1
        except (TypeError, ValueError):
            disabling = bool(changes["disable"])
        set_clauses.append(
            "`disable_date` = NOW()" if disabling else "`disable_date` = NULL"
        )

    # Keep esri_access in step with web_esri_access. See ESRI_ACCESS_NOTE.
    # Skipped when the caller set esri_access explicitly — an API client
    # that names both columns means what it says, and appending a second
    # assignment for the same column would be sloppy SQL.
    if "web_esri_access" in changes and "esri_access" not in changes:
        try:
            enabling = int(changes["web_esri_access"]) == 1
        except (TypeError, ValueError):
            enabling = bool(changes["web_esri_access"])
        set_clauses.append("`esri_access` = :esri_mirror")
        params["esri_mirror"] = 1 if enabling else 0

    conn.execute(
        text(
            f"UPDATE secure.customer_users SET {', '.join(set_clauses)}, "
            f"modify_date = NOW() "
            f"WHERE user_id = :uid AND customer_code = :cc"
        ),
        params,
    )


# ---------------------------------------------------------------------------
# Reassigning a user to a different customer
# ---------------------------------------------------------------------------
# customer_code is half the composite PK, so this can't ride the generic
# update_customer_user path (customer_code is not in EDITABLE_COLUMNS and
# stays out on purpose). It gets its own function and its own endpoint.
#
# It stays a single UPDATE, though: user_id is globally unique across all
# customers (see user_id_available), so a user has exactly ONE row here.
# Nothing else keys off (user_id, customer_code) — the discharge and claim
# datasets hang off the CUSTOMER, not the user, so they stay put. The user
# simply inherits whatever datasets the new customer has.


class UserAlreadyAssigned(ValueError):
    """A row for this user already exists under the target customer.

    Can't happen while user_id stays globally unique, but the PK is
    composite so the collision is representable. A subclass of ValueError
    so broad handlers still catch it, while the router can answer 409.
    """


def _customer_exists(conn: Connection, customer_code: int) -> bool:
    """Same check create_user._customer_exists does — referential integrity
    for customer_code is enforced in application code, not by the schema."""
    return conn.execute(
        text("SELECT 1 FROM secure.customer WHERE customer_code = :cc LIMIT 1"),
        {"cc": customer_code},
    ).first() is not None


def move_customer_user(
    conn: Connection, user_id: str, old_code: int, new_code: int
) -> None:
    """Reassign one user to a different customer.

    Raises UserAlreadyAssigned if the target row already exists, or
    ValueError for any other bad request. Runs in the caller's transaction.
    """
    if new_code == old_code:
        raise ValueError("That user is already assigned to this customer.")
    if not _customer_exists(conn, new_code):
        raise ValueError(f"Customer {new_code} does not exist.")
    # Friendly pre-check; the composite PK is the real guarantee, so a row
    # created in the meantime surfaces as a duplicate-key IntegrityError
    # that the router maps to the same 409.
    if get_customer_user(conn, user_id, new_code) is not None:
        raise UserAlreadyAssigned(
            f"User '{user_id}' already has a row under customer {new_code}."
        )

    conn.execute(
        text(
            "UPDATE secure.customer_users "
            "SET customer_code = :new, modify_date = NOW() "
            "WHERE user_id = :uid AND customer_code = :old"
        ),
        {"new": new_code, "old": old_code, "uid": user_id},
    )