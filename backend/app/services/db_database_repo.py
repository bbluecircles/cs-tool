"""Repository for myuser.db_database.

Read-only. This table is the source of truth for the list of databases
the CS tool can attach to a customer via customer_dataset.database_name;
we only need to list it. Writes are out of scope for this tool.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection


def list_db_databases(conn: Connection) -> list[dict[str, Any]]:
    """Return every row from myuser.db_database, ordered by database_name.

    The result set is small (tens of rows in this deployment), so we
    return everything in a single query rather than paginating.
    """
    rows = conn.execute(
        text(
            """
            SELECT db_connection_id, database_name, database_description
            FROM   myuser.db_database
            ORDER BY database_name ASC
            """
        )
    ).mappings().all()
    return [dict(r) for r in rows]