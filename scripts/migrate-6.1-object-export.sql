-- Migration 6.1 — Partner licences + BCAgent full object export (upgrade readiness, phase P3)
-- Run in Vercel Postgres Dashboard → Storage → Query.
-- Safe to run repeatedly (IF NOT EXISTS). New tables + two nullable Tenant columns; no data changes.
-- See BESPOXAI_UPGRADE_READINESS_RAG_DESIGN.md §14.

-- Developer licences used for full exports. partnerAccountId NULL = Nav Solutions Limited.
-- Licence bytes are AES-256-GCM encrypted with LICENCE_ENCRYPTION_KEY and never returned to browsers.
CREATE TABLE IF NOT EXISTS "PartnerLicence" (
  "id"               TEXT         NOT NULL,
  "partnerAccountId" TEXT,
  "fileName"         TEXT         NOT NULL,
  "sizeBytes"        INTEGER      NOT NULL,
  "sha256"           TEXT         NOT NULL,
  "encrypted"        TEXT         NOT NULL,
  "expiresAt"        TIMESTAMP(3),
  "uploadedById"     TEXT         NOT NULL,
  "uploadedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerLicence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerLicence_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId")
    REFERENCES "PartnerAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- One licence per partner, and one for Nav Solutions (the NULL row)
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerLicence_partnerAccountId_key"
  ON "PartnerLicence" ("partnerAccountId") WHERE "partnerAccountId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerLicence_nsl_key"
  ON "PartnerLicence" ((1)) WHERE "partnerAccountId" IS NULL;

-- One row per scheduled full export. This table is also the licence-use audit log.
CREATE TABLE IF NOT EXISTS "ObjectExportJob" (
  "id"                TEXT         NOT NULL,
  "tenantId"          TEXT         NOT NULL,
  "requestedById"     TEXT         NOT NULL,
  "licenceOwnerId"    TEXT,                                  -- partnerAccountId whose licence is used; NULL = Nav Solutions
  "notBefore"         TIMESTAMP(3) NOT NULL,
  "outOfHours"        BOOLEAN      NOT NULL DEFAULT true,     -- false = scheduled inside 05:00–22:00 tenant time, after a warning
  "status"            TEXT         NOT NULL DEFAULT 'scheduled', -- scheduled | running | uploaded | processing | complete | failed | stale
  "jobTokenHash"      TEXT         NOT NULL,
  "licenceFetchedAt"  TIMESTAMP(3),
  "startedAt"         TIMESTAMP(3),
  "finishedAt"        TIMESTAMP(3),
  "error"             TEXT,
  "finsqlLog"         TEXT,
  "restoreVerified"   BOOLEAN,
  "chunkCount"        INTEGER,
  "corpusId"          TEXT,
  "matchConfidence"   TEXT,
  "summary"           JSONB,
  "repoOwner"         TEXT,
  "repoName"          TEXT,
  "exportCommit"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObjectExportJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ObjectExportJob_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ObjectExportJob_tenantId_createdAt_idx" ON "ObjectExportJob" ("tenantId", "createdAt");

-- Upload chunks (gzip of the raw finsql export), held only until processing finishes.
CREATE TABLE IF NOT EXISTS "ObjectExportChunk" (
  "jobId"  TEXT    NOT NULL,
  "seq"    INTEGER NOT NULL,
  "data"   BYTEA   NOT NULL,
  CONSTRAINT "ObjectExportChunk_pkey" PRIMARY KEY ("jobId", "seq"),
  CONSTRAINT "ObjectExportChunk_jobId_fkey" FOREIGN KEY ("jobId")
    REFERENCES "ObjectExportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Per-object delta against the base corpus. Only objects that differ from the base are stored;
-- counts for unmodified objects live in ObjectExportJob.summary. Rebuilt on each export.
CREATE TABLE IF NOT EXISTS "TenantObjectDelta" (
  "id"           TEXT         NOT NULL,
  "tenantId"     TEXT         NOT NULL,
  "jobId"        TEXT         NOT NULL,
  "corpusId"     TEXT         NOT NULL,
  "objectType"   TEXT         NOT NULL,
  "objectId"     INTEGER      NOT NULL,
  "objectName"   TEXT         NOT NULL,
  "origin"       TEXT         NOT NULL,                       -- standard_modified | custom_new | isv_or_unknown
  "versionList"  TEXT,
  "modTags"      JSONB        NOT NULL DEFAULT '[]',
  "unattributed" BOOLEAN      NOT NULL DEFAULT false,
  "diff"         JSONB,
  "findings"     JSONB        NOT NULL DEFAULT '[]',
  "effort"       TEXT         NOT NULL,
  "filePath"     TEXT,                                        -- path in the tenant repo
  "computedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantObjectDelta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantObjectDelta_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TenantObjectDelta_jobId_fkey" FOREIGN KEY ("jobId")
    REFERENCES "ObjectExportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TenantObjectDelta_tenantId_corpusId_idx" ON "TenantObjectDelta" ("tenantId", "corpusId");
CREATE INDEX IF NOT EXISTS "TenantObjectDelta_jobId_idx" ON "TenantObjectDelta" ("jobId");

-- Tenant: customer object ID ranges (default 50000–99999 when NULL) and IANA time zone
-- (NULL = derived from country) for the out-of-hours warning.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "customIdRanges" JSONB;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "timeZone"       TEXT;
