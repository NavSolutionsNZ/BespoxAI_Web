# BespoxAI Web Portal — Component Roadmap

**Last Updated:** May 23, 2026 (Session 4)

---

## Current State — What's Live

### ✅ Production & Working

**Infrastructure**
- [x] Next.js app deployed to Vercel (auto-deploy from GitHub main)
- [x] NextAuth authentication
- [x] BC connection health polling
- [x] Sidebar with collapsible toggle, dark mode
- [x] BCAgent v2.4 — fully tested end-to-end, live data flowing
- [x] GitHub per-customer repos (`lib/github.ts`)

**AI System**
- [x] AI provider switchable via admin UI (OpenAI or Anthropic)
- [x] All AI routes use DB-driven config (provider-agnostic fetch)
- [x] Per-tenant monthly token limits + usage tracking
- [x] Dev plan, Coding Assistant, Dev Assistant
- [x] CFO Assistant — router + planner jsonMode:true (gpt-4o JSON fix)

**Phase 2 — Production Deployment**
- [x] Go-live doc generation + customer approval flow
- [x] BCAgent prod deploy
- [x] Full notification chain

**Customer Onboarding & Activation (Session 3)**
- [x] Signup page: BC + NAV version dropdown with optgroups, updated tagline
- [x] Verify page: useEffect calls API on load, branded header, notifyAdminsSignupVerified
- [x] Onboarding step 1: firstName, lastName, preferredName fields + persona
- [x] Onboarding step 4: full BC connection fields (instance, company, DB name, server, ports)
- [x] Onboarding step 5: "Open BC Installer →" CTA when wantsToConnect
- [x] Activation: user name set to null (not company name)
- [x] Admin signups: delete button, hides activated accounts, refresh fixed
- [x] Signup request deleted when user deleted

**Settings (Session 3)**
- [x] All page backgrounds: white (`#ffffff`)
- [x] Settings deep-link: `?tab=installer` jumps to BC Installer tab
- [x] Your Profile card: firstName, lastName, preferredName (refs pattern)
- [x] Production Environment card: ProdEnvForm with refs (no re-render on typing)
- [x] Test Environment card: TestEnvForm with refs — simplified to same-server fields only
- [x] BC Installer links throughout settings are clickable (call setTab)
- [x] Browser autofill blocked on BC credential fields
- [x] Settings input reset bug FIXED: all inputs use refs + defaultValue

**BCAgent & Installer (Session 4 — fully tested)**
- [x] Default port: 9099 everywhere
- [x] HttpWebRequest (not HttpClient) — reliable NTLM on Windows Server
- [x] Scheduled task runs as BC user (not SYSTEM) — NTLM/Kerberos via Windows token
- [x] UseDefaultCredentials=true — same auth mechanism as browser SSO
- [x] cloudflared --protocol http2 — avoids QUIC/UDP block on SYSTEM account
- [x] cloudflared service auto-restart on failure (5s/10s/30s)
- [x] Stale Cloudflared event log registry key cleaned on install + uninstall
- [x] Uninstall-BespoxAI.bat — right-click Run as Administrator shim
- [x] Installer route: auto-provisions Cloudflare tunnel on first download

**Login Page (Session 3)**
- [x] White background, no grid/orb decorations
- [x] Tagline: "Business Central & Microsoft NAV Intelligence Portal"
- [x] Request access: top-right corner

**Dashboard (Session 3)**
- [x] Unconnected users default to customisations tab
- [x] Not-connected banner: 3-step guide + clickable BC Installer link
- [x] Greeting: preferredName ?? firstName ?? name ?? email username

**User Profile (Session 3)**
- [x] User model: firstName, lastName, preferredName fields
- [x] /api/settings/profile GET/PATCH
- [x] Admin users + settings users DELETE: also removes SignupRequest

**Navigation & Back Button**
- [x] All back buttons use explicit router.push() — no router.back() anywhere
- [x] Admin URL sync for requirements
- [x] Settings ?tab= deep-link

---

## Work Backlog (Prioritized)

### 🔴 HIGH PRIORITY

#### 1. CFO Assistant — NAV v14 OData Planner Tuning
**Status:** BCAgent working, live data flowing. Planner generates unsupported queries on some entities.
**Known issues:**
- `$orderby=Posting_Date desc` returns 400 on GeneralLedgerEntry, SalesInvoice in NAV v14
- `$filter` on Posting_Date not supported on posted documents
- Tiles show `,` for Overdue Debtors, Cash & Bank, Outstanding Payables (Month Revenue working)
**Fix:** Update planner system prompt in `app/api/query/route.ts` to exclude these patterns for BC v14

