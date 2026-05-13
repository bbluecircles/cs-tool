"""Filter parameter parsing for resource list endpoints.

Frontend sends repeated query params like:
    ?filter=first_name:like:bob
    &filter=disable:eq:0
    &filter=create_date:gte:2026-01-01
    &filter=create_date:lte:2026-12-31

Each filter is `column:operator:value`. This module:
  - parses the strings
  - validates column names against an allowlist (per-resource)
  - validates operators
  - builds a parameterized WHERE fragment + bind dict

Centralized so all four repos share the exact same validation rules and
SQL-injection guarding. Adding a new operator is one entry in OPERATORS.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status

# Operator → SQL template. The {col} placeholder gets backticked column
# name; {param} gets a SQLAlchemy named bind param.
#
# `like` does case-insensitive contains-match by lowering both sides. This
# is portable across MariaDB collations — relying on the default
# utf8mb4_unicode_ci is *usually* fine but breaks on binary collations.
OPERATORS: dict[str, str] = {
    "eq":  "{col} = :{param}",
    "ne":  "{col} <> :{param}",
    "like": "LOWER({col}) LIKE LOWER(:{param})",
    "gt":  "{col} > :{param}",
    "gte": "{col} >= :{param}",
    "lt":  "{col} < :{param}",
    "lte": "{col} <= :{param}",
}


@dataclass(frozen=True)
class ParsedFilter:
    column: str
    operator: str
    value: Any


class FilterParseError(ValueError):
    """Raised on malformed filter strings or disallowed columns/operators.

    Caller (the API router) should turn this into a 422 with the message
    intact — it's safe to surface to the user since we don't echo their
    raw value here, only what they got wrong.
    """


def parse_filters(
    raw_filters: list[str] | None,
    *,
    allowed_columns: set[str],
) -> list[ParsedFilter]:
    """Parse a list of `column:operator:value` strings.

    Empty/None input returns an empty list. Each string must split into
    exactly three parts on `:`. Column must be in allowed_columns;
    operator must be in OPERATORS.

    Note: we split on the FIRST two colons only, so values containing
    colons (e.g. timestamps "2026-01-01T12:00:00") survive. That's why
    str.split(":", 2) instead of str.split(":").
    """
    if not raw_filters:
        return []

    out: list[ParsedFilter] = []
    for i, raw in enumerate(raw_filters):
        parts = raw.split(":", 2)
        if len(parts) != 3:
            raise FilterParseError(
                f"filter[{i}]: expected 'column:operator:value', got {raw!r}"
            )
        col, op, val = parts

        if col not in allowed_columns:
            raise FilterParseError(
                f"filter[{i}]: column {col!r} is not filterable on this resource"
            )
        if op not in OPERATORS:
            raise FilterParseError(
                f"filter[{i}]: operator {op!r} not supported "
                f"(allowed: {sorted(OPERATORS)})"
            )

        coerced: Any = val
        if op == "like":
            coerced = f"%{val}%"

        out.append(ParsedFilter(column=col, operator=op, value=coerced))

    return out


def build_where(
    filters: list[ParsedFilter],
    *,
    param_offset: int = 0,
) -> tuple[list[str], dict[str, Any]]:
    """Translate parsed filters into (clauses, bind_params).

    Caller joins clauses with ' AND ' and merges bind_params into their
    existing param dict. param_offset lets the caller avoid bind-name
    collisions if they already have :search_0 etc. in flight.
    """
    clauses: list[str] = []
    params: dict[str, Any] = {}
    for i, f in enumerate(filters):
        bind_name = f"flt_{param_offset + i}"
        col_sql = f"`{f.column}`"
        clauses.append(
            OPERATORS[f.operator].format(col=col_sql, param=bind_name)
        )
        params[bind_name] = f.value
    return clauses, params


def parse_filters_or_422(
    raw: list[str] | None,
    *,
    allowed: frozenset[str],
) -> list[ParsedFilter]:
    """Convenience wrapper for FastAPI routers: parse the filter list,
    raise HTTP 422 with the parser's message if anything is invalid.

    All four resource routers call this exact pattern — putting it here
    rather than four copy-paste blocks keeps the contract enforced in
    one place.
    """
    try:
        return parse_filters(raw, allowed_columns=set(allowed))
    except FilterParseError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )