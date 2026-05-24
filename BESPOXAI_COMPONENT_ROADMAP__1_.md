# BespoxAI Web Portal — Component Roadmap

**Last Updated:** May 25, 2026 (Session 5)

---

## Current State — What's Live

### ✅ Production & Working

**Session 5 — Deploy Pipeline**
- [x] Sync from GitHub → DB button in admin deploy panel
- [x] Write files to server (BCAgent deployment folder) — Stream.Read() loop fix, JSON path escaping
- [x] writeSnapshotId persisted to DB after write — Step 2 available across sessions
- [x] Deploy-test + deploy-prod routes hardened (try-catch, text-first JSON parse)
- [x] Deploy error messages now show real errors in UI

**Session 5 — Security & Onboarding**
- [x] mustChangePassword column on User (SQL applied, schema.prisma needs update on PC)
- [x] Onboarding Step 0: force password change on first login
- [x] change-password API route (with/without current password requirement)
- [x] Settings → Profile: ChangePasswordCard for existing users
- [x] notifyUserWelcome: auto-sent on provision + invite with temp password + warning
- [x] mustChangePassword=true set on all new user creation paths

**Session 5 — Mobile Responsiveness (ALL user types)**
- [x] Dashboard: slide-over sidebar, auto-close on nav, compact header/badge
- [x] Settings: sticky top nav, horizontal tabs, fluid grids, scroll-to-top
- [x] Admin: slide-over sidebar, ☰ hamburger, auto-close on tab select
- [x] Onboarding: sidebar hidden on mobile, reduced padding
- [x] Billing: responsive header, wrapping plan cards
- [x] Login: tightened corner links
- [x] Signup: clamp() card padding

**Session 5 — Admin**
- [x] Tenant STATUS shows Connected/Not Connected (based on tunnelId, not active flag)
- [x] ConnectedPill component (separate from StatusPill)

**C/AL Export Pipeline (Session 4)**
- [x] finsql.exe direct export (BC14 compatible), grouped by type, ANSI fix, ZUP isolation
- [x] End-to-end: fetch → parse → GitHub → push

**BCAgent v2.4 (Sessions 4–5)**
- [x] HttpWebRequest (not HttpClient) — reliable NTLM on Windows Server
- [x] Scheduled task runs as BC user — NTLM/Kerberos via Windows token
- [x] UseDefaultCredentials=true — browser SSO equivalent
- [x] cloudflared --protocol http2, service auto-restart
- [x] Stream.Read() loop — fixes large payload truncation
- [x] JSON path escaping — fixes immediate parse errors

**AI System**
- [x] AI provider switchable (OpenAI or Anthropic)
- [x] Per-tenant token limits + usage tracking
- [x] CFO Assistant — router + planner jsonMode:true
- [x] Dev plan, Coding Assistant, Dev Assistant

**Phase 2 — Production Deployment**
- [x] Go-live doc generation + customer approval flow
- [x] BCAgent prod deploy route (hardened Session 5)
- [x] Full notification chain

**Customer Onboarding (Sessions 3–5)**
- [x] Full onboarding flow (steps 0–5)
- [x] BC + NAV version selection
- [x] firstName/lastName/preferredName
- [x] BC connection fields
- [x] Welcome email with temp credentials

**Settings (Sessions 3–5)**
- [x] Mobile responsive sticky nav
- [x] All inputs: refs + defaultValue pattern
- [x] ChangePasswordCard (collapsible)
- [x] Profile, BC Connection, Test Environment, Installer tabs

**Navigation**
- [x] No router.back() anywhere
- [x] Settings/Dashboard deep-links

---

## Work Backlog (Prioritized)

### 🔴 HIGH PRIORITY

#### 1. Deploy + Compile to Test — Diagnose Failure
**Status:** Failing immediately (not timeout). Error returned before 60s limit.
**Next step:** Check `C:\BespoxAI\Agent\BCAgent.log` on GWM server when error occurs.
**Do NOT implement async deploy without first understanding the actual error.**
**Possible causes:** testNavDatabaseName not set in agent.config.json, NavModelTools.ps1 not loading, compile error on specific object.

#### 2. CFO Assistant — NAV v14 OData Planner Tuning
**Status:** BCAgent working, live data flowing. Planner generates unsupported queries on some entities.
**Known issues:**
- `$orderby=Posting_Date desc` returns 400 on GeneralLedgerEntry, SalesInvoice in NAV v14
- `$filter` on Posting_Date not supported on posted documents
- Tiles show `,` for Overdue Debtors, Cash & Bank, Outstanding Payables (Month Revenue working)
**Fix:** Update planner system prompt in `app/api/query/route.ts`

