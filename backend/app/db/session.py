"""Database connection management.

We use SQLAlchemy Core (not the ORM) because:
  * Our workload is heavy on raw SQL (refresh scripts, GRANT statements).
  * We need to span multiple schemas (secure, myuser, imic_control) freely,
    which the ORM makes awkward.
  * We still want pooling, parameter binding, and a clean transaction API.

The engine is built lazily so tests can override settings before it's touched.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from urllib.parse import quote_plus

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import Connection

from app.core.config import get_settings


def _build_url() -> str:
    s = get_settings()
    # quote_plus protects against special characters in passwords
    return (
        f"mysql+pymysql://{s.db_user}:{quote_plus(s.db_password)}"
        f"@{s.db_host}:{s.db_port}/{s.db_default_schema}"
        "?charset=utf8mb4"
    )


@lru_cache
def get_engine() -> Engine:
    return create_engine(
        _build_url(),
        pool_pre_ping=True,  # survive idle disconnects
        pool_recycle=3600,    # recycle connections hourly
        pool_size=5,
        max_overflow=5,
        future=True,
    )


@contextmanager
def get_connection() -> Iterator[Connection]:
    """Yield a connection with an implicit transaction.

    Commits on clean exit, rolls back on exception. Use this for normal
    request-scoped DB work.
    """
    engine = get_engine()
    with engine.begin() as conn:
        yield conn


@contextmanager
def get_raw_connection() -> Iterator[Connection]:
    """Yield a connection WITHOUT an implicit transaction.

    Needed for DDL (CREATE USER, GRANT) which MariaDB auto-commits and which
    can't participate in a transaction. The caller is responsible for managing
    any transactional work explicitly.
    """
    engine = get_engine()
    with engine.connect() as conn:
        yield conn


def ping() -> bool:
    """Simple liveness check used by the /health endpoint."""
    try:
        with get_raw_connection() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
