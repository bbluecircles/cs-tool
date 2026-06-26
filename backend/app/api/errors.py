"""Structured errors for the create/update endpoints.

We raise HTTPException with a dict ``detail`` so the frontend can show a
clear, field-aware message instead of a raw SQL error. Shape:

    {"code": <machine code>, "message": <human readable>, "field": <col|null>}

Frontend contract (see frontend/src/api/client.ts + CreateRowModal):
  - the thrown ApiError's `.message` is detail.message
  - detail.field, when present, names the form field to highlight
  - detail.code is a stable machine code (e.g. "duplicate", "required")
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

# MySQL / MariaDB error numbers we translate into friendly messages.
ER_DUP_ENTRY = 1062
ER_NO_REFERENCED_ROW_1 = 1216
ER_NO_REFERENCED_ROW_2 = 1452


def conflict(
    message: str, *, field: str | None = None, code: str = "duplicate"
) -> HTTPException:
    """409 — the row already exists / violates a uniqueness rule."""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": code, "message": message, "field": field},
    )


def invalid(
    message: str, *, field: str | None = None, code: str = "validation"
) -> HTTPException:
    """422 — the payload is missing/!malformed in a way we can name."""
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": code, "message": message, "field": field},
    )


def mysql_errno(e: IntegrityError) -> int | None:
    """Best-effort MySQL error number from a SQLAlchemy IntegrityError.

    ``e.orig`` is the DBAPI (pymysql) error; its first arg is the numeric
    code (e.g. 1062 for a duplicate key)."""
    orig = getattr(e, "orig", None)
    args = getattr(orig, "args", None)
    if args and isinstance(args[0], int):
        return args[0]
    return None
