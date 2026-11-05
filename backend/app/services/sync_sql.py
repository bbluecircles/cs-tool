"""Canonical refresh and grant SQL.

``refresh_all`` rebuilds every ``user_details*`` lookup table from the
canonical secure.customer / customer_users / customer_dataset / ppi_dataset
tables. Admin -> "Run grants" calls it (forced) before generating grants,
so a user created moments ago is visible to the grant generators. The
retry-refresh endpoint and ``python -m app.scripts.refresh_user_details``
call it too. Read "Lookup-table refresh" below before changing it.

``grants_for_customer`` runs the per-customer CREATE USER / GRANT
statements. Called only from the admin "Run grants" action — CS agents
decide when to run it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.config import get_settings
from app.db.session import get_engine

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lookup-table refresh
# ---------------------------------------------------------------------------
# The refresh used to run, per table, on an AUTOCOMMIT connection:
#
#     TRUNCATE TABLE t;               -- DDL: commits on the spot, no undo
#     INSERT IGNORE INTO t SELECT ... -- positional: t needs exactly as many
#                                     -- columns as the SELECT returns
#
# In Nov 2026 a column was added to secure.user_details_internal_2026. The
# next "Run grants" truncated it, the INSERT failed with 1136 "Column count
# doesn't match value count", and the table was left with 0 rows — on the
# primary and on every replica, because the TRUNCATE replicates and the
# failed INSERT doesn't. Any failure between the two statements (lock wait
# timeout, deadlock, dropped connection, service restart) did the same.
#
# How it works now:
#   1. Preflight, before anything is written: every target table must
#      exist and be InnoDB (only InnoDB can roll back), and every column its
#      SELECT produces must exist in it. Any miss refuses the whole refresh
#      with nothing touched.
#   2. One transaction covers all eight tables: DELETE + INSERT, never
#      TRUNCATE. Any error rolls every table back to exactly what it held,
#      and a rolled-back transaction writes nothing to the binlog, so
#      replicas never see it. Readers — on the primary and on replicas —
#      keep seeing the old rows until COMMIT, so no table ever reads empty.
#      Nothing inside the transaction may be DDL (TRUNCATE, ALTER, CREATE,
#      ...): MariaDB commits DDL implicitly, which would end it early.
#   3. INSERTs name their columns, taken from the SELECT's own output names
#      (the first SELECT of a UNION). A column added to a target table later
#      takes its default (logged as a warning) instead of breaking the
#      INSERT, and a reordered table can't have values filed under the
#      wrong column.
#   4. Before COMMIT, each table's new row count is checked against its old
#      one: emptying a populated table is always refused, and so is
#      shrinking one by more than REFRESH_MAX_SHRINK_PCT.
#
# The rebuild transaction does no plain (snapshot) reads — row counts come
# from the DELETE/INSERT affected-row counts — because with MariaDB's
# innodb_snapshot_isolation (on by default from 11.6) a locking read of a
# row changed after the transaction's snapshot fails with error 1020.
#
# Order matters: the myuser / imic_control rebuilds read the secure tables,
# and inside the transaction they see the rows just rebuilt.


@dataclass(frozen=True)
class _Rebuild:
    """One lookup table and the SELECT that produces its rows. Every output
    column name of the SELECT must be a column of ``table``; together they
    become the INSERT's column list (see _preflight)."""
    table: str
    select_sql: str


