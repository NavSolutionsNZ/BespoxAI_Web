# Environment Index & Grounded Feasibility

**Branch:** `feature/environment-index-tool-loop`
**Migration required before merge:** yes — `scripts/migrate-5.7-environment-index.sql`

## What this adds

The customer-specific grounding layer: whole-environment object ingest, a
queryable per-tenant index, and an Anthropic tool-use loop that lets the
feasibility flow read the customer's *actual* objects before making claims.

| Piece | File | What it does |
|---|---|---|
| Parser enrichment | `lib/bc-object-parser.ts` | Now also extracts `modTags` (Start/Stop AP wrappers, `// AP####`, `Description=AP####`, Version List tags), `references` (var declarations, RunObject, SourceTable, TableRelation, direct RUN calls, AL `::` scoping and `extends`), `customFields` (50000-range; all fields on AL extensions), and `versionList`. Additive — existing summary keys unchanged. |
| Pure retrieval logic | `lib/bc-retrieval-core.ts` | Customisation detection, where-used matching, latest-version dedupe. No DB — unit tested directly. |
| Retrieval layer | `lib/bc-retrieval.ts` | Tenant-scoped queries over `TenantObjectFile`: `findObjects`, `getObject` (full source, 60k char cap), `listCustomisations`, `whereUsed`, `objectInventory`. Dedupes to the latest version of each object across environment- and requirement-scoped rows. |
| Tool loop | `lib/ai-tools.ts` | Four Anthropic tool definitions (`find_objects`, `get_object`, `list_customisations`, `where_used`) plus `runIndexToolLoop` — the agentic executor with iteration cap, usage accounting, and a tool trace. Anthropic-only. |
| Environment ingest | `app/api/tenants/[id]/objects/route.ts` | POST a whole export (multipart or JSON), it splits multi-object C/AL files, parses, and upserts per object. GET returns the inventory. Optional `pushToGitHub` commits the raw export files to `environment/main` in the tenant repo. Superadmin only for POST. |
| Feasibility v2 | `app/api/requirements/[id]/feasibility/route.ts` | Two-stage. Stage 1 is the existing classifier, unchanged (still dual-provider). Stage 2 runs only when the result is `development`, the provider is Anthropic, and the tenant has indexed objects: an agentic tool-loop analysis producing `affectedObjects`, `existingCustomisations`, `conflicts`, `suggestedApproach`, `riskNotes`, and `confirmedCostRange`, stored as JSON in the new `Requirement.feasibilityAnalysis` column. Stage-2 failure is non-fatal — stage 1 still saves. |
| Usage tracking | `lib/ai-usage.ts` | New feature key `feasibility_analysis`. |
| Schema | `prisma/schema.prisma` + `scripts/migrate-5.7-environment-index.sql` | One nullable TEXT column. Idempotent. |
| Tests | `tests/*.test.ts` | 24 unit tests: parser extraction (mod tags, references, custom fields, multi-object split, regressions) and pure retrieval logic. |

## Deployment order

1. **Run the migration** against production Postgres *before* merging:
   ```
   psql "$DATABASE_URL" -f scripts/migrate-5.7-environment-index.sql
   ```
   Safe to run now — one `ADD COLUMN IF NOT EXISTS`, nothing reads it until the code deploys. (`prisma db push` after pulling the branch also works if you prefer.)
2. **Merge the branch** to `main`; Vercel deploys as usual.
3. Nothing else. No env vars, no config. Existing behaviour is unchanged for tenants with no indexed objects — stage 2 simply doesn't run.

## Ingesting a customer environment

Export the objects from the customer's NAV/BC14 (File → Export as text, all
objects or the customised set), then as superadmin:

```bash
curl -X POST "https://bespoxai.com/api/tenants/{tenantId}/objects" \
  -H "Cookie: <your session cookie>" \
  -F "files=@AllObjects.txt" \
  -F "pushToGitHub=true"
```

Or JSON: `{ "files": [{ "filename": "AllObjects.txt", "content": "..." }], "pushToGitHub": true }`

- Multi-object C/AL exports split automatically; each object gets its own row with its own source.
- Re-ingesting refreshes objects in place (matched on tenant + type + id), so a
  scheduled quarterly re-export is the whole "sync" story.
- Existing per-requirement rows keep their requirement link when refreshed.
- `pushToGitHub` commits the raw export file(s) to `environment/main` in the
  tenant repo — provenance and diff history between refreshes, without one
  API call per object.
- Check what's indexed: `GET /api/tenants/{tenantId}/objects` returns totals,
  counts by type, customised count, and every AP/CR tag found.

**Tip:** exporting only Modified=Yes objects plus anything in the 50000+ ID
range gives the customisation delta — smaller, faster, and it's what the
analysis actually uses. Full exports work too; the index just gets bigger.

## What feasibility now does

Run the feasibility check as before. For `development` results on tenants with
an index, the response's requirement now includes `feasibilityAnalysis` (JSON
string) with the grounded analysis and a `_meta` block showing how many tool
calls the model made. The UI doesn't render it yet — that's deliberately left
for a separate front-end pass so this branch stays back-end only.

The same `runIndexToolLoop` is ready to drop into `ai-spec` and the coding
assistant (replacing its stuff-every-object-into-the-prompt approach) — both
are one-prompt-plus-plumbing changes now, left out of this branch to keep the
review reviewable.

## Testing

```bash
npm test          # 24 unit tests, no DB needed (node:test via tsx)
```

Manual end-to-end once deployed:
1. Ingest an export for a test tenant (the GWM dev tenant works).
2. `GET /api/tenants/{id}/objects` — confirm counts and that your AP tags appear in `modTags`.
3. Create a requirement describing a change that touches a customised area, run feasibility, and inspect `feasibilityAnalysis` — it should cite real object numbers from the export, and conflicts should reference actual AP tags.
4. Run one describing a change in an *untouched* area — `existingCustomisations` should be empty or note nothing relevant, not hallucinate.

## Known limitations / next steps

- **whereUsed matches parser-extracted references** — names and numbers from
  declarations, properties, and direct calls. Dynamic references
  (`OBJECT.RUN(variable)`) and RecordRef-by-number usage won't be caught. The
  analysis prompt tells the model to flag what it couldn't verify.
- **No baseline diffing yet.** For C/AL full exports, all base objects are
  indexed as-is; customisation detection relies on tags and 50000-range fields
  (which matches Incadea/Webbline convention). Phase two: vanilla baseline
  library + automatic delta detection for untagged modifications.
- **Stage 2 is Anthropic-only.** The OpenAI path still covers the classifier
  and other single-shot calls. Standardising agentic routes on one provider
  avoids maintaining two tool-loop implementations.
- **Ingest is superadmin-only** for now. A customer/partner-facing upload UI is
  a front-end task.
