"""Customer users router.

  GET    /api/customer-users                              list
  POST   /api/customer-users                              create
  GET    /api/customer-users/check-id?user_id=X           user_id availability
  GET    /api/customer-users/{user_id}/{customer_code}    fetch one
  GET    /api/customer-users/{user_id}/{customer_code}/password  reveal (audited)
  PATCH  /api/customer-users/{user_id}/{customer_code}    update

No DELETE — users are deactivated via `disable`, not removed.
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
    PasswordRevealResponse,
    UpdateResponse,
    UserIdCheckResponse,
)
from app.services import audit, customer_users_repo
from app.services.filter_parser import parse_filters_or_422

router = APIRouter(prefix="/api/customer-users", tags=["customer_users"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("", response_model=ListResponse)
def list_customer_users(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    sort_by: str | None = Query(default=None, max_length=32),
    sort_dir: Literal["asc", "desc"] = "asc",
    filter: list[str] | None = Query(default=None),
) -> ListResponse:
    parsed = parse_filters_or_422(
        filter, allowed=customer_users_repo.FILTERABLE_COLUMNS,
    )
    with get_connection() as conn:
        rows, total = customer_users_repo.list_customer_users(
            conn,
            page=page,
            page_size=page_size,
            filters=parsed,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    return ListResponse(rows=rows, total=total, page=page, page_size=page_size)


@router.get("/check-id", response_model=UserIdCheckResponse)
def check_user_id(
    user_id: str,
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> UserIdCheckResponse:
    with get_connection() as conn:
        available = customer_users_repo.user_id_available(conn, user_id)
    return UserIdCheckResponse(user_id=user_id, available=available)


@router.post("", response_model=CreateResponse, status_code=status.HTTP_201_CREATED)
def create_customer_user(
    payload: dict,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> CreateResponse:
    required = ("user_id", "customer_code", "user_password",
                "e_mail", "first_name", "last_name")
    missing = [k for k in required if not payload.get(k) and payload.get(k) != 0]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"missing required: {missing}",
        )

    with get_connection() as conn:
        if not customer_users_repo.user_id_available(conn, payload["user_id"]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"user_id '{payload['user_id']}' is already taken",
            )
        customer_users_repo.create_customer_user(conn, payload)
        audit.record(
            conn,
            user_id=agent.user_id,
            action="customer_user.create",
            entity_type="secure.customer_users",
            entity_key=f"{payload['user_id']}|{payload['customer_code']}",
            after={**payload, "user_password": "***"},
            ip=_client_ip(request),
        )
        created = customer_users_repo.get_customer_user(
            conn, payload["user_id"], int(payload["customer_code"])
        ) or {"user_id": payload["user_id"]}
    return CreateResponse(created=created)


@router.get("/{user_id}/{customer_code}")
def get_customer_user(
    user_id: str,
    customer_code: int,
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> dict:
    with get_connection() as conn:
        row = customer_users_repo.get_customer_user(conn, user_id, customer_code)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return row


@router.get(
    "/{user_id}/{customer_code}/password",
    response_model=PasswordRevealResponse,
)
def reveal_password(
    user_id: str,
    customer_code: int,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> PasswordRevealResponse:
    with get_connection() as conn:
        pw = customer_users_repo.get_password(conn, user_id, customer_code)
        if pw is None:
            audit.record(
                conn,
                user_id=agent.user_id,
                action="customer_user.password.reveal.notfound",
                entity_type="secure.customer_users",
                entity_key=f"{user_id}|{customer_code}",
                ip=_client_ip(request),
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
            )
        audit.record(
            conn,
            user_id=agent.user_id,
            action="customer_user.password.reveal",
            entity_type="secure.customer_users",
            entity_key=f"{user_id}|{customer_code}",
            ip=_client_ip(request),
        )
    return PasswordRevealResponse(
        user_id=user_id, customer_code=customer_code, user_password=pw
    )


@router.patch("/{user_id}/{customer_code}", response_model=UpdateResponse)
def update_customer_user(
    user_id: str,
    customer_code: int,
    payload: EditPayload,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> UpdateResponse:
    with get_connection() as conn:
        before = customer_users_repo.get_customer_user(
            conn, user_id, customer_code
        )
        if before is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
            )
        try:
            customer_users_repo.update_customer_user(
                conn, user_id, customer_code, payload.changes
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
            )
        after = customer_users_repo.get_customer_user(
            conn, user_id, customer_code
        )
        # Redact password in audit snapshots even if it was the field changed.
        def _redact(d: dict | None) -> dict:
            if d is None:
                return {}
            return {
                k: ("***" if k == "user_password" else v) for k, v in d.items()
            }
        audit.record(
            conn,
            user_id=agent.user_id,
            action="customer_user.update",
            entity_type="secure.customer_users",
            entity_key=f"{user_id}|{customer_code}",
            before=_redact({k: before.get(k) for k in payload.changes.keys()}),
            after=_redact({k: (after or {}).get(k) for k in payload.changes.keys()}),
            ip=_client_ip(request),
        )
    return UpdateResponse(updated=after or {"user_id": user_id})
