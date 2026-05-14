"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    admin,
    auth,
    config as config_router,
    customer_datasets,
    customer_users,
    customers,
    db_databases,
    health,
    ppi_datasets,
)
from app.core.config import get_settings
from app.core.logging import configure_logging

configure_logging()
log = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info(
        "CS Tool API starting (env=%s, edit_confirm=%s, view_refresh=%s)",
        settings.app_env,
        settings.enable_edit_confirmation,
        settings.enable_view_refresh,
    )
    yield
    log.info("CS Tool API shutting down")


app = FastAPI(
    title="CS Tool API",
    description="Tabbed user-management tool for Customer Service.",
    version="0.3.0",
    docs_url="/docs" if settings.is_dev else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.is_dev else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(config_router.router)
app.include_router(customers.router)
app.include_router(customer_users.router)
app.include_router(customer_datasets.router)
app.include_router(ppi_datasets.router)
app.include_router(db_databases.router)
app.include_router(admin.router)