-- =============================================================================
-- CS Tool :: 003 — provider_directory_access (per-user 0/1 flag)
-- =============================================================================
-- Run once, as a MariaDB admin, on the PRIMARY (the ALTERs replicate).
-- Safe to re-run: every ALTER is ADD COLUMN IF NOT EXISTS.
--
-- WHAT
-- ----
-- Adds provider_directory_access TINYINT(1) NOT NULL DEFAULT 0 to:
--
--   secure.customer_users              source of truth, one value per user
--   secure.user_details_internal_2026  rebuilt from customer_users by the
--                                      refresh ("Run grants")
--   myuser.user_details_2026           rebuilt from user_details_internal_2026
--
-- The tool's UI keeps the column hidden for now. Appending a column with a
-- default is an instant (metadata-only) change on InnoDB, MariaDB 10.3+.
--
-- DEPLOY ORDER — this matters
-- ---------------------------
-- The OLD refresh code inserted into these tables by column POSITION, so a
-- new column made its INSERT fail right after its TRUNCATE had emptied the
-- table — the Nov 2026 incident. So:
--
--   1. The refresh-safety change (one transaction, columns matched by name)
--      must be live first. Until it is, nobody runs "Run grants".
--   2. Run this file.
--   3. Deploy the code that reads/writes provider_directory_access.
--
-- If step 3 goes out before step 2, nothing is damaged: Run grants refuses
-- ("... has no column provider_directory_access"), changing nothing, and
-- the Users tab errors until this file has been run.
--
-- secure.user_details_internal_2026 may already have the column (it was
-- added there ahead of this change); IF NOT EXISTS leaves it as it is. The
-- check at the bottom shows the column on all three tables so the types
-- can be compared.
-- =============================================================================

ALTER TABLE secure.customer_users
    ADD COLUMN IF NOT EXISTS provider_directory_access TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE secure.user_details_internal_2026
    ADD COLUMN IF NOT EXISTS provider_directory_access TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE myuser.user_details_2026
    ADD COLUMN IF NOT EXISTS provider_directory_access TINYINT(1) NOT NULL DEFAULT 0;

-- Check: expect 3 rows with the same COLUMN_TYPE / IS_NULLABLE / COLUMN_DEFAULT.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM   information_schema.COLUMNS
WHERE  COLUMN_NAME = 'provider_directory_access'
  AND  TABLE_SCHEMA IN ('secure', 'myuser')
ORDER  BY TABLE_SCHEMA, TABLE_NAME;

-- -----------------------------------------------------------------------------
-- AFTERWARDS
-- -----------------------------------------------------------------------------
-- From the backend directory on the app server, check the refresh end to end
-- without writing anything:
--
--   python -m app.scripts.refresh_user_details --dry-run
--
-- No table should show "left at default: provider_directory_access" once the
-- code from step 3 is deployed. Then Run grants as normal.
