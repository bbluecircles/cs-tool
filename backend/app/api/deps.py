"""FastAPI dependencies for authentication.

``get_current_agent`` — pulls the access-token cookie, decodes it, re-verifies
the agent is still admin-eligible (customer_code = admin_customer_code,
disable = 0), and returns a CurrentAgent. Raises 401 on any problem.

``require_admin`` — alias retained for endpoint declarations where we want
to be explicit that the route is admin-only. Since every authenticated CS
agent IS an admin under this model, it's equivalent to get_current_agent
today. Kept as a separate name so future non-admin flows (e.g. a read-only
viewer tier) don't require touching every admin endpoint.
"""

from __future__ import annotations

from fastapi import Cookie, HTTPException, status

from app.core.cookies import ACCESS_COOKIE
from app.core.tokens import TokenError, decode_token
from app.db.session import get_connection
from app.schemas.auth import CurrentAgent
from app.services.mariadb_auth import load_agent


def get_current_agent(
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE),
) -> CurrentAgent:
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        claims = decode_token(access_token, expected_type="access")
    except TokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
        )

    user_id = claims.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed session token",
        )

    with get_connection() as conn:
        agent = load_agent(conn, user_id)

    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account no longer authorized",
        )

    return CurrentAgent(
        user_id=agent.user_id,
        customer_code=agent.customer_code,
        e_mail=agent.e_mail,
        first_name=agent.first_name,
        last_name=agent.last_name,
        is_admin=agent.is_admin,
    )


# Alias — semantically a marker that the endpoint is admin-only.
# If a non-admin tier is ever introduced, this is the one function to fork.
require_admin = get_current_agent