#### 2. Preferred Name — Site-wide + AI Interactions
**Status:** Dashboard greeting done. Remaining:
- Email notifications (`lib/notifications.ts`) — use preferredName ?? firstName
- AI system prompts / tenant context (`lib/tenant-context.ts`) — address user by preferredName
- CFO assistant greeting uses "Brian" instead of correct name

### 🟡 MEDIUM PRIORITY

#### 3. Installer — Directory creation message
Change "Directories created under C:\BespoxAI" → "Directories verified/created under C:\BespoxAI"
(directories may already exist on reinstall)

#### 4. Settings — Test Environment placeholder text
Remove default placeholder "Leave blank to use production company" from Test BC Company field

#### 5. Separate Test Server Support
**Status:** Schema/routing done. TestEnvForm simplified to same-server only.
**Scope when needed:** Second BCAgent installer for separate test server

#### 6. Customer Requirement View — UAT Rejection History
**Est. effort:** 1–2 hours

#### 7. Onboarding — Enforce name entry
**Status:** Name fields added but not required. Consider validation.

#### 8. Dynamic Web Service Creation (CFO Assistant)
**Est. effort:** 6–8 hours

#### 9. Health Scanner — Real Data
**Est. effort:** 8–12 hours

### 🟢 LOW PRIORITY

#### 10. Mobile Responsiveness (Dashboard)
#### 11. Save AI Dev Notes to Requirement
#### 12. Phase 2 — Scheduled Production Deployment (deferred)
#### 13. VS Code Extension for Coding Assistant
#### 14. Cash Flow Intelligence (Phase 3)
#### 15. Month-End Close Assistant (Phase 2)

---

## How Claude Should Work on This Project

1. **Get PAT from Rich** at start of session
2. **Sparse checkout** — never full clone
3. **Check imports** before every push
4. **Never import `@anthropic-ai/sdk`** — use provider-agnostic fetch pattern
5. **Never use `router.back()`** — always explicit `router.push()`
6. **Write Python fix scripts to `/tmp/fix_xxx.py`** — never heredocs
7. **Targeted edits** — always verify target string is unique before replacing
8. **New files outside sparse area:** `git sparse-checkout add <file>` then normal commit
9. **Push:** `git push origin master:main`
10. **Vercel auto-deploys** in ~30–60s
11. **DB changes:** SQL in Vercel → Storage → Postgres → Query, then update `prisma/schema.prisma`
12. **Settings inputs:** always use refs + defaultValue — NEVER controlled inputs (value/onChange)
13. **Update context files** at end of session
14. **BCAgent edits:** can patch running BCAgent.ps1 via PowerShell on server for quick fixes; full reinstall for permanent changes
15. **Bad query cache:** if CFO assistant routes as generic, check/clear __BAD_QUERY__ entries in QueryLog for correct tenantId

### BCAgent Troubleshooting (learned Session 4)
- **NativeCommandError on cloudflared install:** set ErrorActionPreference=Continue around the install call
- **Cloudflared registry key conflict:** remove HKLM:\SYSTEM\CurrentControlSet\Services\EventLog\Application\Cloudflared before reinstall
- **QUIC/UDP blocked:** use --protocol http2 on cloudflared service
- **NTLM 401 from BC:** BCAgent must run as BC user (not SYSTEM); UseDefaultCredentials=true
- **Tunnel not connecting:** check for old cloudflared installations (C:\cloudflared from v1) — kill and remove
- **No log entries after AI query:** check QueryLog for __BAD_QUERY__ entries; check jsonMode on planner/router callAI
- **Tunnel DNS failure:** internal DNS may not resolve *.argotunnel.com SRV records when running as SYSTEM

### SWC/JSX Rules (critical)
- Use `cond ? <JSX/> : null` NOT `cond && <JSX/>` in large function returns
- No template literals with `${vars}` in JSX — use string concatenation
- Large components: extract sub-sections as separate named functions OUTSIDE main component
- `React.useState` fails in standalone functions — use destructured `useState`
- Never import `@anthropic-ai/sdk` — use provider-agnostic fetch pattern
