-- =============================================================================
-- CS Tool :: initial migration
-- =============================================================================
-- Run once, as a MariaDB admin user, BEFORE first startup of the tool.
--
-- This migration:
--   1. Creates the service-account MariaDB user the app connects as for
--      reads, writes, refresh, and grants execution.
--   2. Grants that user the privileges it needs.
--   3. Creates secure.cs_audit_log — the append-only record of every change
--      the tool makes.
--
-- There is NO separate "CS agents" table. Admin access to this tool is
-- determined entirely by a user's customer_code in the existing
-- user_details_internal_2026 view — anyone whose customer_code equals the
-- admin code (default 717) is authorized. Login validates the supplied
-- password by opening a transient MariaDB connection as the user themselves.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Service account
-- -----------------------------------------------------------------------------
-- NOTE: Replace 'REPLACE_ME_SERVICE_PASSWORD' with the real password BEFORE
--       running this file. Keep it out of version control.

CREATE USER IF NOT EXISTS 'cs_tool_svc'@'%' IDENTIFIED BY 'REPLACE_ME_SERVICE_PASSWORD';

-- Privileges the service account needs. GRANT OPTION is required because
-- this tool issues GRANT statements against end-user accounts as part of
-- the provisioning flow.
GRANT CREATE USER ON *.* TO 'cs_tool_svc'@'%';
GRANT RELOAD      ON *.* TO 'cs_tool_svc'@'%';
GRANT GRANT OPTION ON *.* TO 'cs_tool_svc'@'%';

GRANT ALL PRIVILEGES ON `secure`.*       TO 'cs_tool_svc'@'%';
GRANT ALL PRIVILEGES ON `myuser`.*       TO 'cs_tool_svc'@'%';
GRANT ALL PRIVILEGES ON `imic_control`.* TO 'cs_tool_svc'@'%';

-- Read-only visibility elsewhere so we can introspect and so GRANT targets
-- exist when we try to grant against them.
GRANT SELECT ON `app_control`.* TO 'cs_tool_svc'@'%';
GRANT SELECT ON `user_data`.*   TO 'cs_tool_svc'@'%';
GRANT SELECT ON `esri`.*        TO 'cs_tool_svc'@'%';

FLUSH PRIVILEGES;

-- -----------------------------------------------------------------------------
-- 2. Audit log (append-only)
-- -----------------------------------------------------------------------------
-- Every create, update, password reveal, and admin action writes one row
-- here. user_id is the MariaDB user_id of the CS agent who performed the
-- action; there is no numeric FK since we don't maintain a separate agents
-- table.

USE `secure`;

CREATE TABLE IF NOT EXISTS `cs_audit_log` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(64)     NULL,            -- user_id of the CS agent
  `action`         VARCHAR(48)     NOT NULL,        -- e.g. 'user.edit.user'
  `entity_type`    VARCHAR(48)     NOT NULL,        -- e.g. 'customer_users'
  `entity_key`     VARCHAR(255)    NULL,            -- e.g. 'jdoe|flal'
  `before_json`    LONGTEXT        NULL,
  `after_json`     LONGTEXT        NULL,
  `notes`          VARCHAR(500)    NULL,
  `ip`             VARCHAR(64)     NULL,
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_audit_agent`   (`user_id`),
  KEY `ix_audit_entity`  (`entity_type`, `entity_key`),
  KEY `ix_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
