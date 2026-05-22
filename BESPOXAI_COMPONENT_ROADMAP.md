# BespoxAI Web Portal — Component Roadmap

**Last Updated:** May 22, 2026 (Session 2)

---

## Current State — What's Live

### ✅ Production & Working

**Infrastructure**
- [x] Next.js app deployed to Vercel (auto-deploy from GitHub main)
- [x] NextAuth authentication
- [x] BC connection health polling
- [x] Sidebar with collapsible toggle, dark mode
- [x] BCAgent v2.4 — transparent proxy + NAV C/AL export + deployment workflow
- [x] GitHub per-customer repos (`lib/github.ts`) — objects pushed to branch on KB save

**AI System**
- [x] AI provider switchable via admin UI (Anthropic default)
- [x] All AI routes use DB-driven config (provider-agnostic fetch — no SDK imports)
- [x] Per-tenant monthly token limits
- [x] Token usage tracked per tenant per feature
- [x] Token meter in customer dashboard sidebar
- [x] `buildTenantContext()` — BC env + entity config + customisation history
- [x] Dev plan: `sanitizeDevPlanJSON`, `buildTenantContext`, max_tokens 4000+
- [x] **Coding Assistant** — loads C/AL from GitHub branch, streams AI, commit back to branch
- [x] **Dev Assistant** — ghostwriter framing, customer-facing language, markdown rendering

**Phase 2 — Production Deployment (NEW Session 2)**
- [x] `api/requirements/[id]/prod-approval` — AI generates go-live doc, emails customer
- [x] `api/requirements/[id]/prod-approve` — customer approves, notifies admins
- [x] `api/requirements/[id]/objects/deploy-prod` — BCAgent prod deploy (`environment: "production"`)
- [x] `DeployToProductionPanel` in admin — Step 1 (send doc) + Step 2 (deploy with confirm gate)
- [x] Customer portal — go-live doc display, Approve Go-Live button, deployed confirmation
- [x] `notifyCustomerProdApproval`, `notifyAdminsProdApproved`, `notifyCustomerProdDeployed`
- [x] Schema: `prodApprovalSentAt`, `prodGoLiveDoc`, `prodApprovedAt`, `prodApprovedById`, `prodDeployedAt`, `prodDeploySnapshotId`
- [x] Go-live document downloadable from customer Documents section

**Navigation & Back Button (NEW Session 2)**
- [x] Admin requirement URL sync — `?tab=requirements&req={id}` on select, back button returns to list
- [x] Admin sidebar "← CFO Assistant" → `router.push('/dashboard')`
- [x] Settings back button → `router.push('/dashboard')`
- [x] Billing back button → `router.push('/dashboard')`
- [x] RequirementsBuilder URL sync — `selectReq()` pushes `?req={id}`, `clearReq()` removes it
- [x] Back/forward navigation + deep linking works across all pages

**Customer UX Improvements (NEW Session 2)**
- [x] Quote amount hidden from customer list (superadmin still sees it)
- [x] Internal badges hidden from customers: `✦ spec`, `? Nq` question count
- [x] Review paid/included/waived badges hidden once past deposit stage
- [x] Documents section in requirement detail: Deposit Invoice, Review Invoice, Balance Invoice, Go-Live Document
- [x] Loading state while fetching ("Loading customisations…"), proper empty state after load
- [x] Consultant note markdown renders correctly on light backgrounds (`renderMdLight`)
- [x] Numbered list alignment fixed: `textAlign: right` on numbers, `alignItems: baseline`
- [x] Dash sub-items indent `paddingLeft: 20` to align under heading text

**Addendum Flow**
- [x] All previously completed — see Session 1 notes

**Email Notifications**
- [x] All lifecycle emails — see Session 1 notes
- [x] Prod deployment emails — see Phase 2 above

**Overview Dashboard**
- [x] All previously completed — see Session 1 notes

**NAV C/AL Object Fetch & Knowledge Base** — all previously completed
**BCAgent v2.4** — all previously completed
**Test Deployment Workflow** — all previously completed
**UAT Workflow** — all previously completed
**Developer Role** — all previously completed
**Settings / BC Installer** — all previously completed

---

## Known UI Issues (Backlog)

