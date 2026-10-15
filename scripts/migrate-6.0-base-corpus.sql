-- Migration 6.0 — Version base corpus (upgrade readiness, phase P1)
-- Run in Vercel Postgres Dashboard → Storage → Query.
-- Safe to run repeatedly (IF NOT EXISTS). Creates new tables only; touches no existing data.
--
-- Object SOURCE lives in the private GitHub corpus repo; these tables hold only
-- the index (summaries, normalised hashes, part hashes, file paths, blob SHAs).
-- See BESPOXAI_UPGRADE_READINESS_RAG_DESIGN.md §4.

CREATE TABLE IF NOT EXISTS "BaseCorpus" (
  "id"            TEXT         NOT NULL,
  "product"       TEXT         NOT NULL,                 -- NAV | BC
  "version"       TEXT         NOT NULL,                 -- BC14, NAV2018 …
  "build"         TEXT         NOT NULL,                 -- e.g. 14.0.29537.0
  "localisation"  TEXT         NOT NULL,                 -- W1, NZ …
  "versionTag"    TEXT         NOT NULL,                 -- corpus key: dominant local family + major, e.g. NAVAPAC14 (W1 corpora: NAVW114)
  "repoPath"      TEXT         NOT NULL,                 -- folder in corpus repo
  "repoCommit"    TEXT         NOT NULL,                 -- commit SHA ingested
  "sourceNote"    TEXT         NOT NULL,
  "status"        TEXT         NOT NULL DEFAULT 'ingesting',  -- ingesting | ready | retired
  "objectCount"   INTEGER      NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BaseCorpus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BaseCorpus_version_build_localisation_key"
  ON "BaseCorpus" ("version", "build", "localisation");

CREATE TABLE IF NOT EXISTS "BaseObject" (
  "id"          TEXT    NOT NULL,
  "corpusId"    TEXT    NOT NULL,
  "objectType"  TEXT    NOT NULL,
  "objectId"    INTEGER NOT NULL,
  "objectName"  TEXT    NOT NULL,
  "versionList" TEXT,
  "summary"     JSONB   NOT NULL DEFAULT '{}',
  "normHash"    TEXT    NOT NULL,
  "partHashes"  JSONB   NOT NULL DEFAULT '{}',
  "filePath"    TEXT    NOT NULL,
  "blobSha"     TEXT    NOT NULL,
  CONSTRAINT "BaseObject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BaseObject_corpusId_fkey" FOREIGN KEY ("corpusId")
    REFERENCES "BaseCorpus" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BaseObject_corpusId_objectType_objectId_key"
  ON "BaseObject" ("corpusId", "objectType", "objectId");
CREATE INDEX IF NOT EXISTS "BaseObject_corpusId_objectName_idx"
  ON "BaseObject" ("corpusId", "objectName");
