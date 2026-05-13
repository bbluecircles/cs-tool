from __future__ import annotations

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.api.deps import get_current_agent
from app.db.session import get_connection
from app.schemas.auth import CurrentAgent
from app.schemas.create_user import (
    CreateUserRequest,
    CreateUserResponse,
    UserIdCheckResponse,
)
from app.schemas.users import (
    PasswordRevealResponse,
    UserListResponse,
    UserRow,
)
from app.services import audit, users as users_repo
from app.services.create_user import create_user as do_create_user
from app.services.create_user import user_id_available

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["users"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("/users", response_model=UserListResponse)
def list_users(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    search: str | None = Query(default=None, max_length=200),
    customer_code: int | None = Query(default=None, ge=0),
    database_name: str | None = Query(default=None, max_length=25),
    disable: Annotated[Literal[0, 1] | None, Query()] = None,
    sort_by: str | None = Query(default=None, max_length=32),
    sort_dir: Literal["asc", "desc"] = Query(default="asc"),
) -> UserListResponse:
    with get_connection() as conn:
        rows, total = users_repo.list_users(
            conn,
            page=page,
            page_size=page_size,
            search=search,
            customer_code=customer_code,
            database_name=database_name,
            disable=disable,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )

    return UserListResponse(
        rows=[UserRow.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/users/{user_id}/{database_name}/password",
    response_model=PasswordRevealResponse,
)
def reveal_password(
    user_id: str,
    database_name: str,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> PasswordRevealResponse:
    with get_connection() as conn:
        pw = users_repo.get_password(
            conn, user_id=user_id, database_name=database_name
        )
        if pw is None:
            audit.record(
                conn,
                user_id=agent.user_id,
                action="user.password.reveal.notfound",
                entity_type="user_details_internal_2026",
                entity_key=f"{user_id}|{database_name}",
                ip=_client_ip(request),
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="User row not found"
            )

        audit.record(
            conn,
            user_id=agent.user_id,
            action="user.password.reveal",
            entity_type="user_details_internal_2026",
            entity_key=f"{user_id}|{database_name}",
            ip=_client_ip(request),
        )

    return PasswordRevealResponse(user_id=user_id, user_password=pw)


@router.get("/customers/brief")
def list_customers_brief(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> list[dict]:
    with get_connection() as conn:
        return users_repo.list_customers_brief(conn)


@router.get("/databases/brief")
def list_databases_brief(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> list[str]:
    with get_connection() as conn:
        return users_repo.list_databases_brief(conn)


@router.get("/users/check-id", response_model=UserIdCheckResponse)
def check_user_id(
    user_id: str,
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> UserIdCheckResponse:
    with get_connection() as conn:
        available = user_id_available(conn, user_id)
    return UserIdCheckResponse(user_id=user_id, available=available)


@router.post(
    "/users",
    response_model=CreateUserResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user_endpoint(
    payload: CreateUserRequest,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> CreateUserResponse:
    try:
        result = do_create_user(
            payload,
            user_id=agent.user_id,
            ip=_client_ip(request),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(e)
        )
    except LookupError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )

    return CreateUserResponse(
        user_id=result.user_id,
        customer_code=result.customer_code,
        datasets_created=result.datasets_created,
        ppi_datasets_created=result.ppi_datasets_created,
        customer_created=result.customer_created,
        refresh_ok=result.refresh_ok,
        grants_ok=result.grants_ok,
        refresh_error=result.refresh_error,
        grants_error=result.grants_error,
    )
