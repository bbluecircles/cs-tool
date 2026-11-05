"""Append-only audit log writes.

One function. Every call adds exactly one row to ``secure.cs_audit_log``.
Never updates, never deletes.

Agent identity is a plain user_id string — there is no separate CS-agents
table to reference, since CS agents are just main-app users with a
specific customer_code.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

log = logging.getLogger(__name__)


def _default(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, bytes):
        try:
            return obj.decode("utf-8")
        except UnicodeDecodeError:
            return obj.hex()
    return str(obj)


def _dumps(v: Any) -> str | None:
    if v is None:
        return None
    try:
        return json.dumps(v, default=_default, ensure_ascii=False)
    except Exception as e:
        log.warning("audit serialization failed: %s", e)
        return None


def record(
    conn: Connection,
    *,
    user_id: str | None,
    action: str,
    entity_type: str,
    entity_key: str | None = None,
    before: Any = None,
    after: Any = None,
    notes: str | None = None,
    ip: str | None = None,
) -> None:
    """Insert one audit row. Best-effort: never raises."""
    try:
        conn.execute(
            text(
                """
                INSERT INTO secure.cs_audit_log
                    (user_id, action, entity_type,
                     entity_key, before_json, after_json, notes, ip)
                VALUES
                    (:user_id, :action, :entity_type,
                     :entity_key, :before_json, :after_json, :notes, :ip)
                """
            ),
            {
                "user_id": user_id,
                "action": action,
                "entity_type": entity_type,
                "entity_key": entity_key,
                "before_json": _dumps(before),
                "after_json": _dumps(after),
                "notes": notes,
                "ip": ip,
            },
        )
    except Exception as e:
        log.warning("audit insert failed (%s): %s", action, e)
