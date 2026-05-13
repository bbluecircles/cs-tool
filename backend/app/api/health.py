"""Health / readiness endpoint.

Keep this cheap and synchronous so load balancers and monitors can poll it
frequently without imposing load on the database.
"""

from fastapi import APIRouter, status
from pydantic import BaseModel

from app.core.config import get_settings
from app.db.session import ping

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    env: str
    database: str


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    s = get_settings()
    db_ok = ping()
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        env=s.app_env,
        database="up" if db_ok else "down",
    )