_REBUILDS: tuple[_Rebuild, ...] = (
    # --- secure.user_details_internal ---
    _Rebuild("secure.user_details_internal", """
    SELECT
        cu.user_id, cu.e_mail, cu.`disable`,
        c.customer_name, c.customer_code,
        cd.database_name, cd.sg2, cd.sg2_op, cd.inpatient, cd.outpatient,
        cd.ed, cu.logging_flag, cd.claritas_flag, cd.claritas_state,
        cu.first_name, cu.last_name, c.entity_code,
        cd.prism_flag, cd.projection_flag, c.max_bytes,
        cu.user_password, cu.esri_access, cu.esri_tap_access, cu.esri_state,
        cu.webuser, cu.ppiuser, cu.mapping, cu.user_priority,
        cu.max_birt_processes, cd.cms_states, cu.ppi_detail_user,
        c.`5_digit_zip`, c.max_row_cnt, cd.transfers_flag, cd.dataset_type,
        cu.create_date, cu.modify_date, cu.pw_flag,
        cd.cell_size_limit, cd.export_detail,
        cu.web_esri_access, cu.web_esri_tap_access,
        cu.web_inpatient_access, cu.web_outpatient_access,
        cu.web_ed_access, cu.web_claims_access
    FROM secure.customer c
    JOIN secure.customer_users cu    ON c.customer_code = cu.customer_code
    JOIN secure.customer_dataset cd  ON c.customer_code = cd.customer_code
    WHERE cu.`disable` = 0
    UNION ALL
    SELECT
        cu.user_id, cu.e_mail, cu.`disable`,
        c.customer_name, c.customer_code,
        pd.ppi_state AS database_name,
        '0' AS sg2, '0' AS sg2_op,
        '0' AS inpatient, '0' AS outpatient, '0' AS ed,
        cu.logging_flag, '0' AS claritas_flag, 'AZ' AS claritas_state,
        cu.first_name, cu.last_name, c.entity_code,
        '0' AS prism_flag, '1' AS projection_flag, c.max_bytes,
        cu.user_password, cu.esri_access, cu.esri_tap_access, cu.esri_state,
        cu.webuser, cu.ppiuser, cu.mapping, cu.user_priority,
        cu.max_birt_processes,
        'AL,AK,AZ,AR,CA,CO,CT,DC,DE,FL,GA,HI,ID,IL,IN,IA,KS,KY,LA,ME,MD,MA,MI,MN,MS,MO,MT,NE,NV,NH,NJ,NM,NY,NC,ND,OH,OK,OR,PA,RI,SC,SD,TN,TX,UT,VT,VA,WA,WV,WI,WY' AS cms_states,
        cu.ppi_detail_user,
        c.`5_digit_zip`, c.max_row_cnt,
        '0' AS transfers_flag, 'c' AS dataset_type,
        cu.create_date, cu.modify_date, cu.pw_flag,
        pd.cell_size_limit, pd.export_detail,
        cu.web_esri_access, cu.web_esri_tap_access,
        cu.web_inpatient_access, cu.web_outpatient_access,
        cu.web_ed_access, cu.web_claims_access
    FROM   secure.customer c
    JOIN   secure.customer_users cu  ON c.customer_code = cu.customer_code
    INNER JOIN secure.ppi_dataset pd ON c.customer_code = pd.customer_code
    WHERE  cu.`disable` = 0
    """),
    # --- secure.user_details_internal_2023 ---
    _Rebuild("secure.user_details_internal_2023", """
    SELECT
        cu.user_id, cu.e_mail, cu.`disable`,
        c.customer_name, c.customer_code,
        cd.database_name, cd.sg2, cd.sg2_op, cd.inpatient, cd.outpatient,
        cd.ed, cu.logging_flag, cd.claritas_flag, cd.claritas_state,
        cu.first_name, cu.last_name, c.entity_code,
        cd.prism_flag, cd.projection_flag, c.max_bytes,
        cu.user_password, cu.esri_access, cu.esri_tap_access, cu.esri_state,
        cu.webuser, cu.ppiuser, cu.mapping, cu.user_priority,
        cu.max_birt_processes, cd.cms_states, cu.ppi_detail_user,
        c.`5_digit_zip`, c.max_row_cnt, cd.transfers_flag, cd.dataset_type,
        cu.create_date, cu.modify_date, cu.pw_flag,
        cd.aprdrg_flag, cd.export_flag, cd.export_row_limit, cd.webapp_flag,
        cd.cell_size_limit, cd.export_detail,
        cu.web_esri_access, cu.web_esri_tap_access,
        cu.web_inpatient_access, cu.web_outpatient_access,
        cu.web_ed_access, cu.web_claims_access
    FROM secure.customer c
    JOIN secure.customer_users cu    ON c.customer_code = cu.customer_code
    JOIN secure.customer_dataset cd  ON c.customer_code = cd.customer_code
    WHERE cu.`disable` = 0
    UNION ALL
    SELECT
        cu.user_id, cu.e_mail, cu.`disable`,
        c.customer_name, c.customer_code,
        pd.ppi_state AS database_name,
        '0' AS sg2, '0' AS sg2_op,
        '0' AS inpatient, '0' AS outpatient, '0' AS ed,
        cu.logging_flag, '0' AS claritas_flag,
        'AL,AK,AZ,AR,CA,CO,CT,DC,DE,FL,GA,HI,ID,IL,IN,IA,KS,KY,LA,ME,MD,MA,MI,MN,MS,MO,MT,NE,NV,NH,NJ,NM,NY,NC,ND,OH,OK,OR,PA,RI,SC,SD,TN,TX,UT,VT,VA,WA,WV,WI,WY' AS claritas_state,
        cu.first_name, cu.last_name, c.entity_code,
        '0' AS prism_flag, '1' AS projection_flag, c.max_bytes,
        cu.user_password, cu.esri_access, cu.esri_tap_access, cu.esri_state,
        cu.webuser, cu.ppiuser, cu.mapping, cu.user_priority,
        cu.max_birt_processes,
        'AL,AK,AZ,AR,CA,CO,CT,DC,DE,FL,GA,HI,ID,IL,IN,IA,KS,KY,LA,ME,MD,MA,MI,MN,MS,MO,MT,NE,NV,NH,NJ,NM,NY,NC,ND,OH,OK,OR,PA,RI,SC,SD,TN,TX,UT,VT,VA,WA,WV,WI,WY' AS cms_states,
        cu.ppi_detail_user,
        c.`5_digit_zip`, c.max_row_cnt,
        '0' AS transfers_flag, 'c' AS dataset_type,
        cu.create_date, cu.modify_date, cu.pw_flag,
        '0' AS aprdrg_flag, '1' AS export_flag,
        '100000000' AS export_row_limit, '1' AS webapp_flag,
        pd.cell_size_limit, pd.export_detail,
        cu.web_esri_access, cu.web_esri_tap_access,
        cu.web_inpatient_access, cu.web_outpatient_access,
        cu.web_ed_access, cu.web_claims_access
    FROM   secure.customer c
    JOIN   secure.customer_users cu  ON c.customer_code = cu.customer_code
    INNER JOIN secure.ppi_dataset pd ON c.customer_code = pd.customer_code
    WHERE  cu.`disable` = 0
    """),
    # --- secure.user_details_internal_2026 ---
    _Rebuild("secure.user_details_internal_2026", """
    SELECT
        cu.user_id, cu.e_mail, cu.`disable`,
        c.customer_name, c.customer_code,
        cd.database_name, cd.sg2, cd.sg2_op, cd.inpatient, cd.outpatient,
        cd.ed, cu.logging_flag, cd.claritas_flag, cd.claritas_state,
        cu.first_name, cu.last_name, c.entity_code,
        cd.prism_flag, cd.projection_flag, c.max_bytes,
        cu.user_password, cu.esri_access, cu.esri_tap_access, cu.esri_state,
        cu.webuser, cu.ppiuser, cu.mapping, cu.user_priority,
        cu.max_birt_processes, cd.cms_states, cu.ppi_detail_user,
        c.`5_digit_zip`, c.max_row_cnt, cd.transfers_flag, cd.dataset_type,
        cu.create_date, cu.modify_date, cu.pw_flag,
        cd.aprdrg_flag, cd.export_flag, cd.export_row_limit, cd.webapp_flag,
        cd.cell_size_limit, cd.export_detail,
        cu.web_esri_access, cu.web_esri_tap_access,
        cu.web_inpatient_access, cu.web_outpatient_access,
        cu.web_ed_access, cu.web_claims_access
    FROM secure.customer c
    JOIN secure.customer_users cu    ON c.customer_code = cu.customer_code
    JOIN secure.customer_dataset cd  ON c.customer_code = cd.customer_code
    WHERE cu.`disable` = 0
    UNION ALL
    SELECT
        cu.user_id, cu.e_mail, cu.`disable`,
        c.customer_name, c.customer_code,
        pd.ppi_state AS database_name,
        '' AS sg2, '' AS sg2_op,
        '0' AS inpatient, '0' AS outpatient, '0' AS ed,
        cu.logging_flag, '0' AS claritas_flag, '' AS claritas_state,
        cu.first_name, cu.last_name, c.entity_code,
        '' AS prism_flag, '' AS projection_flag, c.max_bytes,
        cu.user_password, cu.esri_access, cu.esri_tap_access, cu.esri_state,
        cu.webuser, cu.ppiuser, cu.mapping, cu.user_priority,
        cu.max_birt_processes, '' AS cms_states, cu.ppi_detail_user,
        c.`5_digit_zip`, c.max_row_cnt,
        '0' AS transfers_flag, 'c' AS dataset_type,
        cu.create_date, cu.modify_date, cu.pw_flag,
        '0' AS aprdrg_flag, '1' AS export_flag,
        '100000000' AS export_row_limit, '1' AS webapp_flag,
        pd.cell_size_limit, pd.export_detail,
        cu.web_esri_access, cu.web_esri_tap_access,
        cu.web_inpatient_access, cu.web_outpatient_access,
        cu.web_ed_access, cu.web_claims_access
    FROM   secure.customer c
    JOIN   secure.customer_users cu  ON c.customer_code = cu.customer_code
    INNER JOIN secure.ppi_dataset pd ON c.customer_code = pd.customer_code
    WHERE  cu.`disable` = 0
    """),
    # --- myuser.user_details (encrypted password variant) ---
    _Rebuild("myuser.user_details", """
    SELECT
        s.user_id, s.e_mail, s.`disable`, s.customer_name, s.customer_code,
        s.database_name, s.sg2, s.sg2_op, s.inpatient, s.outpatient, s.ed,
        s.logging_flag, s.claritas_flag, s.claritas_state,
        s.first_name, s.last_name, s.entity_code,
        s.prism_flag, s.projection_flag, s.max_bytes,
        AES_ENCRYPT(s.user_password, SHA2('forget1c#)', 512)) AS user_password,
        s.esri_access, s.esri_tap_access, s.esri_state,
        s.webuser, s.ppiuser, s.mapping, s.user_priority,
        s.max_birt_processes, s.cms_states, s.ppi_detail_user,
        s.`5_digit_zip`, s.max_row_cnt, s.transfers_flag, s.dataset_type,
        s.create_date, s.modify_date, s.pw_flag,
        s.cell_size_limit, s.export_detail,
        s.web_esri_access, s.web_esri_tap_access,
        s.web_inpatient_access, s.web_outpatient_access,
        s.web_ed_access, s.web_claims_access
    FROM secure.user_details_internal s
    """),
    # --- myuser.user_details_2023 ---
    _Rebuild("myuser.user_details_2023", """
    SELECT
        s.user_id, s.e_mail, s.`disable`, s.customer_name, s.customer_code,
        s.database_name, s.sg2, s.sg2_op, s.inpatient, s.outpatient, s.ed,
        s.logging_flag, s.claritas_flag, s.claritas_state,
        s.first_name, s.last_name, s.entity_code,
        s.prism_flag, s.projection_flag, s.max_bytes,
        AES_ENCRYPT(s.user_password, SHA2('forget1c#)', 512)) AS user_password,
        s.esri_access, s.esri_tap_access, s.esri_state,
        s.webuser, s.ppiuser, s.mapping, s.user_priority,
        s.max_birt_processes, s.cms_states, s.ppi_detail_user,
        s.`5_digit_zip`, s.max_row_cnt, s.transfers_flag, s.dataset_type,
        s.create_date, s.modify_date, s.pw_flag,
        s.aprdrg_flag, s.export_flag, s.export_row_limit, s.webapp_flag,
        s.cell_size_limit, s.export_detail,
        s.web_esri_access, s.web_esri_tap_access,
        s.web_inpatient_access, s.web_outpatient_access,
        s.web_ed_access, s.web_claims_access
    FROM secure.user_details_internal_2023 s
    """),
    # --- myuser.user_details_2026 ---
    _Rebuild("myuser.user_details_2026", """
    SELECT
        s.user_id, s.e_mail, s.`disable`, s.customer_name, s.customer_code,
        s.database_name, s.sg2, s.sg2_op, s.inpatient, s.outpatient, s.ed,
        s.logging_flag, s.claritas_flag, s.claritas_state,
        s.first_name, s.last_name, s.entity_code,
        s.prism_flag, s.projection_flag, s.max_bytes,
        AES_ENCRYPT(s.user_password, SHA2('forget1c#)', 512)) AS user_password,
        s.esri_access, s.esri_tap_access, s.esri_state,
        s.webuser, s.ppiuser, s.mapping, s.user_priority,
        s.max_birt_processes, s.cms_states, s.ppi_detail_user,
        s.`5_digit_zip`, s.max_row_cnt, s.transfers_flag, s.dataset_type,
        s.create_date, s.modify_date, s.pw_flag,
        s.aprdrg_flag, s.export_flag, s.export_row_limit, s.webapp_flag,
        s.cell_size_limit, s.export_detail,
        s.web_esri_access, s.web_esri_tap_access,
        s.web_inpatient_access, s.web_outpatient_access,
        s.web_ed_access, s.web_claims_access
    FROM secure.user_details_internal_2026 s
    """),
    # --- imic_control.user_details ---
    _Rebuild("imic_control.user_details", """
    SELECT
        s.user_id, s.e_mail, s.`disable`, s.customer_name, s.customer_code,
        s.database_name, s.sg2, s.sg2_op, s.inpatient, s.outpatient, s.ed,
        s.logging_flag, s.claritas_flag, s.claritas_state,
        s.first_name, s.last_name, s.entity_code,
        s.prism_flag, s.projection_flag, s.max_bytes,
        AES_ENCRYPT(s.user_password, SHA2('forget1c#)', 512)) AS user_password,
        s.esri_access, s.esri_tap_access, s.esri_state,
        s.webuser, s.ppiuser, s.mapping, s.user_priority,
        s.max_birt_processes, s.cms_states, s.ppi_detail_user,
        s.`5_digit_zip`, s.max_row_cnt, s.transfers_flag, s.dataset_type,
        s.create_date, s.modify_date, s.pw_flag,
        s.cell_size_limit, s.export_detail,
        s.web_esri_access, s.web_esri_tap_access,
        s.web_inpatient_access, s.web_outpatient_access,
        s.web_ed_access, s.web_claims_access
    FROM secure.user_details_internal s
    """),
    # --- imic_control.user_details_2023 (discharge datasets only) ---
    _Rebuild("imic_control.user_details_2023", """
    SELECT
        s.user_id, s.e_mail, s.`disable`, s.customer_name, s.customer_code,
        s.database_name, s.sg2, s.sg2_op, s.inpatient, s.outpatient, s.ed,
        s.logging_flag, s.claritas_flag, s.claritas_state,
        s.first_name, s.last_name, s.entity_code,
        s.prism_flag, s.projection_flag, s.max_bytes,
        AES_ENCRYPT(s.user_password, SHA2('forget1c#)', 512)) AS user_password,
        s.esri_access, s.esri_tap_access, s.esri_state,
        s.webuser, s.ppiuser, s.mapping, s.user_priority,
        s.max_birt_processes, s.cms_states, s.ppi_detail_user,
        s.`5_digit_zip`, s.max_row_cnt, s.transfers_flag, s.dataset_type,
        s.create_date, s.modify_date, s.pw_flag,
        s.aprdrg_flag, s.export_flag, s.export_row_limit, s.webapp_flag,
        s.cell_size_limit, s.export_detail,
        s.web_esri_access, s.web_esri_tap_access,
        s.web_inpatient_access, s.web_outpatient_access,
        s.web_ed_access, s.web_claims_access
    FROM secure.user_details_internal_2023 s
    WHERE s.dataset_type = 'd'
    """),
)


