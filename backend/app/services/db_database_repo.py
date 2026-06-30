"""Repository for myuser.db_database.

Read-only. This table is the source of truth for the list of databases
the CS tool can attach to a customer via customer_dataset.database_name;
we only need to list it. Writes are out of scope for this tool.

The list is LEFT JOIN'd with myuser.db_feature_list so each row carries
the per-database feature flags that drive the IP/OP/ED/APR-DRG locks in
the dataset create/edit forms. If a database has no db_feature_list row
the flags come back as 0 (everything disabled), which is the correct
fail-closed default — the agent shouldn't be able to enable features the
underlying database doesn't support.

db_feature_list can hold more than one row per database_name (e.g. one
per state), which would fan the join out and surface the same database
multiple times in the picker. We GROUP BY database_name and OR the flags
together (MAX over 0/1) so each database appears exactly once, marked as
supporting a feature if ANY of its feature rows does.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection


def list_db_databases(conn: Connection) -> list[dict[str, Any]]:
    """Return every row from myuser.db_database joined to db_feature_list.

    The result set is small (tens of rows in this deployment), so we
    return everything in a single query rather than paginating.
    """
    rows = conn.execute(
        text(
            """
            SELECT  MIN(d.db_connection_id)    AS db_connection_id,
                    d.database_name,
                    MIN(d.database_description) AS database_description,
                    COALESCE(MAX(f.inpatient),  0) AS feat_inpatient,
                    COALESCE(MAX(f.outpatient), 0) AS feat_outpatient,
                    COALESCE(MAX(f.ed),         0) AS feat_ed,
                    COALESCE(MAX(f.aprdrg),     0) AS feat_aprdrg
            FROM    myuser.db_database d
            LEFT JOIN myuser.db_feature_list f
                   ON f.database_name = d.database_name
            GROUP BY d.database_name
            ORDER BY d.database_name ASC
            """
        )
    ).mappings().all()
    return [dict(r) for r in rows]