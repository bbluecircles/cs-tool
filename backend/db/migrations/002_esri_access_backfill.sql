-- =============================================================================
-- CS Tool :: 002 — backfill esri_access from web_esri_access
-- =============================================================================
-- Run once, as a MariaDB admin user. Safe to re-run (idempotent).
--
-- WHY
-- ---
-- Two columns on secure.customer_users look like they control ESRI:
--
--   esri_access      -- the ONLY input to the MariaDB grant. sync_sql's
--                       generator reads `... AND esri_access = 1` and emits
--                       GRANT SELECT ON `esri`.*, matching the DBA's
--                       reference grant script.
--   web_esri_access  -- a web-app feature flag. It appears in the refresh
--                       SELECT lists and in NO grant generator, so by
--                       itself it grants nothing.
--
-- The Users tab only ever exposed "Web ESRI"; esri_access was hidden. CS
-- agents turned on the visible flag, reasonably assumed ESRI was granted,
-- and no privilege was ever issued — the app then reported "no permissions
-- for ESRI" for those users.
--
-- Going forward customer_users_repo keeps the two in step on every write.
-- This migration fixes the rows written before that.
--
-- SCOPE
-- -----
-- Only turns esri_access ON, and only where the web flag is already on. It
-- never turns anything off, so a user whose esri_access was set directly by
-- a DBA (web flag off) keeps it. Disabled users are included deliberately:
-- the column should be correct whenever they are re-enabled, and disabled
-- users are excluded from the refresh anyway, so this grants nothing now.
-- =============================================================================

-- Preview first — this is the set about to change. Run it, eyeball the
-- count, then run the UPDATE below.
SELECT customer_code, user_id, `disable`, esri_access, web_esri_access, esri_state
FROM   secure.customer_users
WHERE  web_esri_access = 1 AND (esri_access IS NULL OR esri_access <> 1)
ORDER  BY customer_code, user_id;

UPDATE secure.customer_users
SET    esri_access = 1,
       modify_date = NOW()
WHERE  web_esri_access = 1
  AND  (esri_access IS NULL OR esri_access <> 1);

-- Verify: expected to return zero rows afterwards.
SELECT COUNT(*) AS still_mismatched
FROM   secure.customer_users
WHERE  web_esri_access = 1 AND (esri_access IS NULL OR esri_access <> 1);

-- -----------------------------------------------------------------------------
-- AFTERWARDS
-- -----------------------------------------------------------------------------
-- The denormalized user_details* tables still carry the old esri_access
-- until a refresh rebuilds them, and the grant generators read from those
-- (myuser.user_details_2026), not from secure.customer_users directly.
--
-- So for each affected customer, run Admin -> Run grants. That force-
-- refreshes first, then issues GRANT SELECT ON `esri`.* for the users this
-- migration corrected. Nothing is granted until that happens.
--
-- To list the customers needing a grants run, capture this BEFORE the
-- UPDATE above (afterwards the predicate matches nothing):
--
--   SELECT DISTINCT customer_code
--   FROM   secure.customer_users
--   WHERE  web_esri_access = 1 AND (esri_access IS NULL OR esri_access <> 1)
--     AND  `disable` = 0
--   ORDER  BY customer_code;
