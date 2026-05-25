# BespoxAI Web Portal — Component Roadmap

**Last Updated:** May 25, 2026 (Session 6)

---

## Current State — What's Live

### ✅ Production & Working

**Session 6 — Deploy Pipeline (MAJOR MILESTONE)**
- [x] Deploy + Compile to Test — ✅ FULLY WORKING end-to-end on GWM Dev
- [x] Import-NAVApplicationObject: -Confirm:$false, $NavIde set from finsql wildcard search
- [x] Compile-NAVApplicationObject: NavServerInstance + NavServerManagementPort (env-specific)
- [x] Environment-specific $mgmtPort variable (prod vs test)
- [x] testBcInstance fallback for testNavServerInstance in compile
- [x] Response write try-catch for dropped connections
- [x] Deploy to Production: code complete, not yet tested

**Session 6 — Sync Config to Agent**
- [x] BCAgent: POST /bespoxai/update-config endpoint — writes config + updates in-memory vars
- [x] API: POST /api/settings/sync-config
- [x] UI: "↑ Sync Config to Agent" button in BC Installer tab
- [x] Changed-fields-only log output

**Session 6 — Installer Overhaul**
- [x] All PS1 replace calls use tenant DB values directly (not body)
- [x] Test env fields NOT saved from installer route (fixed overwrite bug)
- [x] agent.config.json includes bcPort, agentPort, correct bcBaseUrl with instance
- [x] Version shown on Download Installer button (dynamic from GET /api/settings/installer)
- [x] Installer banner shows all prod + test env fields
- [x] BAT/ZIP filename includes version number
- [x] Auto-stop existing BCAgent on reinstall (netstat + BCAgent.ps1 CommandLine check)
- [x] No uninstall needed before reinstalling

**Session 6 — New Config Fields**
- [x] navManagementPort (production) — schema, API, ProdEnvForm, PS1, BCAgent, sync-config
- [x] testNavManagementPort (test) — schema, API, TestEnvForm, PS1, BCAgent, sync-config
- [x] testNavServerInstance — explicit UI field in TestEnvForm
- [x] schema.prisma: mustChangePassword, navManagementPort, testNavManagementPort all added

**Session 5 — Deploy Pipeline**
- [x] Sync from GitHub → DB button in admin deploy panel
- [x] Write files to server (BCAgent deployment folder) — Stream.Read() loop fix, JSON path escaping
- [x] writeSnapshotId persisted to DB after write — Step 2 available across sessions
- [x] Deploy-test + deploy-prod routes hardened (try-catch, text-first JSON parse)
- [x] Deploy error messages now show real errors in UI

**Session 5 — Security & Onboarding**
- [x] mustChangePassword column on User
- [x] Onboarding Step 0: force password change on first login
- [x] change-password API route
- [x] Settings → Profile: ChangePasswordCard for existing users
- [x] notifyUserWelcome: auto-sent on provision + invite
- [x] mustChangePassword=true set on all new user creation paths

**Session 5 — Mobile Responsiveness**
- [x] Dashboard: slide-over sidebar, auto-close on nav, compact header/badge
- [x] Settings: sticky top nav, horizontal tabs, fluid grids, scroll-to-top
- [x] Admin: slide-over sidebar, ☰ hamburger, auto-close on tab select
- [x] Onboarding: sidebar hidden on mobile, reduced padding
- [x] Billing: responsive header, wrapping plan cards
- [x] Login/Signup: tightened corner links, clamp() card padding

**Session 5 — Admin**
- [x] Tenant STATUS shows Connected/Not Connected (based on tunnelId, not active flag)
- [x] ConnectedPill component (separate from StatusPill)

**C/AL Export Pipeline (Session 4)**
- [x] finsql.exe direct export (BC14 compatible), grouped by type, ANSI fix, ZUP isolation
- [x] End-to-end: fetch → parse → GitHub → push

**BCAgent v2.9 (Sessions 4–6)**
- [x] HttpWebRequest (not HttpClient) — reliable NTLM on Windows Server
- [x] Scheduled task runs as BC user — NTLM/Kerberos via Windows token
- [x] UseDefaultCredentials=true — browser SSO equivalent
- [x] cloudflared --protocol http2, service auto-restart
- [x] Stream.Read() loop — fixes large payload truncation
- [x] JSON path escaping — fixes immediate parse errors
- [x] Full deploy pipeline with NavModelTools integration
- [x] Sync config endpoint
- [x] Auto-stop on reinstall

**AI System**
- [x] AI provider switchable (OpenAI or Anthropic)
- [x] Per-tenant token limits + usage tracking
- [x] CFO Assistant — router + planner jsonMode:true
- [x] Dev plan, Coding Assistant, Dev Assistant

**Phase 2 — Production Deployment**
- [x] Go-live doc generation + customer approval flow
- [x] BCAgent prod deploy route (hardened)
- [x] Full notification chain

**Customer Onboarding (Sessions 3–6)**
- [x] Full onboarding flow (steps 0–5)
- [x] BC + NAV version selection
- [x] firstName/lastName/preferredName
- [x] BC connection fields
- [x] Welcome email with temp credentials

**Settings (Sessions 3–6)**
- [x] Mobile responsive sticky nav
- [x] ProdEnvForm + TestEnvForm with all fields including management ports
- [x] ChangePasswordCard (collapsible)
- [x] Sync Config to Agent button

---

## Work Backlog (Prioritized)

### 🔴 HIGH PRIORITY

#### 1. BCAgent Auto-Stop on Reinstall — Final Verification
**Status:** Testing in progress (v2.9). netstat + BCAgent.ps1 CommandLine check approach.
Rich to confirm next session whether reinstall is now seamless.

