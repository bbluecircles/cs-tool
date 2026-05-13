"""Create or reset a CS agent account from the command line.

Usage (from backend/ with the venv active):

    python -m app.scripts.make_admin_hash

The script prompts for a username, password, email, and tier, then either
prints the INSERT SQL for you to run manually, or (with --write) executes it
directly against the database using the configured service account.
"""

from __future__ import annotations

import argparse
import getpass
import sys

from sqlalchemy import text

from app.core.security import hash_password
from app.db.session import get_connection


def _prompt(label: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{label}{suffix}: ").strip()
    return value or (default or "")


def main() -> int:
    parser = argparse.ArgumentParser(description="Create/reset a CS agent.")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Actually write to the database. Without this flag, prints SQL only.",
    )
    args = parser.parse_args()

    username = _prompt("Username").lower()
    if not username:
        print("Username is required.", file=sys.stderr)
        return 1

    email = _prompt("Email")
    display_name = _prompt("Display name", default=username)
    tier = _prompt("Tier (tier1/tier2/admin)", default="admin")
    if tier not in ("tier1", "tier2", "admin"):
        print(f"Invalid tier: {tier}", file=sys.stderr)
        return 1

    pw1 = getpass.getpass("Password: ")
    pw2 = getpass.getpass("Password (again): ")
    if pw1 != pw2:
        print("Passwords do not match.", file=sys.stderr)
        return 1
    if len(pw1) < 12:
        print("Password must be at least 12 characters.", file=sys.stderr)
        return 1

    password_hash = hash_password(pw1)

    stmt = text(
        """
        INSERT INTO myuser.cs_agents
            (username, email, password_hash, display_name, tier, is_active)
        VALUES
            (:username, :email, :password_hash, :display_name, :tier, 1)
        ON DUPLICATE KEY UPDATE
            email = VALUES(email),
            password_hash = VALUES(password_hash),
            display_name = VALUES(display_name),
            tier = VALUES(tier),
            is_active = 1
        """
    )
    params = {
        "username": username,
        "email": email,
        "password_hash": password_hash,
        "display_name": display_name,
        "tier": tier,
    }

    if args.write:
        with get_connection() as conn:
            conn.execute(stmt, params)
        print(f"Agent '{username}' written.")
    else:
        print("\n--- SQL (not executed; re-run with --write to apply) ---")
        print(stmt.text.strip())
        print("\nParameters:")
        for k, v in params.items():
            print(f"  {k} = {v!r}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
