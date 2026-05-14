"""DB databases router.

  GET /api/db-databases   list every row in myuser.db_database

Read-only and unpaged. The customer-dataset create flow uses this to
populate the database_name dropdown; the table is small (tens of rows)
so a flat list is fine. Auth-gated like every other resource.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import get_current_agent
from app.db.session import get_connection
from app.schemas.auth import CurrentAgent
from app.services import db_database_repo

router = APIRouter(prefix="/api/db-databases", tags=["db-databases"])


class DbDatabaseRow(BaseModel):
    db_connection_id: int
    database_name: str
    database_description: str | None = None


class DbDatabaseListResponse(BaseModel):
    rows: list[DbDatabaseRow]


@router.get("", response_model=DbDatabaseListResponse)
def list_db_databases(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> DbDatabaseListResponse:
    with get_connection() as conn:
        rows: list[dict[str, Any]] = db_database_repo.list_db_databases(conn)
    return DbDatabaseListResponse(rows=[DbDatabaseRow(**r) for r in rows])