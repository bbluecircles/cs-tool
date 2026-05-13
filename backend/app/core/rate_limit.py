"""Simple login throttle.

Counts failed login attempts per (username_lower, client_ip) and locks the
pair out for a cooldown window once a threshold is exceeded. Successful
logins reset the counter.

Scope note: state is in-process. If we ever run more than one backend
instance behind a load balancer, replace with Redis. For a single-service
internal tool this is fine.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass
class _Bucket:
    count: int
    first_attempt_at: float
    locked_until: float


class LoginRateLimiter:
    def __init__(
        self,
        *,
        max_attempts: int = 5,
        window_seconds: int = 300,     # count failures within this window
        lockout_seconds: int = 900,    # stay locked this long after tripping
    ) -> None:
        self._max = max_attempts
        self._window = window_seconds
        self._lockout = lockout_seconds
        self._buckets: dict[tuple[str, str], _Bucket] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _key(username: str, ip: str) -> tuple[str, str]:
        return (username.lower().strip(), ip or "unknown")

    def retry_after(self, username: str, ip: str) -> int:
        """Seconds the caller must wait, or 0 if they're allowed to try now."""
        now = time.monotonic()
        with self._lock:
            b = self._buckets.get(self._key(username, ip))
            if b is None:
                return 0
            if b.locked_until > now:
                return int(b.locked_until - now) + 1
            return 0

    def record_failure(self, username: str, ip: str) -> int:
        """Record a failed attempt. Returns retry_after if now locked, else 0."""
        now = time.monotonic()
        key = self._key(username, ip)
        with self._lock:
            b = self._buckets.get(key)
            if b is None or (now - b.first_attempt_at) > self._window:
                b = _Bucket(count=1, first_attempt_at=now, locked_until=0.0)
                self._buckets[key] = b
            else:
                b.count += 1

            if b.count >= self._max:
                b.locked_until = now + self._lockout
                return self._lockout
        return 0

    def record_success(self, username: str, ip: str) -> None:
        with self._lock:
            self._buckets.pop(self._key(username, ip), None)


# Shared singleton for the process lifetime.
login_limiter = LoginRateLimiter()
