# BespoxAI Web Portal — Component Roadmap

**Last Updated:** June 6, 2026 (Session 17)

---

## Current State — What's Live

### ✅ Production & Working

**Session 17 — Requirement Assignment System**
- [x] Schema: `assignedDeveloperId` (non-nullable), `assignedAt`, `unableToCompleteAt`
- [x] Auto-assign to creating user on requirement creation
- [x] Admin can reassign to other developers via modal picker
- [x] Developers see only their assigned requirements (filtered list)
- [x] Developers can mark requirement "unable to complete" → admin notified
- [x] Assignment modal: circular selectors with workload indicators (light/moderate/heavy)
- [x] Modal fixes: proper state management, circles fill on click
- [x] Notifications: notifyRequirementAssigned, notifyAdminRequirementUnableToComplete
- [x] API routes: `/api/requirements/[id]/assign`, `/api/requirements/[id]/mark-unable`
- [x] Tested & confirmed live

**Session 8 — RDP Bug Fixes (v3.2)**
- [x] SupportAccountPassword inject fix — trailing comma mismatch in route.ts .replace() caused Step 8 to silently skip
- [x] agent.config.json version field was hardcoded '2.4' — now uses $AgentVersion dynamically
- [x] BCAgent bumped to v3.2 (PS1 x2 + installer/route.ts)
- [x] RDP end-to-end tested and confirmed working on TestCo1

**Session 7 — UAT Status Pipeline**
- [x] deploy-test → status: 'in_uat' on success
- [x] uat-approve → status: 'uat_confirmed'
- [x] uat-reject → status: 'uat_rejected'
- [x] STATUS_PIPELINE + STATUS_COLOR + statusLabel updated (RequirementsBuilder + admin)
- [x] UAT panel driven by status not testDeployedAt
- [x] Null-guard on testDeployedAt date display

**Session 7 — RDP Remote Support (v3.1)**
- [x] BCAgent Step 8: BespoxAI-Support account + RDP enable
- [x] rdpPassword generated on installer download, stored in DB
- [x] lib/cloudflare.ts: addRdpIngress() + createRdpDnsRecord() (isolated)
- [x] POST /api/admin/provision-rdp route
- [x] Admin tenants table: RDP button + copy password button
- [x] schema.prisma: rdpPassword added

**Session 7 — UX Fixes**
- [x] Back button: Settings tabs + Dashboard nav use router.push (history entries)
- [x] Settings always has ?tab= in URL
- [x] Preferred name site-wide: auth JWT, session, sidebars, CFO assistant, notifications
- [x] Installer download filename includes version (Install-BespoxAI-v3.2.zip)
- [x] --white CSS variable → true #ffffff
- [x] Settings overview: Production/Test Environment Details cards (consistent grid layout)
- [x] Settings overview: removed System Configuration card, Agent URL, Status, Member Since
- [x] Settings overview: "leave blank" instruction removed from test env (read-only)
- [x] Vercel MCP connected — Claude can pull deployment logs directly

**Session 6 — Deploy Pipeline (MAJOR MILESTONE)**
- [x] Deploy + Compile to Test — ✅ FULLY WORKING end-to-end on GWM Dev
- [x] BCAgent auto-stop on reinstall — ✅ confirmed seamless (Session 7)
- [x] Sync Config to Agent endpoint
- [x] navManagementPort + testNavManagementPort config fields
- [x] Installer overhaul (tenant DB values direct, version in filename, auto-stop)

**Session 5 — Security & Onboarding**
- [x] mustChangePassword + onboarding Step 0
- [x] Mobile responsiveness across all pages
- [x] notifyUserWelcome auto-sent on provision + invite

**C/AL Export Pipeline (Session 4)**
- [x] finsql.exe direct export, grouped by type, ANSI fix, ZUP isolation

**AI System**
- [x] AI provider switchable (OpenAI or Anthropic)
- [x] CFO Assistant — router + planner jsonMode:true
- [x] Per-tenant token limits + usage tracking

---

## Work Backlog (Prioritized)

### 🔴 HIGH PRIORITY

#### 1. AI-Generated Functional Spec — Make Collapsible
**Status:** Next to work on. The spec panel in admin requirement detail should be independently collapsible like other panels.
**Affects:** Admin portal requirement detail view — RequirementsBuilder component

#### 2. Deploy + Compile to Production — Test When Ready
**Status:** Code complete. Same logic as test. Will be tested when Rich is ready.

