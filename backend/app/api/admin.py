"""Admin endpoints.

  POST /api/admin/retry-refresh              run refresh_all (only if enabled)
  POST /api/admin/retry-grants/{customer}    run grants for one customer
  POST /api/admin/retry-revokes/{customer}   REVOKE all privileges for one customer
  GET  /api/admin/audit                      recent audit log entries

Under the current architecture CS agents trigger grants explicitly from
the Admin tab after creating or editing users. refresh_all is normally
handled by an external process; the retry-refresh endpoint is kept for
completeness but refuses to run when ENABLE_VIEW_REFRESH is false.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import require_admin
from app.core.config import get_settings
from app.db.session import get_connection, get_raw_connection
from app.schemas.auth import CurrentAgent
from app.services import audit
from app.services.sync_sql import (
    RefreshDisabled,
    grants_for_customer,
    refresh_all,
    revokes_for_customer,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class RetryResponse(BaseModel):
    ok: bool
    error: str | None = None
    statement_count: int | None = None
    # True if the endpoint declined to run because of config.
    disabled: bool = False
    # When the grants endpoint also runs a refresh first, these record
    # what happened. Unused by retry-refresh (which IS the refresh).
    refresh_status: Literal["skipped_disabled", "succeeded", "failed"] | None = None
    refresh_error: str | None = None


@router.post("/retry-refresh", response_model=RetryResponse)
def retry_refresh(
    request: Request,
    agent: Annotated[CurrentAgent, Depends(require_admin)],
) -> RetryResponse:
    settings = get_settings()
    if not settings.enable_view_refresh:
        return RetryResponse(
            ok=False,
            disabled=True,
            error="View refresh is disabled via ENABLE_VIEW_REFRESH=false.",
        )
    try:
        with get_raw_connection() as conn:
            refresh_all(conn)
    except RefreshDisabled as e:
        return RetryResponse(ok=False, disabled=True, error=str(e))
    except Exception as e:
        log.exception("retry-refresh failed")
        with get_connection() as conn:
            audit.record(
                conn,
                user_id=agent.user_id,
                action="admin.retry_refresh.failed",
                entity_type="sync",
                notes=str(e),
                ip=_client_ip(request),
            )
        return RetryResponse(ok=False, error=str(e))

    with get_connection() as conn:
        audit.record(
            conn,
            user_id=agent.user_id,
            action="admin.retry_refresh",
            entity_type="sync",
            ip=_client_ip(request),
        )
    return RetryResponse(ok=True)


@router.post(
    "/retry-grants/{customer_code}", response_model=RetryResponse
)
def retry_grants(
    customer_code: int,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(require_admin)],
) -> RetryResponse:
    """Run grants for a customer, refreshing the user_details views first.

    The grants generators read from secure.user_details_internal_2026 and
    myuser.user_details_2026 — both denormalized tables populated by the
    refresh. Without a fresh refresh, a customer/user/dataset created
    moments ago is invisible to the grants step and the endpoint returns
    "0 statements applied" with no error, which is a foot-gun.

    On the cs-tool deployment there's no external process refreshing
    these tables, so we run refresh_all unconditionally here, ignoring
    the ENABLE_VIEW_REFRESH flag. (The flag still gates the standalone
    POST /retry-refresh endpoint, but in practice this is the only place
    that matters.)
    """
    if customer_code < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="customer_code must be non-negative",
        )

    refresh_status: Literal["succeeded", "failed"]
    refresh_error: str | None = None

    # Phase 1: refresh, always. force=True bypasses ENABLE_VIEW_REFRESH.
    try:
        with get_raw_connection() as conn:
            refresh_all(conn, force=True)
        refresh_status = "succeeded"
    except Exception as e:
        log.exception("retry-grants: refresh phase failed")
        refresh_status = "failed"
        refresh_error = str(e)
        with get_connection() as conn:
            audit.record(
                conn,
                user_id=agent.user_id,
                action="admin.retry_grants.failed",
                entity_type="sync",
                entity_key=str(customer_code),
                notes=f"refresh phase failed: {e}",
                ip=_client_ip(request),
            )
        return RetryResponse(
            ok=False,
            error=f"Refresh failed before grants ran: {e}",
            refresh_status=refresh_status,
            refresh_error=refresh_error,
        )

    # Phase 2: grants.
    try:
        with get_raw_connection() as conn:
            count = grants_for_customer(conn, customer_code)
    except Exception as e:
        log.exception("retry-grants: grants phase failed")
        with get_connection() as conn:
            audit.record(
                conn,
                user_id=agent.user_id,
                action="admin.retry_grants.failed",
                entity_type="sync",
                entity_key=str(customer_code),
                notes=f"refresh={refresh_status}; grants phase failed: {e}",
                ip=_client_ip(request),
            )
        return RetryResponse(
            ok=False,
            error=str(e),
            refresh_status=refresh_status,
            refresh_error=refresh_error,
        )

    with get_connection() as conn:
        audit.record(
            conn,
            user_id=agent.user_id,
            action="admin.retry_grants",
            entity_type="sync",
            entity_key=str(customer_code),
            notes=f"refresh={refresh_status}; {count} statements applied",
            ip=_client_ip(request),
        )
    return RetryResponse(
        ok=True,
        statement_count=count,
        refresh_status=refresh_status,
        refresh_error=refresh_error,
    )


@router.post(
    "/retry-revokes/{customer_code}", response_model=RetryResponse
)
def retry_revokes(
    customer_code: int,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(require_admin)],
) -> RetryResponse:
    """Remove access for every active user under a customer: REVOKE ALL
    PRIVILEGES, DROP USER, and delete the customer's rows from the three
    secure.user_details_internal* tables.

    The exact inverse of retry_grants. Re-running retry_grants on the same
    customer puts everything back: its refresh phase repopulates the lookup
    tables from secure.customer_users (any user still disable=0 returns),
    then re-creates the accounts and re-grants privileges.

    Skips the refresh phase by design — the agent has already chosen
    "remove access," and the revoke generators read the to-be-dropped user
    list from the current (pre-refresh) lookup table. Refreshing first would
    drop a just-disabled user from that table and make the DROP a no-op for
    them, which is the opposite of what we want.
    """
    if customer_code < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="customer_code must be non-negative",
        )

    try:
        with get_raw_connection() as conn:
            count = revokes_for_customer(conn, customer_code)
    except Exception as e:
        log.exception("retry-revokes failed")
        with get_connection() as conn:
            audit.record(
                conn,
                user_id=agent.user_id,
                action="admin.retry_revokes.failed",
                entity_type="sync",
                entity_key=str(customer_code),
                notes=str(e),
                ip=_client_ip(request),
            )
        return RetryResponse(ok=False, error=str(e))

    with get_connection() as conn:
        audit.record(
            conn,
            user_id=agent.user_id,
            action="admin.retry_revokes",
            entity_type="sync",
            entity_key=str(customer_code),
            notes=f"{count} statements applied",
            ip=_client_ip(request),
        )
    return RetryResponse(ok=True, statement_count=count)


class AuditEntry(BaseModel):
    id: int
    user_id: str | None
    action: str
    entity_type: str
    entity_key: str | None
    notes: str | None
    ip: str | None
    created_at: datetime


class AuditListResponse(BaseModel):
    entries: list[AuditEntry]


@router.get("/audit", response_model=AuditListResponse)
def list_audit(
    _: Annotated[CurrentAgent, Depends(require_admin)],
    limit: int = Query(default=100, ge=1, le=500),
    action_prefix: str | None = Query(default=None, max_length=48),
) -> AuditListResponse:
    where_clauses: list[str] = []
    params: dict = {"limit": limit}
    if action_prefix:
        where_clauses.append("action LIKE :action_prefix")
        params["action_prefix"] = f"{action_prefix}%"
    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    with get_connection() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT id, user_id, action, entity_type,
                       entity_key, notes, ip, created_at
                FROM   secure.cs_audit_log
                {where_sql}
                ORDER BY id DESC
                LIMIT :limit
                """
            ),
            params,
        ).mappings().all()

    return AuditListResponse(
        entries=[
            AuditEntry(
                id=int(r["id"]),
                user_id=r["user_id"],
                action=r["action"],
                entity_type=r["entity_type"],
                entity_key=r["entity_key"],
                notes=r["notes"],
                ip=r["ip"],
                created_at=r["created_at"],
            )
            for r in rows
        ]
    )