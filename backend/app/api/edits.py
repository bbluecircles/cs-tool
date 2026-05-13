"""Edit endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.api.deps import get_current_agent
from app.schemas.auth import CurrentAgent
from app.schemas.edits import (
    ApplyResponse,
    ChangeImpactResponse,
    EditableColumnDescriptor,
    EditPayload,
    PreviewResponse,
)
from app.services import edits as edit_service
from app.services.edit_registry import REGISTRY

router = APIRouter(prefix="/api", tags=["edit"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _to_impact(c: edit_service.ChangeImpact) -> ChangeImpactResponse:
    return ChangeImpactResponse(
        column=c.column,
        scope=c.scope,
        old_value=c.old_value,
        new_value=c.new_value,
        affected_row_count=c.affected_row_count,
    )


@router.get("/edit/columns", response_model=list[EditableColumnDescriptor])
def list_editable_columns(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> list[EditableColumnDescriptor]:
    return [
        EditableColumnDescriptor(
            name=c.name,
            scope=c.scope,
            kind=c.kind,
            nullable=c.nullable,
            max_length=c.max_length,
            min_value=c.min_value,
            max_value=c.max_value,
            allowed_values=list(c.allowed_values) if c.allowed_values else None,
        )
        for c in REGISTRY.values()
    ]


@router.post(
    "/users/{user_id}/{database_name}/preview",
    response_model=PreviewResponse,
)
def preview(
    user_id: str,
    database_name: str,
    payload: EditPayload,
    customer_code: int = Query(..., ge=0),
    _: Annotated[CurrentAgent, Depends(get_current_agent)] = ...,  # type: ignore[assignment]
) -> PreviewResponse:
    key = edit_service.RowKey(
        user_id=user_id,
        database_name=database_name,
        customer_code=customer_code,
    )
    try:
        impacts = edit_service.preview_changes(key, payload.changes)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        )
    except LookupError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )
    return PreviewResponse(impacts=[_to_impact(i) for i in impacts])


@router.patch(
    "/users/{user_id}/{database_name}",
    response_model=ApplyResponse,
)
def apply(
    user_id: str,
    database_name: str,
    payload: EditPayload,
    request: Request,
    customer_code: int = Query(..., ge=0),
    agent: Annotated[CurrentAgent, Depends(get_current_agent)] = ...,  # type: ignore[assignment]
) -> ApplyResponse:
    key = edit_service.RowKey(
        user_id=user_id,
        database_name=database_name,
        customer_code=customer_code,
    )
    try:
        result = edit_service.apply_changes(
            key,
            payload.changes,
            user_id=agent.user_id,
            ip=_client_ip(request),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        )
    except LookupError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )
    return ApplyResponse(
        impacts=[_to_impact(i) for i in result.applied],
        refresh_ok=result.refresh_ok,
        grants_ok=result.grants_ok,
        refresh_error=result.refresh_error,
        grants_error=result.grants_error,
    )
