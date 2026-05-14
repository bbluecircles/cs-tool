"""Customers router.

  GET    /api/customers                   list with filter/sort/paginate
  POST   /api/customers                   create
  GET    /api/customers/{customer_code}   fetch one
  PATCH  /api/customers/{customer_code}   partial update
  POST   /api/customers/{customer_code}/preview   diff preview (if confirmation on)

No DELETE — customers are not deletable.

Filters arrive as repeated `filter=column:operator:value` query params.
See app.services.filter_parser for the full grammar. The router
validates against the repo's FILTERABLE_COLUMNS set and forwards parsed
filters down; the repo turns them into parameterized SQL.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.api.deps import get_current_agent
from app.core.config import get_settings
from app.db.session import get_connection
from app.schemas.auth import CurrentAgent
from app.schemas.resources import (
    ChangePreviewImpact,
    CreateResponse,
    EditPayload,
    ListResponse,
    PreviewResponse,
    UpdateResponse,
)
from app.services import audit, customer_repo
from app.services.filter_parser import parse_filters_or_422

router = APIRouter(prefix="/api/customers", tags=["customers"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("", response_model=ListResponse)
def list_customers(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    sort_by: str | None = Query(default=None, max_length=32),
    sort_dir: Literal["asc", "desc"] = "asc",
    # FastAPI binds repeated `?filter=...` query params into a list.
    filter: list[str] | None = Query(default=None),
) -> ListResponse:
    parsed = parse_filters_or_422(
        filter, allowed=customer_repo.FILTERABLE_COLUMNS,
    )
    with get_connection() as conn:
        rows, total = customer_repo.list_customers(
            conn,
            page=page,
            page_size=page_size,
            filters=parsed,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    return ListResponse(rows=rows, total=total, page=page, page_size=page_size)


@router.post("", response_model=CreateResponse, status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: dict,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> CreateResponse:
    if not payload.get("customer_name"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="customer_name is required",
        )
    with get_connection() as conn:
        customer_code = customer_repo.create_customer(conn, payload)
        audit.record(
            conn,
            user_id=agent.user_id,
            action="customer.create",
            entity_type="secure.customer",
            entity_key=str(customer_code),
            after=payload,
            ip=_client_ip(request),
        )
        created = customer_repo.get_customer(conn, customer_code) or {
            "customer_code": customer_code
        }
    return CreateResponse(created=created)


@router.get("/{customer_code}")
def get_customer(
    customer_code: int,
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> dict:
    with get_connection() as conn:
        row = customer_repo.get_customer(conn, customer_code)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )
    return row


@router.post(
    "/{customer_code}/preview", response_model=PreviewResponse
)
def preview_customer_update(
    customer_code: int,
    payload: EditPayload,
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> PreviewResponse:
    settings = get_settings()
    with get_connection() as conn:
        current = customer_repo.get_customer(conn, customer_code)
    if current is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )
    impacts = [
        ChangePreviewImpact(
            column=col, old_value=current.get(col), new_value=val
        )
        for col, val in payload.changes.items()
    ]
    return PreviewResponse(
        impacts=impacts,
        confirmation_required=settings.enable_edit_confirmation,
    )


@router.patch("/{customer_code}", response_model=UpdateResponse)
def update_customer(
    customer_code: int,
    payload: EditPayload,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> UpdateResponse:
    with get_connection() as conn:
        before = customer_repo.get_customer(conn, customer_code)
        if before is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
            )
        try:
            customer_repo.update_customer(conn, customer_code, payload.changes)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
            )
        after = customer_repo.get_customer(conn, customer_code)
        audit.record(
            conn,
            user_id=agent.user_id,
            action="customer.update",
            entity_type="secure.customer",
            entity_key=str(customer_code),
            before={k: before.get(k) for k in payload.changes.keys()},
            after={k: (after or {}).get(k) for k in payload.changes.keys()},
            ip=_client_ip(request),
        )
    return UpdateResponse(updated=after or {"customer_code": customer_code})