class RefreshDisabled(RuntimeError):
    """Raised when refresh_all is called while ENABLE_VIEW_REFRESH is off."""


class RefreshRefused(RuntimeError):
    """A safety check stopped the refresh. Nothing was changed: either the
    preflight refused before any write, or the transaction rolled back."""


@dataclass(frozen=True)
class TableRefresh:
    table: str
    rows_before: int
    rows_after: int
    # Columns of the table the refresh doesn't write, so they took their
    # default. Usually a column added to the table without a SELECT change.
    defaulted_columns: tuple[str, ...] = ()


@dataclass(frozen=True)
class RefreshReport:
    tables: tuple[TableRefresh, ...]
    committed: bool  # False for a dry run, which rolls back on purpose

    def summary(self) -> str:
        """One line for the log and the audit trail."""
        counts = "; ".join(
            f"{t.table} {t.rows_before}->{t.rows_after}" for t in self.tables
        )
        return ("committed: " if self.committed else "dry run, rolled back: ") + counts


def describe_db_error(e: BaseException) -> str:
    """The driver's message, e.g. (1054, "Unknown column ..."), without the
    full statement text SQLAlchemy appends — that runs to pages here."""
    return str(getattr(e, "orig", None) or e)


def _quote_ident(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def _preflight(
    conn: Connection, rb: _Rebuild
) -> tuple[list[str], tuple[str, ...]]:
    """Check one rebuild without writing anything. Returns the INSERT column
    list (the SELECT's output names, in order) and the table's columns the
    refresh doesn't write. Raises RefreshRefused on any problem."""
    schema, _, table = rb.table.partition(".")
    found = conn.execute(
        text(
            "SELECT TABLE_TYPE, ENGINE FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = :s AND TABLE_NAME = :t"
        ),
        {"s": schema, "t": table},
    ).first()
    if found is None:
        raise RefreshRefused(
            f"{rb.table} does not exist, or the service account can't see it."
        )
    table_type, engine = found
    if table_type != "BASE TABLE":
        raise RefreshRefused(f"{rb.table} is a {table_type}, not a table.")
    if (engine or "").lower() != "innodb":
        raise RefreshRefused(
            f"{rb.table} uses the {engine} storage engine. The refresh only "
            f"rebuilds InnoDB tables, because only InnoDB can roll back a "
            f"rebuild that fails part-way."
        )

    table_cols = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = :s AND TABLE_NAME = :t "
                "ORDER BY ORDINAL_POSITION"
            ),
            {"s": schema, "t": table},
        )
    ]

    # LIMIT 0 makes MariaDB parse and resolve the SELECT — an unknown source
    # column fails here — and report its output column names, without
    # reading any rows. On its own line so a trailing comment can't eat it.
    try:
        select_cols = list(
            conn.execute(text(f"{rb.select_sql.strip()}\nLIMIT 0")).keys()
        )
    except Exception as e:
        raise RefreshRefused(
            f"The source query for {rb.table} fails: {describe_db_error(e)}"
        ) from e

    lowered = [c.lower() for c in select_cols]
    repeated = sorted({c for c in select_cols if lowered.count(c.lower()) > 1})
    if repeated:
        raise RefreshRefused(
            f"The source query for {rb.table} returns "
            f"{', '.join(repeated)} more than once."
        )
    present = {c.lower() for c in table_cols}
    missing = [c for c in select_cols if c.lower() not in present]
    if missing:
        raise RefreshRefused(
            f"{rb.table} has no column {', '.join(missing)}, which the "
            f"refresh writes. Add it to the table (see db/migrations) first."
        )
    written = set(lowered)
    defaulted = tuple(c for c in table_cols if c.lower() not in written)
    return select_cols, defaulted


