"""Customers router.

  GET    /api/customers                   list with filter/sort/paginate
  POST   /api/customers                   create
  GET    /api/customers/{customer_code}   fetch one
  PATCH  /api/customers/{customer_code}   partial update
  POST   /api/customers/{customer_code}/preview   diff preview (if confirmation on)
  GET    /api/customers/{customer_code}/change-code-impact  rows a renumber moves
  POST   /api/customers/{customer_code}/change-code         renumber the customer

No DELETE — customers are not deletable.

customer_code is the primary key AND a business key other tables carry, so
changing it can't go through PATCH: it needs its own endpoint that guards
uniqueness and cascades to the child tables. See customer_repo's
"Changing a customer's code" section.

Filters arrive as repeated `filter=column:operator:value` query params.
See app.services.filter_parser for the full grammar. The router
validates against the repo's FILTERABLE_COLUMNS set and forwards parsed
filters down; the repo turns them into parameterized SQL.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import get_current_agent
from app.api.errors import ER_DUP_ENTRY, conflict, invalid, mysql_errno
from app.core.config import get_settings
from app.db.session import get_connection
from app.schemas.auth import CurrentAgent
from app.schemas.resources import (
    ChangeCodeImpact,
    ChangeCodePayload,
    ChangeCodeResponse,
    ChangePreviewImpact,
    CreateResponse,
    EditPayload,
    ListResponse,
    PreviewResponse,
    UpdateResponse,
)
from app.services import audit, customer_repo, sync_sql
from app.services.filter_parser import parse_filters_or_422

router = APIRouter(prefix="/api/customers", tags=["customers"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("", response_model=ListResponse)
def list_customers(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=5000),
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


@router.get("/next-entity-code")
def next_entity_code(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> dict:
    """Preview for the create form: the largest existing entity_code and
    the value a new customer would get (max + 1). Defined BEFORE the
    /{customer_code} route so the literal path isn't captured as a param.
    The authoritative value is still computed at insert time in
    create_customer; this is only the suggestion the modal displays.
    """
    with get_connection() as conn:
        max_code, next_code = customer_repo.next_entity_code(conn)
    return {"max_entity_code": max_code, "next_entity_code": next_code}


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


@router.get(
    "/{customer_code}/change-code-impact", response_model=ChangeCodeImpact
)
def change_code_impact(
    customer_code: int,
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> ChangeCodeImpact:
    """How many child rows a code change would renumber. Read-only —
    feeds the confirm modal so the agent sees the blast radius first."""
    with get_connection() as conn:
        row = customer_repo.get_customer(conn, customer_code)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
            )
        counts = customer_repo.child_row_counts(conn, customer_code)
    return ChangeCodeImpact(
        customer_code=customer_code,
        customer_name=row.get("customer_name"),
        counts=counts,
    )


@router.post("/{customer_code}/change-code", response_model=ChangeCodeResponse)
def change_customer_code(
    customer_code: int,
    payload: ChangeCodePayload,
    request: Request,
    agent: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> ChangeCodeResponse:
    """Renumber a customer, cascading to every table that references it.

    Guards, in order: the admin codes are off-limits, the target code must
    be free, and the whole cascade is one transaction.
    """
    new_code = payload.new_code
    admin_codes = get_settings().admin_customer_code_set
    # Admin access to this tool IS a customer_code (mariadb_auth checks it
    # against admin_customer_code_set). Renumbering the admin customer would
    # lock every agent out; renumbering onto that code would hand admin to
    # a whole customer's users. Neither is recoverable from the UI.
    if customer_code in admin_codes or new_code in admin_codes:
        raise invalid(
            "Admin customer codes ("
            + ", ".join(str(c) for c in sorted(admin_codes))
            + ") can't be used here — tool access is granted by "
            "customer_code, so renumbering one would change who is an admin.",
            field="new_code",
            code="admin_code",
        )

    with get_connection() as conn:
        # A missing customer is a 404, not the 422 the repo's own
        # existence check would produce.
        if not customer_repo.customer_code_exists(conn, customer_code):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
            )
        try:
            affected = customer_repo.change_customer_code(
                conn, customer_code, new_code
            )
        except customer_repo.CustomerCodeInUse as e:
            raise conflict(str(e), field="new_code")
        except ValueError as e:
            raise invalid(str(e), field="new_code")
        except IntegrityError as e:
            # The code was claimed between the pre-check and the UPDATE.
            if mysql_errno(e) == ER_DUP_ENTRY:
                raise conflict(
                    f"Customer code {new_code} is already in use by "
                    f"another customer.",
                    field="new_code",
                )
            raise

        # Keep the denormalized user_details* tables in step. Without this
        # they hold the old code until the (externally owned) refresh runs,
        # which would misreport admin status and mis-scope grants.
        user_details_rows = sync_sql.propagate_customer_code(
            conn, old_code=customer_code, new_code=new_code
        )

        after = customer_repo.get_customer(conn, new_code)
        audit.record(
            conn,
            user_id=agent.user_id,
            action="customer.change_code",
            entity_type="secure.customer",
            entity_key=str(customer_code),
            before={"customer_code": customer_code},
            after={
                "customer_code": new_code,
                "affected": affected,
                "user_details_rows": user_details_rows,
            },
            notes=f"customer_code {customer_code} -> {new_code}",
            ip=_client_ip(request),
        )

    return ChangeCodeResponse(
        customer_code=new_code,
        previous_code=customer_code,
        affected=affected,
        user_details_rows=user_details_rows,
        updated=after or {"customer_code": new_code},
    )