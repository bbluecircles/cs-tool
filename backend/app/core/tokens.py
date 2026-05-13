"""JWT helpers.

Two token types:

  * access  — short-lived (minutes), sent on every request.
  * refresh — longer-lived (days), used only to mint a new access token.

Both are HS256 with the same secret. We store them in httpOnly, SameSite=Lax
cookies (see api/auth.py) so they can't be read from JavaScript.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
from jwt import InvalidTokenError

from app.core.config import get_settings

TokenType = Literal["access", "refresh"]

_ALGO = "HS256"


class TokenError(Exception):
    """Raised when a token is missing, malformed, expired, or wrong-typed."""


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def create_token(
    *,
    subject: str,
    token_type: TokenType,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """Mint a signed JWT.

    `subject` is the CS agent's user_id (a string, matching MariaDB's
    username type). `extra_claims` can hold things like customer_code or
    is_admin so the
    frontend can avoid a second round-trip on page load.
    """
    s = get_settings()
    now = _now()

    if token_type == "access":
        exp = now + timedelta(minutes=s.jwt_access_token_minutes)
    else:
        exp = now + timedelta(days=s.jwt_refresh_token_days)

    claims: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    if extra_claims:
        claims.update(extra_claims)

    return jwt.encode(claims, s.jwt_secret, algorithm=_ALGO)


def decode_token(token: str, *, expected_type: TokenType) -> dict[str, Any]:
    """Decode and validate a JWT; raises TokenError on any problem."""
    s = get_settings()
    try:
        claims = jwt.decode(token, s.jwt_secret, algorithms=[_ALGO])
    except InvalidTokenError as e:
        raise TokenError(str(e)) from e

    if claims.get("type") != expected_type:
        raise TokenError(f"expected {expected_type} token, got {claims.get('type')!r}")

    return claims
