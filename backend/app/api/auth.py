"""Auth endpoints.

Routes:
  POST /auth/login   — verify credentials by MariaDB probe, set cookies
  POST /auth/logout  — clear cookies (always 204)
  POST /auth/refresh — swap refresh cookie for a new access cookie
  GET  /auth/me      — current agent identity; used by the frontend on load

Login validates by opening a short-lived MariaDB connection as the user
themselves, mirroring the main app's AccountController.Login. No local
password hashing is performed.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)

from app.api.deps import get_current_agent
from app.core.cookies import (
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    clear_auth_cookies,
    set_auth_cookies,
)
from app.core.rate_limit import login_limiter
from app.core.tokens import TokenError, create_token, decode_token
from app.db.session import get_connection
from app.schemas.auth import CurrentAgent, LoginRequest, MessageResponse
from app.services.mariadb_auth import (
    InvalidCredentials,
    load_agent,
    validate_login,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login", response_model=CurrentAgent)
def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
) -> CurrentAgent:
    ip = _client_ip(request)
    username = payload.username.strip().lower()

    # 1. Rate limit before touching MariaDB so we don't DoS ourselves and
    #    don't contribute to MariaDB's max_connect_errors tally.
    retry_after = login_limiter.retry_after(username, ip)
    if retry_after > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    # 2. Validate credentials + admin eligibility via MariaDB connect probe.
    try:
        with get_connection() as svc_conn:
            agent = validate_login(
                svc_conn, user_id=username, password=payload.password
            )
    except InvalidCredentials:
        _register_failure(username, ip)
        # Uniform message regardless of reason (missing row, wrong password,
        # not admin, disabled). Don't help enumeration attacks.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    login_limiter.record_success(username, ip)

    # 3. Mint tokens.
    extra = {
        "username": agent.user_id,
        "customer_code": agent.customer_code,
        "is_admin": agent.is_admin,
    }
    access = create_token(
        subject=agent.user_id, token_type="access", extra_claims=extra
    )
    refresh_tok = create_token(
        subject=agent.user_id, token_type="refresh"
    )
    set_auth_cookies(response, access_token=access, refresh_token=refresh_tok)

    log.info("login ok: agent=%s ip=%s", agent.user_id, ip)

    return CurrentAgent(
        user_id=agent.user_id,
        customer_code=agent.customer_code,
        e_mail=agent.e_mail,
        first_name=agent.first_name,
        last_name=agent.last_name,
        is_admin=agent.is_admin,
    )


@router.post("/logout", response_model=MessageResponse)
def logout(response: Response) -> MessageResponse:
    clear_auth_cookies(response)
    return MessageResponse(message="Signed out.")


@router.post("/refresh", response_model=MessageResponse)
def refresh(
    response: Response,
    refresh_cookie: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
    access_cookie: Annotated[str | None, Cookie(alias=ACCESS_COOKIE)] = None,  # noqa: ARG001
) -> MessageResponse:
    if not refresh_cookie:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token"
        )
    try:
        claims = decode_token(refresh_cookie, expected_type="refresh")
    except TokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    user_id = claims.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed token"
        )

    # Re-check admin eligibility on every refresh — if someone's
    # customer_code changed or they got disabled, they lose access next
    # time their access token expires.
    with get_connection() as conn:
        agent = load_agent(conn, user_id)

    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account no longer authorized",
        )

    new_access = create_token(
        subject=agent.user_id,
        token_type="access",
        extra_claims={
            "username": agent.user_id,
            "customer_code": agent.customer_code,
            "is_admin": agent.is_admin,
        },
    )
    new_refresh = create_token(subject=agent.user_id, token_type="refresh")
    set_auth_cookies(response, access_token=new_access, refresh_token=new_refresh)
    return MessageResponse(message="Refreshed.")


@router.get("/me", response_model=CurrentAgent)
def me(agent: CurrentAgent = Depends(get_current_agent)) -> CurrentAgent:
    return agent


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _register_failure(username: str, ip: str) -> None:
    locked = login_limiter.record_failure(username, ip)
    if locked:
        log.warning(
            "login lockout: user=%s ip=%s retry_after=%ss", username, ip, locked
        )