#### 3. CFO Assistant — NAV v14 OData Planner Tuning
**Status:** Live data flowing. Planner generates unsupported queries on some entities.
**Known issues:**
- `$orderby=Posting_Date desc` returns 400 on GeneralLedgerEntry, SalesInvoice in NAV v14
- `$filter` on Posting_Date not supported on posted documents
- Tiles show `,` for Overdue Debtors, Cash & Bank, Outstanding Payables (Month Revenue working)
**Fix:** Update planner system prompt in `app/api/query/route.ts`

#### 4. Async Job Pattern for Deploy Timeout
**Status:** Discussed, not implemented. Currently 60s timeout cuts connection before success.
Option B: BCAgent returns jobId immediately, portal polls for completion.
Requires BCAgent Start-Job background threading + portal polling endpoint + UI progress.

### 🟡 MEDIUM PRIORITY

#### 5. Customer Requirement View — UAT Rejection History

#### 6. Human-Readable Deployment Folder Names
Currently: `C:\BespoxAI\Deployments\{requirementId}\{timestamp}_deploy\`
Should be: `C:\BespoxAI\Deployments\{reqSlug}_{shortId}\{timestamp}_deploy\`

#### 7. Installer — Directory creation message
"Directories created under C:\BespoxAI" → "Directories verified/created under C:\BespoxAI"

#### 8. Onboarding — Enforce name entry

#### 9. Health Scanner — Real Data

#### 10. Dynamic Web Service Creation (CFO Assistant)
Note: Also prerequisite for auto-fetching Last CU from BC instance (requires custom web service exposed in BC).

#### 11. Last CU — Auto-fetch from BC
Currently manual field. BC doesn't expose CU version via standard OData.
Requires custom web service in BC (ties into #10). Deferred.

### 🟢 LOW PRIORITY

#### 12. Save AI Dev Notes to Requirement
#### 13. Phase 2 — Scheduled Production Deployment (deferred)
#### 14. VS Code Extension for Coding Assistant
#### 15. Cash Flow Intelligence (Phase 3)
#### 16. Month-End Close Assistant (Phase 2)
#### 17. Bundle cloudflared in installer zip

---

## How Claude Should Work on This Project

1. **Get PAT from Rich** at start of session
2. **Sparse checkout** — never full clone. Use `--no-cone "app" "components" "lib" "scripts" "prisma" "BESPOXAI_PROJECT_SUMMARY.md" "BESPOXAI_COMPONENT_ROADMAP.md" "BESPOXAI_FILES_INVENTORY.md"`
3. **Check imports** before every push
4. **Never import `@anthropic-ai/sdk`** — use provider-agnostic fetch pattern
5. **Never use `router.back()`** — always explicit `router.push()`
6. **Write Python fix scripts to `/tmp/fix_xxx.py`** — never heredocs in bash
7. **Targeted edits** — always verify target string is unique before replacing; view file immediately before editing
8. **Push:** `git push origin master:main`
9. **Vercel auto-deploys** in ~30–60s — can check logs via Vercel MCP (team_eZ4MqWjZdsPA2iWoK4exjjPF / prj_AT4GXatATIi2FaUCS62Ttp2AivRo)
10. **DB changes:** SQL in Vercel → Storage → Postgres → Query, then update prisma/schema.prisma
11. **Settings inputs:** always use refs + defaultValue — NEVER controlled inputs
12. **Update context files** at end of session
13. **BCAgent edits:** installer contains embedded BCAgent code — edit Install-BespoxAI.ps1 only
14. **BATCH DEPLOY RULE:** Do NOT push changes without explicit confirmation from Rich
15. **DIAGNOSE BEFORE ARCHITECTING:** Always ask for logs/errors before proposing solutions (use Vercel MCP for build errors)
16. **DISCUSS SIGNIFICANT CHANGES** before implementing
17. **BUMP VERSION on every push** — `$AgentVersion`/`$Version` in PS1 + `AGENT_VERSION` in installer/route.ts — THREE values, all must match

### SWC/JSX Rules (critical)
- Use `cond ? <JSX/> : null` NOT `cond && <JSX/>` in large function returns
- No template literals `${vars}` in JSX — use string concatenation
- No template literals in style — use string concatenation
- Large components: extract sub-sections as separate named functions OUTSIDE main component
- `React.useState` fails in standalone functions — use destructured `useState`
- Never import `@anthropic-ai/sdk` — use provider-agnostic fetch pattern
