-- E2E test data cleanup
-- Removes requirements created by the Playwright lifecycle tests
-- (titles start with "[E2E-TEST "), plus their addenda and uploaded object files.
-- AI usage rows are kept for billing history; only their link to the
-- requirement is cleared.
--
-- Run in Vercel → Storage → Postgres → Query.
-- Step 1: run the PREVIEW query on its own and check the list.
-- Step 2: run the CLEANUP block.

-- ── Step 1: PREVIEW ─────────────────────────────────────────────────────────
SELECT r.id,
       r.title,
       r.status,
       r."createdAt",
       t.name AS tenant,
       (r."parentId" IS NOT NULL) AS is_addendum,
       (SELECT count(*) FROM "TenantObjectFile" f WHERE f."requirementId" = r.id) AS object_files,
       (SELECT count(*) FROM "AiUsageLog" a WHERE a."requirementId" = r.id)       AS ai_usage_rows
FROM "Requirement" r
JOIN "Tenant" t ON t.id = r."tenantId"
WHERE r.title LIKE '[E2E-TEST %'
   OR r."parentId" IN (SELECT id FROM "Requirement" WHERE title LIKE '[E2E-TEST %')
ORDER BY r."createdAt";

-- ── Step 2: CLEANUP ─────────────────────────────────────────────────────────
BEGIN;

UPDATE "AiUsageLog" SET "requirementId" = NULL
WHERE "requirementId" IN (
  SELECT id FROM "Requirement"
  WHERE title LIKE '[E2E-TEST %'
     OR "parentId" IN (SELECT id FROM "Requirement" WHERE title LIKE '[E2E-TEST %')
);

DELETE FROM "TenantObjectFile"
WHERE "requirementId" IN (
  SELECT id FROM "Requirement"
  WHERE title LIKE '[E2E-TEST %'
     OR "parentId" IN (SELECT id FROM "Requirement" WHERE title LIKE '[E2E-TEST %')
);

-- Addenda first (their parentId would otherwise be nulled and they'd be orphaned)
DELETE FROM "Requirement"
WHERE "parentId" IN (SELECT id FROM "Requirement" WHERE title LIKE '[E2E-TEST %');

DELETE FROM "Requirement"
WHERE title LIKE '[E2E-TEST %';

COMMIT;
