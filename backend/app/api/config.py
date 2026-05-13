"""Client-facing configuration endpoint.

Exposes feature flags and non-secret config the frontend needs to behave
correctly (e.g. whether to show the edit-confirmation modal). Never include
secrets here — everything returned by this endpoint is visible to any
authenticated agent.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_current_agent
from app.core.config import get_settings
from app.schemas.auth import CurrentAgent
from app.schemas.resources import ClientConfig

router = APIRouter(prefix="/api", tags=["config"])


@router.get("/config", response_model=ClientConfig)
def client_config(
    _: Annotated[CurrentAgent, Depends(get_current_agent)],
) -> ClientConfig:
    s = get_settings()
    return ClientConfig(
        enable_edit_confirmation=s.enable_edit_confirmation,
        enable_view_refresh=s.enable_view_refresh,
        admin_customer_codes=s.admin_customer_codes,
    )
