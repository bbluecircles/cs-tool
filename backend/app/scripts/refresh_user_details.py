"""Rebuild the user_details* lookup tables from the command line.

Runs exactly what Admin -> Run grants runs before generating grants
(sync_sql.refresh_all) without logging in to the tool. Use it to check a
deploy before anyone clicks Run grants, and to rebuild the tables when
nobody can log in — tool login reads secure.user_details_internal_2026,
so if that table is empty, the UI can't be used to repair it.

From the backend directory, with the venv active and the service's .env
in place:

    python -m app.scripts.refresh_user_details --dry-run
    python -m app.scripts.refresh_user_details

--dry-run does the whole rebuild inside a transaction, prints the row
counts, then rolls back: nothing is written, and nothing reaches the
binlog or replicas. While it runs it holds the same locks a real refresh
does, so run it at a quiet moment.

Exit status: 0 done, 2 refused by a safety check, 1 any other failure.
In every failure case nothing was changed.
"""

from __future__ import annotations

import argparse
import sys

from app.core.logging import configure_logging
from app.db.session import get_connection
from app.services import audit
from app.services.sync_sql import RefreshRefused, describe_db_error, refresh_all


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.scripts.refresh_user_details",
        description="Rebuild the user_details* lookup tables.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="rebuild inside a transaction, print row counts, then roll back",
    )
    args = parser.parse_args(argv)
    configure_logging()

    try:
        report = refresh_all(force=True, dry_run=args.dry_run)
    except RefreshRefused as e:
        print(f"REFUSED, nothing was changed: {e}", file=sys.stderr)
        return 2
    except Exception as e:
        print(
            f"FAILED, nothing was changed: {describe_db_error(e)}",
            file=sys.stderr,
        )
        return 1

    for t in report.tables:
        line = f"{t.table:<36} {t.rows_before:>8} -> {t.rows_after:<8}"
        if t.defaulted_columns:
            line += "  left at default: " + ", ".join(t.defaulted_columns)
        print(line)

    if args.dry_run:
        print("DRY RUN: rolled back, nothing was changed.")
    else:
        print("Committed.")
        with get_connection() as conn:
            audit.record(
                conn,
                user_id=None,
                action="cli.refresh",
                entity_type="sync",
                notes=report.summary(),
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
