"""Cookie naming + setters/clearers.

Kept in one place so the names and flags stay in sync between the login,
refresh, logout, and current-user paths.
"""

from __future__ import annotations

from fastapi import Response

from app.core.config import get_settings

ACCESS_COOKIE = "cs_access"
REFRESH_COOKIE = "cs_refresh"


def set_auth_cookies(
    response: Response,
    *,
    access_token: str,
    refresh_token: str,
) -> None:
    s = get_settings()
    # SameSite=Lax is the right default here: it blocks cross-site POST CSRF
    # while still allowing top-level navigation to work. We're same-origin in
    # dev (via Vite proxy) and in prod (FastAPI serves the static build), so
    # Lax does not interfere with normal use.
    common = {
        "httponly": True,
        "secure": s.cookie_secure,
        "samesite": "lax",
        "path": "/",
    }
    if s.cookie_domain:
        common["domain"] = s.cookie_domain

    response.set_cookie(
        ACCESS_COOKIE,
        access_token,
        max_age=s.jwt_access_token_minutes * 60,
        **common,
    )
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=s.jwt_refresh_token_days * 24 * 60 * 60,
        **common,
    )


def clear_auth_cookies(response: Response) -> None:
    s = get_settings()
    common = {"path": "/"}
    if s.cookie_domain:
        common["domain"] = s.cookie_domain
    response.delete_cookie(ACCESS_COOKIE, **common)
    response.delete_cookie(REFRESH_COOKIE, **common)