def _check_row_counts(table: str, before: int, after: int) -> None:
    """Refuse a rebuild that empties or badly shrinks a populated table.
    Raising here rolls back the whole transaction."""
    if before > 0 and after <= 0:
        raise RefreshRefused(
            f"Rebuilding {table} produced 0 rows (it has {before}). Refusing "
            f"to empty it; nothing was changed."
        )
    limit = get_settings().refresh_max_shrink_pct
    if before > 0 and limit < 100 and (before - after) * 100 > before * limit:
        raise RefreshRefused(
            f"Rebuilding {table} would shrink it from {before} to {after} "
            f"rows ({(before - after) * 100 // before}% fewer; the limit is "
            f"REFRESH_MAX_SHRINK_PCT={limit}). Nothing was changed. If that "
            f"drop is expected, raise REFRESH_MAX_SHRINK_PCT in the backend "
            f".env and restart the service."
        )


def _rebuild(
    conn: Connection, plans: list[tuple[_Rebuild, list[str], tuple[str, ...]]]
) -> tuple[TableRefresh, ...]:
    """DELETE + INSERT every table, in order, inside the caller's
    transaction. Counts come from affected rows: no snapshot reads."""
    results: list[TableRefresh] = []
    for rb, columns, defaulted in plans:
        before = conn.execute(text(f"DELETE FROM {rb.table}")).rowcount
        column_list = ", ".join(_quote_ident(c) for c in columns)
        after = conn.execute(
            text(
                f"INSERT IGNORE INTO {rb.table} ({column_list})\n"
                f"{rb.select_sql.strip()}"
            )
        ).rowcount
        _check_row_counts(rb.table, before, after)
        if defaulted:
            log.warning(
                "refresh: %s has columns the refresh doesn't write; they "
                "were left at their default: %s",
                rb.table, ", ".join(defaulted),
            )
        results.append(TableRefresh(rb.table, before, after, defaulted))
    return tuple(results)


