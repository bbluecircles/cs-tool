"""Admin endpoints.

  POST /api/admin/retry-refresh              run refresh_all (only if enabled)
  POST /api/admin/retry-grants/{customer}    run grants for one customer
  GET  /api/admin/audit                      recent audit log entries

Under the current architecture CS agents trigger grants explicitly from
the Admin tab after creating or editing users. refresh_all is normally
handled by an external process; the retry-refresh endpoint is kept for
completeness but refuses to run when ENABLE_VIEW_REFRESH is false.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated

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
    if customer_code < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="customer_code must be non-negative",
        )
    try:
        with get_raw_connection() as conn:
            count = grants_for_customer(conn, customer_code)
    except Exception as e:
        log.exception("retry-grants failed")
        with get_connection() as conn:
            audit.record(
                conn,
                user_id=agent.user_id,
                action="admin.retry_grants.failed",
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
            action="admin.retry_grants",
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
