"""Data access for the ``myuser.cs_agents`` table.

Plain functions over SQLAlchemy Core. Kept deliberately thin — business logic
(password verification, audit log entries) lives in the API layer or dedicated
service modules, not here.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Connection


@dataclass(frozen=True)
class AgentRecord:
    id: int
    username: str
    email: str
    password_hash: str
    display_name: str
    tier: str
    is_active: bool
    last_login_at: datetime | None


def get_by_username(conn: Connection, username: str) -> AgentRecord | None:
    """Case-insensitive lookup. Returns None if not found or inactive.

    Username matching is lower-cased to mirror the legacy behavior in
    AccountController.Login, so a CS agent who types 'Admin' vs 'admin' lands
    on the same row.
    """
    row = conn.execute(
        text(
            """
            SELECT id, username, email, password_hash, display_name, tier,
                   is_active, last_login_at
            FROM   myuser.cs_agents
            WHERE  LOWER(username) = LOWER(:username)
            LIMIT  1
            """
        ),
        {"username": username},
    ).mappings().first()

    if row is None:
        return None

    return AgentRecord(
        id=int(row["id"]),
        username=row["username"],
        email=row["email"],
        password_hash=row["password_hash"],
        display_name=row["display_name"],
        tier=row["tier"],
        is_active=bool(row["is_active"]),
        last_login_at=row["last_login_at"],
    )


def get_by_id(conn: Connection, agent_id: int) -> AgentRecord | None:
    row = conn.execute(
        text(
            """
            SELECT id, username, email, password_hash, display_name, tier,
                   is_active, last_login_at
            FROM   myuser.cs_agents
            WHERE  id = :id
            LIMIT  1
            """
        ),
        {"id": agent_id},
    ).mappings().first()

    if row is None:
        return None

    return AgentRecord(
        id=int(row["id"]),
        username=row["username"],
        email=row["email"],
        password_hash=row["password_hash"],
        display_name=row["display_name"],
        tier=row["tier"],
        is_active=bool(row["is_active"]),
        last_login_at=row["last_login_at"],
    )


def update_password_hash(
    conn: Connection, agent_id: int, new_hash: str
) -> None:
    """Used when argon2 parameters change and we want to upgrade the hash."""
    conn.execute(
        text(
            "UPDATE myuser.cs_agents "
            "SET password_hash = :h "
            "WHERE id = :id"
        ),
        {"h": new_hash, "id": agent_id},
    )


def touch_last_login(conn: Connection, agent_id: int) -> None:
    conn.execute(
        text(
            "UPDATE myuser.cs_agents "
            "SET last_login_at = CURRENT_TIMESTAMP "
            "WHERE id = :id"
        ),
        {"id": agent_id},
    )
