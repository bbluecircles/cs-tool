"""PPI datasets router.

  GET    /api/ppi-datasets              list
  POST   /api/ppi-datasets              create
  GET    /api/ppi-datasets/{rec_id}     fetch one
  PATCH  /api/ppi-datasets/{rec_id}     update

No DELETE.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.api.deps import get_current_agent
from app.db.session import get_connection
from app.schemas.auth import CurrentAgent
from app.schemas.resources import (
    CreateResponse,
    EditPayload,
    ListResponse,
    UpdateResponse,
)
from app.services import audit, ppi_dataset_repo
from app.services.filter_parser import parse_filters_or_422

router = APIRouter(prefix="/api/ppi-datasets", tags=["ppi_datasets"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("", response_model=ListResponse)
def list_ppi_datasets(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    sort_by: str | None = Query(default=None, max_length=32),
    sort_dir: Literal["asc", "desc"] = "asc",
    filter: list[str] | None = Query(default=None),
) -> ListResponse:
    parsed = parse_filters_or_422(
        filter, allowed=ppi_dataset_repo.FILTERABLE_COLUMNS,
    )
    with get_connection() as conn:
        rows, total = ppi_dataset_repo.list_ppi_datasets(
            conn,
            page=page,
            page_size=page_size,
            filters=parsed,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    return ListResponse(rows=rows, total=total, page=page, page_size=page_size)


@router.post("", response_model=CreateResponse, status_code=status.HTTP_201_CREATED)
def create_ppi_dataset(
    payload: dict,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> CreateResponse:
    if not payload.get("ppi_state") or not payload.get("customer_code"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ppi_state and customer_code are required",
        )
    with get_connection() as conn:
        rec_id = ppi_dataset_repo.create_ppi_dataset(conn, payload)
        audit.record(
            conn,
            user_id=agent.user_id,
            action="ppi_dataset.create",
            entity_type="secure.ppi_dataset",
            entity_key=str(rec_id),
            after=payload,
            ip=_client_ip(request),
        )
        created = ppi_dataset_repo.get_ppi_dataset(conn, rec_id) or {
            "rec_id": rec_id
        }
    return CreateResponse(created=created)


@router.get("/{rec_id}")
def get_ppi_dataset(
    rec_id: int,
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> dict:
    with get_connection() as conn:
        row = ppi_dataset_repo.get_ppi_dataset(conn, rec_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="PPI dataset not found"
        )
    return row


@router.patch("/{rec_id}", response_model=UpdateResponse)
def update_ppi_dataset(
    rec_id: int,
    payload: EditPayload,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> UpdateResponse:
    with get_connection() as conn:
        before = ppi_dataset_repo.get_ppi_dataset(conn, rec_id)
        if before is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="PPI dataset not found"
            )
        try:
            ppi_dataset_repo.update_ppi_dataset(conn, rec_id, payload.changes)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
            )
        after = ppi_dataset_repo.get_ppi_dataset(conn, rec_id)
        audit.record(
            conn,
            user_id=agent.user_id,
            action="ppi_dataset.update",
            entity_type="secure.ppi_dataset",
            entity_key=str(rec_id),
            before={k: before.get(k) for k in payload.changes.keys()},
            after={k: (after or {}).get(k) for k in payload.changes.keys()},
            ip=_client_ip(request),
        )
    return UpdateResponse(updated=after or {"rec_id": rec_id})