def refresh_all(*, force: bool = False, dry_run: bool = False) -> RefreshReport:
    """Rebuild every user_details* lookup table in one transaction: all of
    them change, or none do. See "Lookup-table refresh" above.

    Respects ENABLE_VIEW_REFRESH unless force=True. retry_grants forces it:
    without a refresh, a user created seconds ago isn't in
    user_details_internal_2026 yet, so the grants step would generate zero
    statements and report success for a user who can't log in.

    dry_run=True does the whole rebuild, reports the row counts, then rolls
    back — nothing is written. It still holds a real refresh's locks while
    it runs.

    Raises RefreshRefused when a safety check stops it, RefreshDisabled when
    the config flag is off, and lets database errors propagate. In every
    one of those cases nothing was changed.
    """
    if not force and not dry_run and not get_settings().enable_view_refresh:
        raise RefreshDisabled(
            "View refresh is disabled via ENABLE_VIEW_REFRESH=false."
        )

    # Its own connection, never a caller's: the rebuild has to own its
    # transaction. On an AUTOCOMMIT connection every DELETE would commit on
    # its own — the failure this replaces.
    with get_engine().connect() as conn:
        # Session-scoped and not transactional, so the rollbacks and commit
        # below don't release it; the finally does.
        got_lock = conn.execute(
            text("SELECT GET_LOCK('cs_tool_refresh', 30)")
        ).scalar()
        if not got_lock:
            raise RuntimeError(
                "Could not acquire cs_tool_refresh lock within 30s; "
                "another refresh is in flight."
            )
        try:
            plans = [(rb, *_preflight(conn, rb)) for rb in _REBUILDS]
            # End the preflight's read-only transaction so the rebuild
            # starts a fresh one carrying no snapshot.
            conn.rollback()
            try:
                tables = _rebuild(conn, plans)
            except BaseException:
                conn.rollback()
                raise
            if dry_run:
                conn.rollback()
            else:
                conn.commit()
        finally:
            try:
                conn.execute(text("SELECT RELEASE_LOCK('cs_tool_refresh')"))
            except Exception as e:  # never mask the real outcome
                log.warning("refresh_all: RELEASE_LOCK failed: %s", e)

    report = RefreshReport(tables=tables, committed=not dry_run)
    log.info("refresh_all: %s", report.summary())
    return report


# Per-table write grants on `myuser`.* (reference grant script, section 07).
# The DB-level `myuser` grant is SELECT-only by design, so these table-scoped
# INSERT/UPDATE/DELETE grants are REQUIRED, not redundant. End users get write
# access to their own report/group tables, never blanket write on `myuser`.
_MYUSER_TABLE_GRANTS: tuple[tuple[str, str], ...] = (
    ("execute_report",              "SELECT, INSERT, UPDATE"),
    ("combined_grp_2011",           "SELECT, INSERT, UPDATE, DELETE"),
    ("combined_grp_run_2011",       "SELECT, INSERT, UPDATE, DELETE"),
    ("combined_grp_share_2011",     "SELECT, INSERT, UPDATE, DELETE"),
    ("custom_grp_2011",             "SELECT, INSERT, UPDATE, DELETE"),
    ("custom_grp_run_2011",         "SELECT, INSERT, UPDATE, DELETE"),
    ("custom_grp_share_2011",       "SELECT, INSERT, UPDATE, DELETE"),
    ("report_package_2013",         "SELECT, INSERT, UPDATE, DELETE"),
    ("report_package_2019",         "SELECT, INSERT, UPDATE, DELETE"),
    ("report_package_report_2013",  "SELECT, INSERT, UPDATE, DELETE"),
    ("report_package_report_2019",  "SELECT, INSERT, UPDATE, DELETE"),
    ("report_package_share_2013",   "SELECT, INSERT, UPDATE, DELETE"),
    ("report_package_share_2019",   "SELECT, INSERT, UPDATE, DELETE"),
    ("user_dberror",                "SELECT, INSERT, UPDATE, DELETE"),
    ("user_email",                  "SELECT, INSERT, UPDATE, DELETE"),
    ("user_is_payor_score",         "SELECT, INSERT, UPDATE, DELETE"),
    ("user_msdrg_score",            "SELECT, INSERT, UPDATE, DELETE"),
    ("user_msdrg_specialty_score",  "SELECT, INSERT, UPDATE, DELETE"),
    ("user_report",                 "SELECT, INSERT, UPDATE, DELETE"),
    ("user_report_output_2013",     "SELECT, INSERT, UPDATE, DELETE"),
    ("user_report_output_2019",     "SELECT, INSERT, UPDATE, DELETE"),
    ("user_report_share",           "SELECT, INSERT, UPDATE, DELETE"),
    ("user_st_payor_score",         "SELECT, INSERT, UPDATE, DELETE"),
)


