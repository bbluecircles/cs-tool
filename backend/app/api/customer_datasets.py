"""Customer datasets router.

  GET    /api/customer-datasets              list
  POST   /api/customer-datasets              create
  GET    /api/customer-datasets/{rec_id}     fetch one
  GET    /api/customer-datasets/{rec_id}/delete-impact   affected-user preview
  PATCH  /api/customer-datasets/{rec_id}     update
  DELETE /api/customer-datasets/{rec_id}     hard delete

Delete is allowed here and on ppi-datasets. The customer-datasets delete
ships with an impact-preview endpoint because removing a dataset row drops
its users' rows from the user_details views; PPI rows have no equivalent
per-user fanout and so don't need a preview.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.api.deps import get_current_agent
from app.db.session import get_connection
from app.schemas.auth import CurrentAgent
from app.schemas.resources import (
    CreateResponse,
    DeleteResponse,
    EditPayload,
    ListResponse,
    UpdateResponse,
)
from app.services import audit, customer_dataset_repo
from app.services.filter_parser import parse_filters_or_422

router = APIRouter(prefix="/api/customer-datasets", tags=["customer_datasets"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("", response_model=ListResponse)
def list_customer_datasets(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    sort_by: str | None = Query(default=None, max_length=32),
    sort_dir: Literal["asc", "desc"] = "asc",
    filter: list[str] | None = Query(default=None),
) -> ListResponse:
    parsed = parse_filters_or_422(
        filter, allowed=customer_dataset_repo.FILTERABLE_COLUMNS,
    )
    with get_connection() as conn:
        rows, total = customer_dataset_repo.list_customer_datasets(
            conn,
            page=page,
            page_size=page_size,
            filters=parsed,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    return ListResponse(rows=rows, total=total, page=page, page_size=page_size)


@router.post("", response_model=CreateResponse, status_code=status.HTTP_201_CREATED)
def create_customer_dataset(
    payload: dict,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> CreateResponse:
    if not payload.get("database_name") or not payload.get("customer_code"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="database_name and customer_code are required",
        )
    with get_connection() as conn:
        rec_id = customer_dataset_repo.create_customer_dataset(conn, payload)
        audit.record(
            conn,
            user_id=agent.user_id,
            action="customer_dataset.create",
            entity_type="secure.customer_dataset",
            entity_key=str(rec_id),
            after=payload,
            ip=_client_ip(request),
        )
        created = customer_dataset_repo.get_customer_dataset(conn, rec_id) or {
            "rec_id": rec_id
        }
    return CreateResponse(created=created)


@router.get("/{rec_id}")
def get_customer_dataset(
    rec_id: int,
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> dict:
    with get_connection() as conn:
        row = customer_dataset_repo.get_customer_dataset(conn, rec_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
        )
    return row


class DeleteImpactResponse(BaseModel):
    rec_id: int
    customer_code: int
    database_name: str
    active_user_count: int


@router.get(
    "/{rec_id}/delete-impact",
    response_model=DeleteImpactResponse,
)
def delete_impact(
    rec_id: int,
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> DeleteImpactResponse:
    """Return how many active users belong to the customer this dataset
    attaches to. Used to warn the agent before they delete."""
    with get_connection() as conn:
        row = customer_dataset_repo.get_customer_dataset(conn, rec_id)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
            )
        count = customer_dataset_repo.active_user_count_for_dataset(
            conn, row["customer_code"], row["database_name"]
        )
    return DeleteImpactResponse(
        rec_id=rec_id,
        customer_code=row["customer_code"],
        database_name=row["database_name"],
        active_user_count=count,
    )


@router.patch("/{rec_id}", response_model=UpdateResponse)
def update_customer_dataset(
    rec_id: int,
    payload: EditPayload,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> UpdateResponse:
    with get_connection() as conn:
        before = customer_dataset_repo.get_customer_dataset(conn, rec_id)
        if before is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
            )
        try:
            customer_dataset_repo.update_customer_dataset(
                conn, rec_id, payload.changes
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
            )
        after = customer_dataset_repo.get_customer_dataset(conn, rec_id)
        audit.record(
            conn,
            user_id=agent.user_id,
            action="customer_dataset.update",
            entity_type="secure.customer_dataset",
            entity_key=str(rec_id),
            before={k: before.get(k) for k in payload.changes.keys()},
            after={k: (after or {}).get(k) for k in payload.changes.keys()},
            ip=_client_ip(request),
        )
    return UpdateResponse(updated=after or {"rec_id": rec_id})


@router.delete("/{rec_id}", response_model=DeleteResponse)
def delete_customer_dataset(
    rec_id: int,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> DeleteResponse:
    with get_connection() as conn:
        before = customer_dataset_repo.get_customer_dataset(conn, rec_id)
        if before is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
            )
        deleted = customer_dataset_repo.delete_customer_dataset(conn, rec_id)
        audit.record(
            conn,
            user_id=agent.user_id,
            action="customer_dataset.delete",
            entity_type="secure.customer_dataset",
            entity_key=str(rec_id),
            before=before,
            notes=f"hard delete of customer_code={before['customer_code']} "
                  f"database_name={before['database_name']}",
            ip=_client_ip(request),
        )
    return DeleteResponse(deleted=deleted > 0, rec_id=rec_id)