#### 2. Deploy + Compile to Production — Test When Ready
**Status:** Code complete. Same logic as test with $NavMgmtPort and $NavServerInst.
Will be tested when Rich is ready for production deployment.

#### 3. CFO Assistant — NAV v14 OData Planner Tuning
**Status:** BCAgent working, live data flowing. Planner generates unsupported queries on some entities.
**Known issues:**
- `$orderby=Posting_Date desc` returns 400 on GeneralLedgerEntry, SalesInvoice in NAV v14
- `$filter` on Posting_Date not supported on posted documents
- Tiles show `,` for Overdue Debtors, Cash & Bank, Outstanding Payables (Month Revenue working)
**Fix:** Update planner system prompt in `app/api/query/route.ts`

#### 4. Preferred Name — Site-wide + AI Interactions
**Status:** Dashboard greeting done.
- Email notifications (`lib/notifications.ts`) — use preferredName ?? firstName
- AI system prompts (`lib/tenant-context.ts`) — address user by preferredName
- CFO assistant greeting uses "Brian" instead of correct name

### 🟡 MEDIUM PRIORITY

#### 5. Collapsible Sections in Admin Requirements View
All panels (AI spec, feasibility, dev plan, coding assistant, deploy panel etc.) should be independently collapsible.

#### 6. Human-Readable Deployment Folder Names
Currently: `C:\BespoxAI\Deployments\cmpi4tisk00011422fazu1pxx\20260523_163211_deploy\`
Should be: `C:\BespoxAI\Deployments\add-release-date_cmpi4t\20260523_1632_deploy\`
Requires passing requirement title slug to BCAgent.

#### 7. Installer — Directory creation message
Change "Directories created under C:\BespoxAI" → "Directories verified/created under C:\BespoxAI"

#### 8. Separate Test Server Support
Schema/routing done. TestEnvForm simplified to same-server only. Second BCAgent installer when needed.

#### 9. Customer Requirement View — UAT Rejection History

#### 10. Onboarding — Enforce name entry

#### 11. Dynamic Web Service Creation (CFO Assistant)

#### 12. Health Scanner — Real Data

### 🟢 LOW PRIORITY

#### 13. Save AI Dev Notes to Requirement
#### 14. Phase 2 — Scheduled Production Deployment (deferred)
#### 15. VS Code Extension for Coding Assistant
#### 16. Cash Flow Intelligence (Phase 3)
#### 17. Month-End Close Assistant (Phase 2)
#### 18. Bundle cloudflared in installer zip (discussed, deferred)

---

## How Claude Should Work on This Project

1. **Get PAT from Rich** at start of session
2. **Sparse checkout** — never full clone. Use `--no-cone "app" "components" "lib" "scripts" "prisma"`
3. **Check imports** before every push
4. **Never import `@anthropic-ai/sdk`** — use provider-agnostic fetch pattern
5. **Never use `router.back()`** — always explicit `router.push()`
6. **Write Python fix scripts to `/tmp/fix_xxx.py`** — never heredocs in bash
7. **Targeted edits** — always verify target string is unique before replacing; view file immediately before editing
8. **Push:** `git push origin master:main`
9. **Vercel auto-deploys** in ~30–60s
10. **DB changes:** SQL in Vercel → Storage → Postgres → Query, then update prisma/schema.prisma
11. **Settings inputs:** always use refs + defaultValue — NEVER controlled inputs
12. **Update context files** at end of session
13. **BCAgent edits:** installer contains embedded BCAgent code — edit Install-BespoxAI.ps1 only; reinstall needed for permanent changes; Sync Config for config-only changes
14. **BATCH DEPLOY RULE:** Do NOT push changes without explicit confirmation from Rich
15. **DIAGNOSE BEFORE ARCHITECTING:** Always ask for logs/errors before proposing solutions
16. **DISCUSS SIGNIFICANT CHANGES** before implementing
17. **BUMP VERSION on every push** — `$AgentVersion`/`$Version` in PS1 + `AGENT_VERSION` in installer/route.ts

### BCAgent Troubleshooting
- **Large payload truncation:** Stream.Read() must loop — already fixed
- **Immediate JSON parse error:** Check for unescaped backslashes — already fixed
- **Deploy returns immediately:** Check BCAgent.log at `C:\BespoxAI\Agent\BCAgent.log`
- **NTLM 401 from BC:** BCAgent must run as BC user (not SYSTEM); UseDefaultCredentials=true
- **Tunnel not connecting:** check for old cloudflared installations (C:\cloudflared from v1)
- **No log entries after AI query:** check QueryLog __BAD_QUERY__ entries; check jsonMode on planner/router
- **NativeCommandError on cloudflared install:** set ErrorActionPreference=Continue around install call
- **Cloudflared registry key conflict:** remove HKLM:\SYSTEM\CurrentControlSet\Services\EventLog\Application\Cloudflared
- **Compile fails with multiple instances error:** check testNavServerInstance/testBcInstance and testNavManagementPort are set in agent config (Sync Config to push from DB)
- **Config not updating after settings save:** use Sync Config button — settings save to DB only, not live agent

### SWC/JSX Rules (critical)
- Use `cond ? <JSX/> : null` NOT `cond && <JSX/>` in large function returns
- No template literals `${vars}` in JSX — use string concatenation
- No template literals in `border: \`1px solid ${color}\`` style — use string concatenation
- Large components: extract sub-sections as separate named functions OUTSIDE main component
- `React.useState` fails in standalone functions — use destructured `useState`
- Never import `@anthropic-ai/sdk` — use provider-agnostic fetch pattern
