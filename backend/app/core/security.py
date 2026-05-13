"""Password hashing using argon2id + pepper.

The pepper is a server-side secret mixed into every password *before* it goes
into argon2. It lives only in the app config; compromising the database alone
does not give an attacker what they need to crack hashes.

argon2-cffi handles salting and parameter tuning internally. We accept its
defaults; they're reasonable for 2026-era hardware.
"""

from __future__ import annotations

import hmac

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import get_settings

# Single shared hasher. argon2-cffi is thread-safe for its verify/hash calls.
_hasher = PasswordHasher()


def _peppered(password: str) -> str:
    """Mix the server-side pepper into the password using HMAC-SHA256.

    HMAC (rather than simple concatenation) avoids length-extension concerns
    and gives a fixed-size input to argon2 regardless of password length.
    """
    pepper = get_settings().password_pepper.encode("utf-8")
    return hmac.new(pepper, password.encode("utf-8"), "sha256").hexdigest()


def hash_password(password: str) -> str:
    return _hasher.hash(_peppered(password))


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        _hasher.verify(stored_hash, _peppered(password))
        return True
    except VerifyMismatchError:
        return False
    except Exception:
        # Malformed hash, etc. Treat as a mismatch; don't leak details.
        return False


def needs_rehash(stored_hash: str) -> bool:
    """True if the hash was produced with outdated argon2 parameters."""
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except Exception:
        return False
