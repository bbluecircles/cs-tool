"""Validate CS agent credentials by opening a transient MariaDB connection.

This mirrors the legacy AccountController.Login flow:

  1. Look up the agent's row in user_details_internal_2026 to read
     customer_code, disable, pw_flag.
  2. Enforce gating:
       - row exists
       - disable = 0
       - customer_code = admin_customer_code (settings.admin_customer_code)
  3. If pw_flag = 1, fetch and decrypt the password prefix from
     app_control.app_prefix_linux.pw_prefix and prepend it to the supplied
     password. Otherwise use the supplied password as-is.
  4. Open a SHORT-LIVED MariaDB connection using those credentials. Success
     means the password is valid. Failure = invalid credentials.

We NEVER read or compare ``user_password`` directly — letting MariaDB do the
check keeps plaintext passwords out of our application layer beyond the
single string the agent just typed, and matches the main app's behavior
exactly (so anything that works there works here).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from urllib.parse import quote_plus

import pymysql
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.config import get_settings

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class AgentRow:
    """Shape of a CS-agent identity after credential validation."""
    user_id: str
    customer_code: int
    e_mail: str
    first_name: str
    last_name: str
    is_admin: bool


class InvalidCredentials(Exception):
    """Raised when a login attempt fails for any reason the user should
    not be able to distinguish (bad password, disabled, wrong customer,
    row missing)."""


class LegacyPrefixUnavailable(Exception):
    """Raised when pw_flag=1 but we can't read the password prefix. This is
    a server-side problem, not a user-facing one; caller should log and
    return a generic error."""


# ---------------------------------------------------------------------------
# Step 1 + 2: look up and gate
# ---------------------------------------------------------------------------

def _load_agent_row(conn: Connection, user_id: str) -> dict | None:
    """Return the single user_details_internal_2026 row we need for login
    gating. We take LIMIT 1 because the view has one row per (user_id,
    database_name) but the user-level fields are identical across datasets.
    """
    row = conn.execute(
        text(
            """
            SELECT user_id, customer_code, `disable`, pw_flag,
                   e_mail, first_name, last_name
            FROM   secure.user_details_internal_2026
            WHERE  LOWER(user_id) = LOWER(:uid)
            LIMIT  1
            """
        ),
        {"uid": user_id},
    ).mappings().first()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Step 3: legacy password prefix
# ---------------------------------------------------------------------------

def _fetch_pw_prefix(conn: Connection) -> str:
    """Decrypt and return the legacy password prefix.

    Mirrors this query from AccountController.Login:
        SELECT AES_DECRYPT(app_control.app_prefix_linux.pw_prefix,
                           UNHEX(SHA2('forget1c#', 512)))
          FROM app_control.app_prefix_linux;

    We let MariaDB do the decryption so we don't have to reimplement
    AES_DECRYPT + SHA2 semantics in Python.
    """
    s = get_settings()
    row = conn.execute(
        text(
            """
            SELECT AES_DECRYPT(
                app_control.app_prefix_linux.pw_prefix,
                UNHEX(SHA2(:key, 512))
            ) AS prefix
            FROM app_control.app_prefix_linux
            LIMIT 1
            """
        ),
        {"key": s.legacy_pw_prefix_key},
    ).first()
    if row is None or row[0] is None:
        raise LegacyPrefixUnavailable(
            "app_control.app_prefix_linux returned no prefix"
        )
    raw = row[0]
    if isinstance(raw, bytes):
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as e:
            raise LegacyPrefixUnavailable(
                "decrypted prefix is not valid UTF-8"
            ) from e
    return str(raw)


# ---------------------------------------------------------------------------
# Step 4: connection-as-user probe
# ---------------------------------------------------------------------------

def _try_connect_as(user_id: str, password: str) -> bool:
    """Open and immediately close a MariaDB connection as (user_id, password).
    Return True on success, False on auth failure.

    We use PyMySQL directly rather than SQLAlchemy so we can keep the socket
    open for the shortest possible time and not pollute any connection pool.
    """
    s = get_settings()
    try:
        conn = pymysql.connect(
            host=s.db_host,
            port=s.db_port,
            user=user_id,
            password=password,
            # No default schema — user may not have access to one. We just
            # need the handshake to succeed.
            connect_timeout=5,
            charset="utf8mb4",
        )
    except pymysql.err.OperationalError as e:
        # 1045 = access denied (the expected "wrong password" code).
        # Anything else we treat as auth failure too, but log loudly since
        # it might be a network/DB problem worth investigating.
        code = e.args[0] if e.args else None
        if code != 1045:
            log.warning(
                "mariadb auth probe failed with non-1045 code: %s (%s)",
                code, e,
            )
        return False
    except Exception:
        log.exception("unexpected error during mariadb auth probe")
        return False
    else:
        try:
            conn.close()
        except Exception:
            pass
        return True


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

def validate_login(
    svc_conn: Connection, *, user_id: str, password: str
) -> AgentRow:
    """Validate credentials + admin eligibility. Raises InvalidCredentials
    on any failure that should look identical to the end user.

    ``svc_conn`` is a connection on the service account used ONLY for the
    lookup and (if needed) the prefix fetch. The actual password check
    opens its own connection as the user.
    """
    settings = get_settings()

    row = _load_agent_row(svc_conn, user_id)
    if row is None:
        raise InvalidCredentials("no such user")
    if int(row["disable"]) != 0:
        raise InvalidCredentials("account disabled")
    if int(row["customer_code"]) not in settings.admin_customer_code_set:
        # Valid main-app user, but not a CS agent.
        raise InvalidCredentials("not authorized for CS tool")

    # Resolve the effective password (prefix or not).
    pw_flag = int(row.get("pw_flag") or 0)
    if pw_flag == 1:
        try:
            prefix = _fetch_pw_prefix(svc_conn)
        except LegacyPrefixUnavailable:
            log.exception("pw_flag=1 but prefix unavailable for user=%s", user_id)
            # Don't leak internals; look like a bad password.
            raise InvalidCredentials("prefix unavailable")
        effective_password = prefix + password
    else:
        effective_password = password

    if not _try_connect_as(row["user_id"], effective_password):
        raise InvalidCredentials("bad password")

    return AgentRow(
        user_id=row["user_id"],
        customer_code=int(row["customer_code"]),
        e_mail=row["e_mail"],
        first_name=row["first_name"],
        last_name=row["last_name"],
        is_admin=True,  # already verified customer_code = admin_customer_code
    )


def load_agent(svc_conn: Connection, user_id: str) -> AgentRow | None:
    """Re-load an agent by user_id WITHOUT a password check. Used on
    token-refresh and /auth/me to confirm the agent is still authorized.
    Returns None if the agent is no longer a valid admin.
    """
    settings = get_settings()
    row = _load_agent_row(svc_conn, user_id)
    if row is None:
        return None
    if int(row["disable"]) != 0:
        return None
    if int(row["customer_code"]) not in settings.admin_customer_code_set:
        return None
    return AgentRow(
        user_id=row["user_id"],
        customer_code=int(row["customer_code"]),
        e_mail=row["e_mail"],
        first_name=row["first_name"],
        last_name=row["last_name"],
        is_admin=True,
    )
