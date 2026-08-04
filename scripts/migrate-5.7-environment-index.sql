-- Migration 5.7 — Environment index & grounded feasibility
--
-- Adds the feasibilityAnalysis column used by the two-stage feasibility route.
-- Safe to run repeatedly (IF NOT EXISTS). No data changes, no destructive ops.
--
-- Run against the Postgres database BEFORE deploying the
-- feature/environment-index-tool-loop branch:
--
--   psql "$DATABASE_URL" -f scripts/migrate-5.7-environment-index.sql
--
-- (Or paste into the Vercel/Neon SQL console.)
-- Note: Prisma-managed identifiers are camelCase and must stay double-quoted.

ALTER TABLE "Requirement"
  ADD COLUMN IF NOT EXISTS "feasibilityAnalysis" TEXT;

-- TenantObjectFile needs no changes: requirementId is already nullable, which
-- is what environment-scoped (whole-export) rows use.