def _myuser_table_grant_sql(table: str, privs: str) -> str:
    """Build a GRANT generator for one `myuser` table. ``table``/``privs``
    come only from _MYUSER_TABLE_GRANTS (hardcoded constants), so inlining
    them is injection-safe; the user list is still read from the lookup
    table by the :cc-parameterized query."""
    return (
        f"SELECT CONCAT('GRANT {privs} ON `myuser`.{table} "
        f"TO `', user_id, '`@`%`;') "
        f"FROM myuser.user_details_2026 "
        f"WHERE `disable` = 0 AND customer_code = :cc GROUP BY user_id"
    )


_GRANT_GENERATORS: tuple[str, ...] = (
    # Create/alter user (with and without pw_flag prefix)
    """
    SELECT CONCAT('ALTER USER IF EXISTS `', udi.user_id, '`@`%` IDENTIFIED BY ',
                  QUOTE(CONCAT('block21', udi.user_password)), ';')
    FROM   secure.user_details_internal_2026 udi
    WHERE  udi.`disable` = 0 AND udi.pw_flag = 1 AND udi.customer_code = :cc
    GROUP BY udi.user_id
    """,
    """
    SELECT CONCAT('ALTER USER IF EXISTS `', udi.user_id, '`@`%` IDENTIFIED BY ',
                  QUOTE(udi.user_password), ';')
    FROM   secure.user_details_internal_2026 udi
    WHERE  udi.`disable` = 0 AND udi.pw_flag = 0 AND udi.customer_code = :cc
    GROUP BY udi.user_id
    """,
    """
    SELECT CONCAT('CREATE USER IF NOT EXISTS `', udi.user_id, '`@`%` IDENTIFIED BY ',
                  QUOTE(udi.user_password), ';')
    FROM   secure.user_details_internal_2026 udi
    WHERE  udi.pw_flag = 0 AND udi.`disable` = 0 AND udi.customer_code = :cc
    GROUP BY udi.user_id, udi.user_password
    """,
    """
    SELECT CONCAT('CREATE USER IF NOT EXISTS `', udi.user_id, '`@`%` IDENTIFIED BY ',
                  QUOTE(CONCAT('block21', udi.user_password)), ';')
    FROM   secure.user_details_internal_2026 udi
    WHERE  udi.pw_flag = 1 AND udi.`disable` = 0 AND udi.customer_code = :cc
    GROUP BY udi.user_id, udi.user_password
    """,

    # ESRI
    """
    SELECT CONCAT('GRANT SELECT ON `esri`.* TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc AND esri_access = 1
    GROUP BY user_id
    """,

    # 000_common
    """
    SELECT CONCAT('GRANT SELECT ON `000_common`.* TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,

    # app_control
    """
    SELECT CONCAT('GRANT SELECT ON `app_control`.* TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,
    """
    SELECT CONCAT('GRANT SELECT, INSERT, UPDATE ON `app_control`.md5lookup TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,
    """
    SELECT CONCAT('GRANT SELECT, INSERT, UPDATE ON `app_control`.processlist_history TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,
    """
    SELECT CONCAT('GRANT SELECT, INSERT, UPDATE ON `app_control`.user_activity TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,
    """
    SELECT CONCAT('GRANT SELECT, INSERT, UPDATE ON `app_control`.user_activity_log TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,
    """
    SELECT CONCAT('GRANT EXECUTE ON `app_control`.* TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,

    # myuser + imic_control + volatile_data
    """
    SELECT CONCAT('GRANT SELECT ON `myuser`.* TO `', user_id, '`@`%`;')
    FROM   secure.user_details_internal_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,
    """
    SELECT CONCAT('GRANT SELECT ON `imic_control`.* TO `', user_id, '`@`%`;')
    FROM   secure.user_details_internal_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,
    """
    SELECT CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `volatile_data`.* TO `', user_id, '`@`%`;')
    FROM   secure.user_details_internal_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,

    # myuser per-table write grants (reference section 07). DB-level `myuser`
    # grant above is SELECT-only, so these table-scoped writes are required.
    *[_myuser_table_grant_sql(_t, _p) for _t, _p in _MYUSER_TABLE_GRANTS],

    # State/claims DB (per-user database_name).
    #
    # LOWER() is load-bearing. This is the only generator that puts a
    # DYNAMIC identifier in a GRANT — every other one names a hardcoded
    # lowercase schema. The value is cd.database_name for discharge and
    # pd.ppi_state for claims, and ppi_state holds state codes stored
    # uppercase ("KS"), so without this we emit GRANT ... ON `KS`.*.
    #
    # The server runs with lower_case_table_names set, so a database
    # cannot exist on disk under a mixed-case name — but a mixed-case
    # GRANT still lands a mixed-case row in mysql.db, which MariaDB
    # lowercases in memory at every startup with:
    #
    #   [Warning] 'db' entry 'ks jgiannotti@%' had database in mixed case
    #   that has been forced to lowercase ... It will not be possible to
    #   remove this privilege using REVOKE.
    #
    # Those rows are then unREVOKEable by name. Normalizing here, at the
    # point the value becomes a SQL identifier, rather than lowercasing
    # the stored column — other consumers read ppi_state/database_name
    # and are not ours to change.
    """
    SELECT CONCAT('GRANT SELECT ON `', LOWER(database_name), '`.* TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc
    """,

    # tempdb, file
    """
    SELECT CONCAT('GRANT ALTER, CREATE, CREATE TEMPORARY TABLES, DELETE, DROP, ',
                  'INDEX, INSERT, LOCK TABLES, REFERENCES, SELECT, UPDATE ',
                  'ON `tempdb`.* TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,
    """
    SELECT CONCAT('GRANT FILE ON *.* TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,

    # user_data
    """
    SELECT CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `user_data`.* TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,

    # user_data REFERENCES (reference section 11). The grant above already
    # covers SELECT/INSERT/UPDATE/DELETE on user_data.*; this adds the
    # REFERENCES privilege the reference script also grants.
    """
    SELECT CONCAT('GRANT REFERENCES, SELECT ON `user_data`.* TO `', user_id, '`@`%`;')
    FROM   myuser.user_details_2026
    WHERE  `disable` = 0 AND customer_code = :cc GROUP BY user_id
    """,
)


def _collect_grants(conn: Connection, customer_code: int) -> list[str]:
    stmts: list[str] = []
    for gen_sql in _GRANT_GENERATORS:
        rows = conn.execute(text(gen_sql), {"cc": customer_code}).all()
        for row in rows:
            stmt = row[0]
            if stmt:
                stmts.append(stmt)
    return stmts


def grants_for_customer(conn: Connection, customer_code: int) -> int:
    """Run every generated GRANT/CREATE USER/ALTER USER for a customer.

    Returns count of executed statements. Individual failures are logged
    but don't abort the rest — a GRANT on a non-existent DB is not fatal.
    """
    stmts = _collect_grants(conn, customer_code)
    ok = 0
    for stmt in stmts:
        try:
            conn.execute(text(stmt))
            ok += 1
        except Exception as e:
            log.warning("grant failed (%s): %s", stmt[:80], e)
    log.info(
        "grants_for_customer(%s): %d/%d ok", customer_code, ok, len(stmts)
    )
    return ok


# ---------------------------------------------------------------------------
# Revokes — remove access for a customer's DISABLED users (disable = 1).
#
# Workflow: an agent flips a user's `disable` to 1 in the Users tab, then runs
# Remove grants for that customer. For each disabled user we run:
#   1. REVOKE ALL PRIVILEGES, GRANT OPTION FROM '<user>'@'%'
#   2. DROP USER IF EXISTS '<user>'@'%'
# Active (disable = 0) users are never touched — this is the inverse of Run
# grants, which acts only on disable = 0.
#
# The disabled-user list is read from the canonical secure.customer_users:
# disabled users are EXCLUDED from user_details_internal_2026 (the refresh
# builds it from disable = 0), so that denormalized table can't supply them.
#
# Then we purge any lingering lookup rows for those disabled users from EVERY
# user_details* table — secure.*, myuser.*, AND imic_control.* — scoped to
# disabled users so active users' rows survive.
#
# REVOKE ALL PRIVILEGES, GRANT OPTION removes privileges at every level
# (global like FILE, db, table, routine); DROP USER then removes the account.
# The REVOKE is redundant before DROP but makes the audit trail explicit and
# is defensive if DROP fails (e.g. open connections holding the account).
# ---------------------------------------------------------------------------

# Both generators read the DISABLED users straight from secure.customer_users
# (the canonical table). user_details_internal_2026 only holds disable = 0
# rows, so it can't list the disabled users we need to drop.
_REVOKE_GENERATOR = """
    SELECT CONCAT('REVOKE ALL PRIVILEGES, GRANT OPTION FROM `', user_id, '`@`%`;')
    FROM   secure.customer_users
    WHERE  `disable` = 1 AND customer_code = :cc
    GROUP BY user_id
"""

_DROP_USER_GENERATOR = """
    SELECT CONCAT('DROP USER IF EXISTS `', user_id, '`@`%`;')
    FROM   secure.customer_users
    WHERE  `disable` = 1 AND customer_code = :cc
    GROUP BY user_id
"""

# The denormalized user_details* tables the refresh maintains — the canonical
# list, shared by the revoke cleanup and propagate_disable.
_USER_DETAILS_TABLES: tuple[str, ...] = (
    "secure.user_details_internal",
    "secure.user_details_internal_2023",
    "secure.user_details_internal_2026",
    "myuser.user_details",
    "myuser.user_details_2023",
    "myuser.user_details_2026",
    "imic_control.user_details",
    "imic_control.user_details_2023",
)

# Lookup-table cleanup. Run AFTER the REVOKE/DROP statements are collected,
# this purges any lingering rows for the customer's DISABLED users from EVERY
# user_details* table (secure, myuser, AND imic_control). A disabled user is
# normally already absent (the refresh excludes disable = 1), but the revoke
# path skips the refresh, so a just-disabled user may still be present in any
# of them. Scoped to disabled users via a subquery so ACTIVE users' rows are
# never deleted. :cc binds to every occurrence.
_REVOKE_CLEANUP_STATEMENTS: tuple[str, ...] = tuple(
    f"DELETE FROM {tbl} WHERE customer_code = :cc AND user_id IN "
    f"(SELECT user_id FROM secure.customer_users "
    f"WHERE `disable` = 1 AND customer_code = :cc)"
    for tbl in _USER_DETAILS_TABLES
)


def _collect_revokes(conn: Connection, customer_code: int) -> list[str]:
    """Collect DROP USER statements for every disabled user."""
    rows = conn.execute(
        text(_DROP_USER_GENERATOR),
        {"cc": customer_code},
    ).all()

    return [row[0] for row in rows if row[0]]


def revokes_for_customer(conn: Connection, customer_code: int) -> int:
    """Strip access AND remove MariaDB accounts for every DISABLED user
    (disable = 1) under a customer, then purge their lookup rows. Active
    users (disable = 0) are never touched.

    Returns count of executed statements (REVOKEs + DROPs + cleanup
    DELETEs). Individual failures are logged but don't abort the rest
    — REVOKE failing on a user that has no privileges is harmless;
    DROP USER failing on a non-existent account (because of IF EXISTS)
    just no-ops; DELETE on an empty set just affects 0 rows.
    """
    stmts = _collect_revokes(conn, customer_code)
    ok = 0
    # Phase 1: REVOKE then DROP per user.
    for stmt in stmts:
        try:
            conn.execute(text(stmt))
            ok += 1
        except Exception as e:
            log.warning("revoke/drop failed (%s): %s", stmt[:80], e)
    # Phase 2: purge any lingering lookup rows for the disabled users
    # (scoped to disable = 1 so active users' rows survive).
    for stmt in _REVOKE_CLEANUP_STATEMENTS:
        try:
            conn.execute(text(stmt), {"cc": customer_code})
            ok += 1
        except Exception as e:
            log.warning("revoke cleanup failed (%s): %s", stmt[:80], e)
    total = len(stmts) + len(_REVOKE_CLEANUP_STATEMENTS)
    log.info(
        "revokes_for_customer(%s): %d/%d ok", customer_code, ok, total
    )
    return ok


# ---------------------------------------------------------------------------
# Targeted disable propagation (edit-time safety net)
# ---------------------------------------------------------------------------
# When a CS agent flips a user's `disable` flag in the Users tab, mirror it
# into every denormalized user_details* table for that one user — WITHOUT a
# full refresh. The apps gate login on user_details.disable, so:
#   disable -> 1  blocks app access immediately, even if the agent forgets to
#                 Remove grants (the MariaDB account is left intact).
#   disable -> 0  restores access immediately by flipping the flag back, so an
#                 accidental disable + re-enable round-trips with no Run grants.
# We UPDATE in place (not DELETE) precisely so re-enable is a cheap flip. A
# user not yet present in a given table just updates 0 rows there (already
# invisible to that app) — harmless.
#
# propagate_disable and purge_user_details run inside the request's
# transaction, so two errors must never be swallowed: a deadlock (1213)
# rolls back the WHOLE transaction server-side — including the request's
# customer_users change — and a lock wait timeout (1205) abandons the
# statement. Carrying on would commit a partial edit, or a fresh implicit
# transaction missing the request's earlier writes, and report success.
# Both are likeliest while a refresh (Run grants) is running.
_TXN_ABORT_ERRNOS = frozenset({1205, 1213})


def _aborts_transaction(e: BaseException) -> bool:
    args = getattr(getattr(e, "orig", None), "args", None)
    return bool(args) and args[0] in _TXN_ABORT_ERRNOS


def propagate_disable(conn: Connection, *, user_id: str, disable: int) -> int:
    """Set `disable` = <disable> for one user across every user_details*
    table. Returns total rows updated. Per-table failures are logged but
    don't abort the rest (a missing table or row is not fatal)."""
    total = 0
    for tbl in _USER_DETAILS_TABLES:
        try:
            r = conn.execute(
                text(f"UPDATE {tbl} SET `disable` = :d WHERE user_id = :uid"),
                {"d": disable, "uid": user_id},
            )
            total += r.rowcount or 0
        except Exception as e:
            if _aborts_transaction(e):
                raise
            log.warning("propagate_disable failed on %s: %s", tbl, e)
    log.info("propagate_disable(%s -> %s): %d rows", user_id, disable, total)
    return total


# ---------------------------------------------------------------------------
# Lookup-row purge for one user (customer-reassignment safety net)
# ---------------------------------------------------------------------------
# When a user moves to a different customer, their existing user_details*
# rows describe the OLD pairing: old customer_code, old customer_name, and
# the OLD customer's databases (the refresh builds each row by joining the
# customer to ITS datasets).
#
# Renumbering customer_code in place would be actively wrong — it would
# produce rows claiming the new customer while still granting the old
# customer's databases. So we DELETE instead. The user drops out of the
# lookup tables until a refresh rebuilds them under the new customer, which
# is what "Run grants" does (it force-refreshes first). Access stops rather
# than becoming subtly wrong; that's the safe direction to fail.
def purge_user_details(conn: Connection, *, user_id: str) -> int:
    """Remove one user's rows from every user_details* table. Returns total
    rows deleted. Scoped by user_id alone — it's globally unique across
    customers. Per-table failures are logged but don't abort the rest."""
    total = 0
    for tbl in _USER_DETAILS_TABLES:
        try:
            r = conn.execute(
                text(f"DELETE FROM {tbl} WHERE user_id = :uid"),
                {"uid": user_id},
            )
            total += r.rowcount or 0
        except Exception as e:
            if _aborts_transaction(e):
                raise
            log.warning("purge_user_details failed on %s: %s", tbl, e)
    log.info("purge_user_details(%s): %d rows", user_id, total)
    return total


# ---------------------------------------------------------------------------
# Single-user account revoke
# ---------------------------------------------------------------------------
# Same two statements revokes_for_customer generates, aimed at ONE user
# instead of "every disabled user under customer X".
#
# revokes_for_customer can't serve this case: it selects on
# `disable = 1 AND customer_code = :cc`, so reaching a specific active user
# through it means flipping them to disabled, running it, and flipping them
# back — three extra steps, a transient disabled state in the canonical
# table, and it would drop OTHER disabled users of that customer as a side
# effect. Targeting the user_id directly avoids all of that.
#
# There is no partial revoke: privileges are stripped by dropping the
# account outright, which is why this is coarse. The account comes back on
# the next "Run grants" for the user's customer, same password, with only
# that customer's databases.
#
# MUST run on a raw (AUTOCOMMIT) connection — DROP USER implicitly commits
# in MariaDB, so calling it inside a request transaction would commit that
# transaction early.
def revoke_user_account(conn: Connection, *, user_id: str) -> int:
    """REVOKE ALL PRIVILEGES then DROP USER for one user. Returns the count
    of statements that succeeded. A REVOKE against a user with no
    privileges, or a DROP of an account that never existed, is harmless —
    both are logged and skipped."""
    # An account name can't be a bind parameter in DDL, so it's inlined.
    # Escape by doubling any backtick, the MariaDB identifier-quoting rule,
    # so a stored user_id can't terminate the quote and inject.
    quoted = user_id.replace("`", "``")
    stmts = (
        f"REVOKE ALL PRIVILEGES, GRANT OPTION FROM `{quoted}`@`%`",
        f"DROP USER IF EXISTS `{quoted}`@`%`",
    )
    ok = 0
    for stmt in stmts:
        try:
            conn.execute(text(stmt))
            ok += 1
        except Exception as e:
            log.warning("revoke_user_account failed (%s): %s", stmt[:60], e)
    log.info("revoke_user_account(%s): %d/%d ok", user_id, ok, len(stmts))
    return ok