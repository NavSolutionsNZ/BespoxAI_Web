# BespoxAI Web Portal — Component Roadmap

**Last Updated:** May 23, 2026 (Session 3)

---

## Current State — What's Live

### ✅ Production & Working

**Infrastructure**
- [x] Next.js app deployed to Vercel (auto-deploy from GitHub main)
- [x] NextAuth authentication
- [x] BC connection health polling
- [x] Sidebar with collapsible toggle, dark mode
- [x] BCAgent v2.4 — transparent proxy + NAV C/AL export + deployment workflow
- [x] GitHub per-customer repos (`lib/github.ts`)

**AI System**
- [x] AI provider switchable via admin UI
- [x] All AI routes use DB-driven config (provider-agnostic fetch)
- [x] Per-tenant monthly token limits + usage tracking
- [x] Dev plan, Coding Assistant, Dev Assistant

**Phase 2 — Production Deployment**
- [x] Go-live doc generation + customer approval flow
- [x] BCAgent prod deploy
- [x] Full notification chain

**Customer Onboarding & Activation (NEW Session 3)**
- [x] Signup page: BC + NAV version dropdown with optgroups, updated tagline
- [x] Verify page: useEffect calls API on load (was stuck forever), branded header, notifyAdminsSignupVerified
- [x] Onboarding step 1: firstName, lastName, preferredName fields + persona
- [x] Onboarding step 4: full BC connection fields (instance, company, DB name, server, ports)
- [x] Onboarding step 5: "Open BC Installer →" CTA when wantsToConnect
- [x] Activation: user name set to null (not company name)
- [x] Admin signups: delete button, hides activated accounts, refresh fixed
- [x] Signup request deleted when user deleted

**Settings (NEW Session 3)**
- [x] All page backgrounds: white (`#ffffff`)
- [x] Settings deep-link: `?tab=installer` jumps to BC Installer tab
- [x] Your Profile card: firstName, lastName, preferredName (refs pattern)
- [x] Production Environment card: ProdEnvForm with refs (no re-render on typing)
- [x] Test Environment card: TestEnvForm with refs — simplified to same-server fields only (DB name, BC instance, BC company)
- [x] BC Installer links throughout settings are clickable (call setTab)
- [x] Browser autofill blocked on BC credential fields
- [x] Settings input reset bug FIXED: all inputs use refs + defaultValue

**BCAgent & Installer (NEW Session 3)**
- [x] Default port: 9099 everywhere (PS1, installer route, settings UI, admin UI, uninstaller)
- [x] Uninstall-BespoxAI.ps1: full cleanup script, handles HTTP.sys via netsh, never kills PID 4
- [x] Install-BespoxAI.ps1: fixed requirementId/timestamp undefined in export handler
- [x] Installer route: **auto-provisions Cloudflare tunnel on first download** — no separate admin step

**Tunnel Provisioning (NEW Session 3)**
- [x] First installer download creates Cloudflare tunnel, DNS CNAME, saves tunnelId to tenant
- [x] Subsequent downloads reuse existing tunnel
- [x] Admin provision route: agentPort default 9099
- [x] Admin installer modal: agentPort default 9099

**Login Page (NEW Session 3)**
- [x] White background, no grid/orb decorations
- [x] Tagline: "Business Central & Microsoft NAV Intelligence Portal"
- [x] Request access: top-right corner
- [x] Subtext updated to include NAV

**Dashboard (NEW Session 3)**
- [x] Unconnected users default to customisations tab
- [x] Not-connected banner: 3-step guide + clickable BC Installer link + Customisations link
- [x] Greeting: preferredName ?? firstName ?? name ?? email username

**User Profile (NEW Session 3)**
- [x] User model: firstName, lastName, preferredName fields (SQL: ALTER TABLE added)
- [x] /api/settings/profile GET/PATCH
- [x] Greeting uses preferredName ?? firstName
- [x] Admin users + settings users DELETE: also removes SignupRequest

**Navigation & Back Button**
- [x] All back buttons use explicit router.push() — no router.back() anywhere
- [x] Admin URL sync for requirements
- [x] Settings ?tab= deep-link

---

## Work Backlog (Prioritized)

### 🔴 HIGH PRIORITY

#### 1. BCAgent End-to-End Testing
**Status:** In progress — testing as new customer (Session 3)
**Next step:** Download installer for new test tenant, run on customer server, verify full flow:
- fetch C/AL → knowledge base → write → deploy test → UAT → go-live doc → prod deploy

### 🟡 MEDIUM PRIORITY

#### 2. Separate Test Server Support
**Status:** Schema/routing done. TestEnvForm simplified to same-server only.
**Scope when needed:** Second BCAgent installer for separate test server, separate server config UI

#### 3. Customer Requirement View — UAT Rejection History
**Est. effort:** 1–2 hours

#### 4. Onboarding — Enforce name entry
**Status:** Name fields added but not required. Consider validation.

#### 5. Dynamic Web Service Creation (CFO Assistant)
**Est. effort:** 6–8 hours

#### 6. Health Scanner — Real Data
**Est. effort:** 8–12 hours

### 🟢 LOW PRIORITY

#### 7. Mobile Responsiveness (Dashboard)
#### 8. Save AI Dev Notes to Requirement
#### 9. Phase 2 — Scheduled Production Deployment (deferred)
#### 10. VS Code Extension for Coding Assistant
#### 11. Cash Flow Intelligence (Phase 3)
#### 12. Month-End Close Assistant (Phase 2)

---

## How Claude Should Work on This Project

1. **Get PAT from Rich** at start of session
2. **Sparse checkout** — never full clone
3. **Check imports** before every push
4. **Never import `@anthropic-ai/sdk`** — use provider-agnostic fetch pattern
5. **Never use `router.back()`** — always explicit `router.push()`
6. **Write Python fix scripts to `/tmp/fix_xxx.py`** — never heredocs
7. **Targeted edits** — always verify target string is unique before replacing
8. **New files outside sparse area:** `git add --sparse <file>` then normal commit
9. **Push:** `git push origin master:main`
10. **Vercel auto-deploys** in ~30–60s
11. **DB changes:** SQL in Vercel → Storage → Postgres → Query, then update `prisma/schema.prisma`
12. **Settings inputs:** always use refs + defaultValue — NEVER controlled inputs (value/onChange)
13. **Update context files** at end of session

### SWC/JSX Rules (critical)
- Use `cond ? <JSX/> : null` NOT `cond && <JSX/>` in large function returns
- No template literals with `${vars}` in JSX — use string concatenation
- Large components: extract sub-sections as separate named functions OUTSIDE main component
- `React.useState` fails in standalone functions — use destructured `useState`
- Never import `@anthropic-ai/sdk` — use provider-agnostic fetch pattern
