"""Canonical refresh and grant SQL.

``refresh_all`` rebuilds every ``user_details*`` denormalized view. In the
current deployment model an external process owns this refresh, so we
DON'T call it automatically after writes. The function remains available
for:
  - the admin "Retry refresh" action
  - future redeployment scenarios where the external process is retired

``grants_for_customer`` runs the per-customer CREATE USER / GRANT
statements. Called only from the admin "Run grants" action — CS agents
decide when to run it.

Both functions are unchanged from the previous version; only the calling
convention has moved.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.config import get_settings

log = logging.getLogger(__name__)


_REFRESH_STATEMENTS: tuple[str, ...] = (
    # --- secure.user_details_internal ---
    "TRUNCATE TABLE secure.user_details_internal",
    """
    INSERT IGNORE INTO secure.user_details_internal
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
    """,
    # --- secure.user_details_internal_2023 ---
    "TRUNCATE TABLE secure.user_details_internal_2023",
    """
    INSERT IGNORE INTO secure.user_details_internal_2023
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
    """,
    # --- secure.user_details_internal_2026 ---
    "TRUNCATE TABLE secure.user_details_internal_2026",
    """
    INSERT IGNORE INTO secure.user_details_internal_2026
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
    """,
    # --- myuser.user_details (encrypted password variant) ---
    "TRUNCATE TABLE myuser.user_details",
    """
    INSERT IGNORE INTO myuser.user_details
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
    """,
    # --- myuser.user_details_2023 ---
    "TRUNCATE TABLE myuser.user_details_2023",
    """
    INSERT IGNORE INTO myuser.user_details_2023
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
    """,
    # --- myuser.user_details_2026 ---
    "TRUNCATE TABLE myuser.user_details_2026",
    """
    INSERT IGNORE INTO myuser.user_details_2026
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
    """,
    # --- imic_control.user_details ---
    "TRUNCATE TABLE imic_control.user_details",
    """
    INSERT IGNORE INTO imic_control.user_details
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
    """,
    # --- imic_control.user_details_2023 (discharge datasets only) ---
    "TRUNCATE TABLE imic_control.user_details_2023",
    """
    INSERT IGNORE INTO imic_control.user_details_2023
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
    """,
)


class RefreshDisabled(RuntimeError):
    """Raised when refresh_all is called while ENABLE_VIEW_REFRESH is off."""


def refresh_all(conn: Connection, *, force: bool = False) -> None:
    """Truncate and rebuild every user_details* view, serialized by advisory
    lock. Respects ENABLE_VIEW_REFRESH — if the flag is off, refuses to run
    rather than silently doing nothing, so the admin UI can show a clear
    "disabled by config" message.

    Pass force=True to bypass the config flag. Used by retry_grants, which
    needs the refresh to happen unconditionally — otherwise a brand-new
    user inserted seconds ago wouldn't show up in user_details_internal_2026
    and the grants step would generate zero statements with no error,
    leaving the agent with a "0 statements applied" success message and a
    user who can't log in.
    """
    if not force and not get_settings().enable_view_refresh:
        raise RefreshDisabled(
            "View refresh is disabled via ENABLE_VIEW_REFRESH=false."
        )

    got_lock = conn.execute(
        text("SELECT GET_LOCK('cs_tool_refresh', 30)")
    ).scalar()
    if not got_lock:
        raise RuntimeError(
            "Could not acquire cs_tool_refresh lock within 30s; "
            "another refresh is in flight."
        )
    try:
        for stmt in _REFRESH_STATEMENTS:
            conn.execute(text(stmt))
        log.info("refresh_all: completed %d statements", len(_REFRESH_STATEMENTS))
    finally:
        conn.execute(text("SELECT RELEASE_LOCK('cs_tool_refresh')"))


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

    # State/claims DB (per-user database_name)
    """
    SELECT CONCAT('GRANT SELECT ON `', database_name, '`.* TO `', user_id, '`@`%`;')
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
            log.warning("propagate_disable failed on %s: %s", tbl, e)
    log.info("propagate_disable(%s -> %s): %d rows", user_id, disable, total)
    return total