| Issue | Priority |
|-------|----------|
| No UAT rejection history shown in customer view | Medium |

*(Admin URL/back button issue — FIXED Session 2)*

---

## Work Backlog (Prioritized)

### 🔴 HIGH PRIORITY

#### 1. BCAgent End-to-End Testing
**Status:** In progress — Rich testing after Session 2
**Scope:** Full flow: fetch C/AL → knowledge base → write → deploy test → UAT → send go-live doc → customer approve → deploy prod

#### 2. Phase 2 — Scheduled Production Deployment (deferred)
**Status:** Immediate deployment works (Session 2). Scheduling deferred — add when customer needs it.
**Scope when needed:**
- BCAgent `BespoxAI-DeployJob.ps1` — standalone script for Task Scheduler
- BCAgent `/bespoxai/objects/schedule` endpoint
- Portal datetime picker before deploy button
- Schema: `prodScheduledFor`
- Both immediate and scheduled paths must coexist

### 🟡 MEDIUM PRIORITY

#### 3. Separate Test Server Installer
**Status:** Schema + routing done; installer generation is manual
**Scope:** Generate second BCAgent installer for separate test server

#### 4. Customer Requirement View — UAT Rejection History
**Scope:** Show rejection reason/analysis in customer view after UAT reject

#### 5. Onboarding — NAV DB + Test Env Fields
**Status:** Backend done, onboarding UI not updated

#### 6. Dynamic Web Service Creation (CFO Assistant)
**Status:** Architecture confirmed, BCAgent v2.4 ready
**Est. effort:** 6–8 hours

#### 7. Health Scanner — Real Data
**Est. effort:** 8–12 hours

### 🟢 LOW PRIORITY

#### 8. Mobile Responsiveness (Dashboard)
**Est. effort:** 3–5 hours

#### 9. Save AI Dev Notes to Requirement
**Est. effort:** 2–3 hours

#### 10. VS Code Extension for Coding Assistant (Phase 2)
#### 11. Cash Flow Intelligence (Phase 3 placeholder)
#### 12. Month-End Close Assistant (Phase 2 placeholder)
#### 13. Blog / Case Studies

---

## Decision Matrix

| Component | Effort | ROI | Recommend |
|-----------|--------|-----|-----------|
| BCAgent E2E testing | — | Very High | Now |
| Scheduled prod deploy | 4–6h | Low until needed | On demand |
| Admin nav / URL fix | Done ✓ | — | — |
| Customer view improvements | Done ✓ | — | — |
| Separate test server installer | 4–6h | Low (when customer needs it) | On demand |
| Dynamic web service creation | 6–8h | Very High | After testing |
| Health Scanner real data | 8–12h | High | Plan carefully |
| Mobile responsiveness | 3–5h | High | Soon |
| UAT rejection history | 1–2h | Medium | Soon |

---

## How Claude Should Work on This Project

1. **Get PAT from Rich** at start of session
2. **Sparse checkout** — never full clone
3. **Check imports** before every push — TypeScript errors from missing imports waste deploy cycles
4. **Never import `@anthropic-ai/sdk`** — use provider-agnostic fetch pattern
5. **Never use `router.back()`** — always explicit `router.push()`
6. **Write Python fix scripts to `/tmp/fix_xxx.py`** — never use heredocs
7. **Targeted edits** — always verify target string is unique before replacing
8. **New files outside sparse area:** `git add --sparse <file>` then normal commit
9. **Push:** `git push origin master:main`
10. **Vercel auto-deploys** in ~30–60s
11. **DB changes:** SQL in Vercel → Storage → Postgres → Query, then update `prisma/schema.prisma`
12. **Update context files** at end of session

### SWC/JSX Rules (critical — strictly enforced)
- Use `cond ? <JSX/> : null` NOT `cond && <JSX/>` in large function returns
- No template literals with `${vars}` in JSX — use string concatenation throughout
- No template literals in JSX text nodes between tags
- Variables defined inside a child component are NOT in scope in parent JSX
- After any insertion: check for duplicated blocks
- **Large components hitting SWC limits:** extract sub-sections as separate named functions OUTSIDE the main component
- `React.useState` fails in standalone functions — use destructured `useState`