#### 3. Preferred Name — Site-wide + AI Interactions
**Status:** Dashboard greeting done.
- Email notifications (`lib/notifications.ts`) — use preferredName ?? firstName
- AI system prompts (`lib/tenant-context.ts`) — address user by preferredName
- CFO assistant greeting uses "Brian" instead of correct name

### 🟡 MEDIUM PRIORITY

#### 4. schema.prisma Update (PC task)
Add `mustChangePassword Boolean @default(false)` to User model in `prisma/schema.prisma`

#### 5. Collapsible Sections in Admin Requirements View
All panels (AI spec, feasibility, dev plan, coding assistant, deploy panel etc.) should be independently collapsible.

#### 6. Human-Readable Deployment Folder Names
Currently: `C:\BespoxAI\Deployments\cmpi4tisk00011422fazu1pxx\20260523_163211_deploy\`
Should be: `C:\BespoxAI\Deployments\add-release-date_cmpi4t\20260523_1632_deploy\`
Requires passing requirement title slug to BCAgent.

#### 7. Installer — Directory creation message
Change "Directories created under C:\BespoxAI" → "Directories verified/created under C:\BespoxAI"

#### 8. Settings — Test Environment placeholder text
Remove "Leave blank to use production company" placeholder from Test BC Company field.

#### 9. Separate Test Server Support
Schema/routing done. TestEnvForm simplified to same-server only. Second BCAgent installer when needed.

#### 10. Customer Requirement View — UAT Rejection History

#### 11. Onboarding — Enforce name entry

#### 12. Dynamic Web Service Creation (CFO Assistant)

#### 13. Health Scanner — Real Data

### 🟢 LOW PRIORITY

#### 14. Save AI Dev Notes to Requirement
#### 15. Phase 2 — Scheduled Production Deployment (deferred)
#### 16. VS Code Extension for Coding Assistant
#### 17. Cash Flow Intelligence (Phase 3)
#### 18. Month-End Close Assistant (Phase 2)

---

## How Claude Should Work on This Project

1. **Get PAT from Rich** at start of session
2. **Sparse checkout** — never full clone. Use `--no-cone "app" "components" "lib" "scripts"` for broad access
3. **Check imports** before every push
4. **Never import `@anthropic-ai/sdk`** — use provider-agnostic fetch pattern
5. **Never use `router.back()`** — always explicit `router.push()`
6. **Write Python fix scripts to `/tmp/fix_xxx.py`** — never heredocs in bash
7. **Targeted edits** — always verify target string is unique before replacing; view file immediately before editing
8. **Push:** `git push origin master:main`
9. **Vercel auto-deploys** in ~30–60s
10. **DB changes:** SQL in Vercel → Storage → Postgres → Query, then note schema.prisma needs update
11. **Settings inputs:** always use refs + defaultValue — NEVER controlled inputs
12. **Update context files** at end of session
13. **BCAgent edits:** can patch running BCAgent.ps1 via PowerShell for quick fixes; full reinstall for permanent
14. **BATCH DEPLOY RULE:** Do NOT push changes without explicit confirmation from Rich
15. **DIAGNOSE BEFORE ARCHITECTING:** Always ask for logs/errors before proposing solutions
16. **DISCUSS SIGNIFICANT CHANGES** before implementing (e.g. async patterns, schema changes, new endpoints)

### BCAgent Troubleshooting
- **Large payload truncation:** Stream.Read() must loop — already fixed in installer
- **Immediate JSON parse error:** Check for unescaped backslashes in response — already fixed
- **Deploy returns immediately with error:** Check BCAgent.log at `C:\BespoxAI\Agent\BCAgent.log`
- **NTLM 401 from BC:** BCAgent must run as BC user (not SYSTEM); UseDefaultCredentials=true
- **Tunnel not connecting:** check for old cloudflared installations (C:\cloudflared from v1)
- **No log entries after AI query:** check QueryLog __BAD_QUERY__ entries; check jsonMode on planner/router
- **NativeCommandError on cloudflared install:** set ErrorActionPreference=Continue around install call
- **Cloudflared registry key conflict:** remove HKLM:\SYSTEM\CurrentControlSet\Services\EventLog\Application\Cloudflared

### SWC/JSX Rules (critical)
- Use `cond ? <JSX/> : null` NOT `cond && <JSX/>` in large function returns
- No template literals `${vars}` in JSX — use string concatenation
- No template literals in `border: \`1px solid ${color}\`` style — use string concatenation
- Large components: extract sub-sections as separate named functions OUTSIDE main component
- `React.useState` fails in standalone functions — use destructured `useState`
- Never import `@anthropic-ai/sdk` — use provider-agnostic fetch pattern
