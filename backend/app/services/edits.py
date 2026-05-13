"""Edit service.

Orchestrates the full update flow for a user-row edit. See the module-level
docstring in the original for phase details; the behavior is unchanged,
only the audit-caller signature simplified (no agent_id).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.db.session import get_connection, get_raw_connection
from app.services import audit
from app.services.edit_registry import (
    EditableColumn,
    Scope,
    get_editable,
    is_editable,
)
from app.services.sync_sql import grants_for_customer, refresh_all

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class RowKey:
    user_id: str
    database_name: str
    customer_code: int


@dataclass
class ChangeImpact:
    column: str
    scope: Scope
    old_value: Any
    new_value: Any
    affected_row_count: int


@dataclass
class ApplyResult:
    applied: list[ChangeImpact]
    refresh_ok: bool = True
    grants_ok: bool = True
    refresh_error: str | None = None
    grants_error: str | None = None


def _validate_changes(changes: dict[str, Any]) -> dict[str, tuple[EditableColumn, Any]]:
    if not changes:
        raise ValueError("No changes provided")

    out: dict[str, tuple[EditableColumn, Any]] = {}
    for name, raw in changes.items():
        if not is_editable(name):
            raise ValueError(f"Column is not editable: {name}")
        spec = get_editable(name)
        try:
            coerced = spec.coerce(raw)
        except ValueError as e:
            raise ValueError(f"{name}: {e}") from e
        out[name] = (spec, coerced)
    return out


def _load_current_row(conn: Connection, key: RowKey) -> dict[str, Any]:
    row = conn.execute(
        text(
            """
            SELECT *
            FROM   secure.user_details_internal_2026
            WHERE  user_id = :uid AND database_name = :db
            LIMIT  1
            """
        ),
        {"uid": key.user_id, "db": key.database_name},
    ).mappings().first()
    if row is None:
        raise LookupError(
            f"User row not found: user_id={key.user_id} "
            f"database_name={key.database_name}"
        )
    if int(row["customer_code"]) != key.customer_code:
        raise LookupError(
            "Row customer_code mismatch — likely stale UI state"
        )
    return dict(row)


def _count_affected(
    conn: Connection, spec: EditableColumn, key: RowKey
) -> int:
    if spec.scope == "user":
        sql = """
            SELECT COUNT(*) FROM secure.user_details_internal_2026
            WHERE user_id = :uid
        """
        params: dict[str, Any] = {"uid": key.user_id}
    elif spec.scope == "customer":
        sql = """
            SELECT COUNT(*) FROM secure.user_details_internal_2026
            WHERE customer_code = :cc
        """
        params = {"cc": key.customer_code}
    else:  # dataset
        sql = """
            SELECT COUNT(*) FROM secure.user_details_internal_2026
            WHERE customer_code = :cc AND database_name = :db
        """
        params = {"cc": key.customer_code, "db": key.database_name}
    return int(conn.execute(text(sql), params).scalar_one())


def preview_changes(key: RowKey, changes: dict[str, Any]) -> list[ChangeImpact]:
    validated = _validate_changes(changes)
    with get_connection() as conn:
        current = _load_current_row(conn, key)
        impacts: list[ChangeImpact] = []
        for name, (spec, new_val) in validated.items():
            impacts.append(
                ChangeImpact(
                    column=name,
                    scope=spec.scope,
                    old_value=current.get(name),
                    new_value=new_val,
                    affected_row_count=_count_affected(conn, spec, key),
                )
            )
    return impacts


def _update_one(
    conn: Connection,
    spec: EditableColumn,
    key: RowKey,
    new_value: Any,
) -> None:
    if spec.scope == "user":
        where = "WHERE user_id = :uid"
        params: dict[str, Any] = {"uid": key.user_id}
    elif spec.scope == "customer":
        where = "WHERE customer_code = :cc"
        params = {"cc": key.customer_code}
    else:
        where = "WHERE customer_code = :cc AND database_name = :db"
        params = {"cc": key.customer_code, "db": key.database_name}

    col_sql = spec.column if spec.column.startswith("`") else f"`{spec.column}`"
    sql = f"UPDATE {spec.target_table} SET {col_sql} = :v, modify_date = NOW() {where}"
    params["v"] = new_value
    conn.execute(text(sql), params)


def apply_changes(
    key: RowKey,
    changes: dict[str, Any],
    *,
    user_id: str | None,
    ip: str | None,
) -> ApplyResult:
    validated = _validate_changes(changes)

    applied: list[ChangeImpact] = []
    with get_connection() as conn:
        current = _load_current_row(conn, key)

        for name, (spec, new_val) in validated.items():
            old_val = current.get(name)
            _update_one(conn, spec, key, new_val)
            applied.append(
                ChangeImpact(
                    column=name,
                    scope=spec.scope,
                    old_value=old_val,
                    new_value=new_val,
                    affected_row_count=_count_affected(conn, spec, key),
                )
            )

            audit.record(
                conn,
                user_id=user_id,
                action=f"user.edit.{spec.scope}",
                entity_type=spec.target_table.strip("`"),
                entity_key=f"{key.user_id}|{key.database_name}|{spec.column}",
                before={"column": name, "value": old_val},
                after={"column": name, "value": new_val},
                notes=None,
                ip=ip,
            )

    result = ApplyResult(applied=applied)

    try:
        with get_raw_connection() as conn:
            refresh_all(conn)
    except Exception as e:
        result.refresh_ok = False
        result.refresh_error = str(e)
        log.exception("refresh_all failed post-commit")

    try:
        with get_raw_connection() as conn:
            grants_for_customer(conn, key.customer_code)
    except Exception as e:
        result.grants_ok = False
        result.grants_error = str(e)
        log.exception("grants_for_customer failed post-commit")

    return result
