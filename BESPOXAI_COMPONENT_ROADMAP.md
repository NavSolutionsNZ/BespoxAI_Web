# BespoxAI Web Portal — Component Roadmap

**Last Updated:** June 15, 2026 (Session 22)

---

## Current State — What's Live

### ✅ Production & Working

**Session 21 — Partner Fixes, White-Label, User Labelling, Health**
- [x] White-label persistence fixed — stripe webhook used findUnique on non-unique stripeCustomerId; switched to findFirst + added @unique (SQL index applied). Branded plan now persists tier='branded'+isWhiteLabel=true
- [x] White-label logo render fixed — BrandingProvider client fetch cache:'no-store' + /api/branding server cache tagged ['branding'] + revalidateTag('branding') on partner save and webhook flip
- [x] Partner post-payment redirect → /partner/settings (was landing in customer CFO area)
- [x] Partner activation cache-bust (revalidateTag('admin-partners')) — partner appears immediately
- [x] Resend partner welcome email — new superadmin route + per-row button (fresh temp password)
- [x] sendEmail logs accepted/rejected/response, re-throws on hard fail (return type kept Promise<void>)
- [x] Admin Users tab: Type column (Partner/Partner Customer/Direct/Internal badges) + partner name + managed-tenants pills for partners + "Filter by type" dropdown
- [x] Customers (Direct + Partner Customer) blocked from developer role — UI skips Dev in cycle + API 403 on tenant-tied users. Partner staff still eligible. Partner portal needs no fix (roles read-only there)
- [x] /api/health 500-every-minute fixed — null tenantId guard + getTenantById null-safe (findFirst). Verified clean in runtime logs
- [x] (Infra, Rich) DKIM + DMARC published in Cloudflare DNS — fixes silent partner email drops
- [x] Tested & confirmed live

**Session 19 — Spec Lock After Customer Acceptance**
- [x] Customer portal (RequirementsBuilder): Regen button ONLY shown in draft status
- [x] Admin portal (AdminRequirementsTab): Regen button hidden once spec is accepted (quoted status)
- [x] Partner admin portal (RequirementDetail): Regen button added with same pre-quote restriction
- [x] New partner route: POST /api/partner/tenants/[id]/requirements/[reqId]/ai-spec
- [x] Spec remains read-only for all users in all portals (already was read-only text)
- [x] Developers (admin & partner) can regenerate spec up until customer acceptance (quoted status)
- [x] Once quoted, spec is locked for everyone (no regen, only view)
- [x] TypeScript compilation verified, no errors
- [x] Tested & confirmed live

**Session 18 — AI-Generated Functional Spec Collapsible + Admin Portal Cleanup + Partner Email Flow**
- [x] Spec panel in RequirementsBuilder now independently collapsible
- [x] Status-dependent default: open when draft/submitted/needs_clarification/in_review/quote_rejected; closed otherwise
- [x] Toggle button styled like AdminCardToggleBtn (▴/▾ arrow)
- [x] Complexity/days/regenerations badges only shown when panel open
- [x] Refine button only shown when panel open
- [x] Removed "← CFO Assistant" link from admin sidebar — superadmins don't need direct access
- [x] Fixed null reference error in Users table — added null check for `u.tenant?.name || '—'`
- [x] Diagnosed & fixed data integrity: Pat Partner (partner@testpartner.com) missing tenantId
- [x] Assigned Pat Partner to TestCo1 tenant via SQL
- [x] **Removed redundant partner agreement email** — no longer sent during email verification
- [x] **Partner activation flow now cleaner:** Email verification → superadmin notified only → activation → partner receives credentials email only
- [x] BCAgent bumped to v3.3 (all three version fields)
- [x] Tested & confirmed live

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

## 🐛 Partner-Portal Bugs — ✅ ALL RESOLVED (Session 22)

Logged Session 22 (partner-portal walkthrough, white-label "Endeavour" test account). All five fixed and deployed green in Session 22. Commits: 1=`60d376a`, 4=`745154e`, 2=`54de318`/`4fafba9`/`17e0f0d`, notifications=`7900605`, 5=`5d684bb`.

#### BUG 1 — Partner cannot create a requirement (500) ✅ FIXED (`60d376a`)
- **Real root cause (the Session-22 theory below was WRONG):** `Requirement.assignedDeveloperId` is a required, non-nullable FK with **no DB default** (added by the Session 17 assignment system; the default-to-creating-user logic lives in app code). The partner create route never set it → Prisma rejected `create` → empty-body 500.
- **The 500 was NOT GitHub provisioning or AI spec** — neither runs in that route. And it failed on **any** partner-route create, not just fresh tenants (Acme's reqs came in via the direct `/api/requirements` route, which does set `assignedDeveloperId: user.id`).
- **Fix:** partner create route now sets `assignedDeveloperId: session.userId` (auto-assigns the partner user as deliverer), mirroring the direct route.
- **Standing-rule reinforcement:** when mirroring a create across pipelines, check for required FKs with no DB default.

#### BUG 2 (+ BUG 3) — Partner deliverer action set ✅ FIXED (3 commits)
- **Confirmed model:** partner = deliverer for their own tenants (takes BespoxAI's role); client-tenant user = customer. Partner detail is **BOTH** (partner can act as customer too, on behalf of the tenant). No BespoxAI in the partner loop.
- **(1/3) API `54de318`:** partner PATCH gained the deliverer half — in_review, needs_clarification (+QALog round), quoted (+quotedAt), deposit_paid, in_development, complete_pending_payment, fully_paid, plus quote/consultantNote/bcObjects. Payments are **manual marks** (no Stripe in partner pipeline).
- **(2/3) API `4fafba9`:** new partner `uat-approve` + `uat-reject` routes; reject mirrors the direct route's **AI scope-creep analysis** verbatim. Gated via `requirePartnerSession` + `assertTenantBelongsToPartner`, scoped to `tenantId`, `*ById` = `session.userId`.
- **(3/3) UI `17e0f0d`:** status-gated **Delivery Actions** card in partner `RequirementDetail`, layered on the existing customer panels.
- **Bug 3** (sparse read-only stages) was the same defect — resolved together.

#### BUG 4 — Edit requirement before submit/resubmit ✅ FIXED (`745154e`)
- The partner PATCH route already accepted title/description/bcArea/priority in draft/needs_clarification/quote_rejected — it was a **UI-only gap**. The partner draft/quote_rejected panel now shows a seeded, field-editable form, mirroring the BespoxAI customer resubmit flow. (`needs_clarification` keeps its dedicated answer panel.)

#### BUG 5 — Connection indicator separate from account-active ✅ FIXED (`5d684bb`)
- Connection = `!!tenant.tunnelId`, labelled **Connected / Not Connected** (matches Overview wording). Partner tenants API now selects `tunnelId`; partner dashboard renders a connection pill beside Active; admin list adds an account `StatusPill` beside the existing `ConnectedPill` so both lists show account + connection state.
- **Deferred:** `!!tunnelId` = "provisioned", not live reachability. A true "agent reachable now" indicator (via `/api/health` ping or an `agentLastSeen` timestamp) is a future task.

#### Partner pipeline notifications — ✅ FIXED (`7900605` + wired through Bug 2)
- Partner-tenant events were emailing **BespoxAI superadmins** (`notifyAdmins*`, `/admin` CTAs) — wrong audience. Now:
  - **Partner (deliverer)** — `partner_admin` + `partner_developer`, `/partner` CTAs: new req, answered, quote-rejected, UAT approved/rejected.
  - **Client-tenant customer** (white-label from-address): needs_clarif, quoted, in_development, balance-due.
  - **BespoxAI superadmins** (billing visibility): deposit_paid. *(quoted/accepted/completed BespoxAI copies not yet added — extend if fuller visibility wanted.)*
- New helpers: `getPartnerRecipients()`, `notifyPartner{NewRequirement,Answered,QuoteRejected,UatApproved,UatRejected}`. Direct pipeline untouched.

#### Still open / deferred from this work
- **Partner Stripe payments:** `paymentMode` (partner_collected vs bespoxai_collected) is stored + surfaced in UI but **drives no payment logic**. Partner deposit/balance are manual marks. A real `paymentMode`-driven Stripe path is a separate task.
- **BespoxAI billing-visibility copies** beyond deposit_paid (quoted, accepted, completed).
- **Live agent health** indicator (see Bug 5 deferred).

#### Other walkthrough notes (not bugs)
- **Client-tenant Users tab is read-only** (no invite button) — by design; client users come via client onboarding/provisioning, not the partner portal. Documented in the manual.
- **Partner Billing page is "Under Construction"** placeholder.
- **Test data created on PRODUCTION during walkthrough — needs cleanup:** tenant **Demo Wholesale Ltd** (`cmqd4nvlm0001l9mcrs7by193`) and partner team member **Jordan Lee** (`jordan.lee@example-demo.test`). Also `partner@testpartner.com` password was set to `password` for the session (Rich to reset).
- **"Last sign-in" column** (built Session 22) confirmed live and working on the partner Team page (showed "Never" for the newly-invited Jordan Lee, relative time for Deano).

---

## Work Backlog (Prioritized)

### 🔴 HIGH PRIORITY

#### 1. ~~AI-Generated Functional Spec — Make Collapsible~~ ✅ DONE (Session 18)
**Status:** Complete. Spec panel is independently collapsible. 

**Session 19 addition:** Spec regeneration now locked after customer acceptance
- Customer can only regenerate in draft status
- Developers (admin & partner) can regenerate until spec is quoted (customer accepted)
- Once quoted, spec becomes read-only for all users

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

### 🧹 CODE HYGIENE (incremental — do opportunistically, NOT a standalone push)

#### H1. Centralize API auth guards
**Status:** Helper file `lib/api-auth.ts` is COMMITTED but DORMANT (Session 21) — nothing imports it yet, so it has zero runtime effect. Rollout = converting call sites to use it. Not started.
- ~96 `getServerSession(authOptions)` calls across 81 API routes, each re-implementing its guard inline. Superadmin check is written ~6 different ways; 4 near-identical guard functions (`adminGuard`, `superadminGuard`, `sessionGuard`, `isSuperadmin`) are copy-pasted across 7 route files.
- **The helper (already in repo at `lib/api-auth.ts`):** exports `requireUser` (401), `requireSuperadmin` (403), `requireSuperadminOrDeveloper` (403), `requireTenant` (401). Each returns the validated `Session` OR a `NextResponse` error. Type-checks clean against the full project.
  - Call site pattern: `const session = await requireSuperadmin(); if (session instanceof NextResponse) return session` — then `session` is a guaranteed-valid Session.
- **Which guard replaces what, and where to apply it:**
  - `requireUser` → the 22 routes using plain `if (!session?.user)` / `sessionGuard` (401). Customer-facing routes under `app/api/requirements`, `app/api/settings`, etc.
  - `requireSuperadmin` → the 46 routes using `adminGuard` / `isSuperadmin` / inline `role !== 'superadmin'` (403). Mostly `app/api/admin/*`.
  - `requireSuperadminOrDeveloper` → the 3 routes allowing both roles, incl. `app/api/admin/requirements/route.ts` (the misnamed `superadminGuard` — see FILES_INVENTORY latent-traps).
  - `requireTenant` → routes needing a tenant-scoped user (those checking `session?.user?.tenantId`).
  - Per-route conversion = swap the guard call + delete the now-unused local guard function + drop unused `getServerSession`/`authOptions` imports.
- **Scope:** ~71 call sites (46 superadmin, 22 plain-auth, 3 superadmin-or-developer).
- **Why incremental, not big-bang:** auth is the one area where a silent mistake = lockout, and a git revert only catches build failures, not a guard that compiles but evaluates wrong. Fold conversions in when already working in a given route, verify behavior as a side effect of testing the real change. Do NOT do as one large pre-go-live refactor.
- **Benefit (honest):** no user-facing change. Closes a small security gap (consistent, vetted guard instead of 6 hand-written variants) and removes duplication. Modest — risk-reduction, not a feature.
- **Enforcement after rollout (so new routes don't reintroduce inline guards):**
  - Now / solo dev: rely on the "What NOT to Do" rule (see FILES_INVENTORY).
  - When a 2nd dev joins: add ESLint `no-restricted-imports` rule blocking `getServerSession` anywhere under `app/api` except `lib/api-auth.ts`. (Needs `next lint` wired into a CI/build step — currently not.)

#### H2. Final consistency sweep before go-live
**Status:** Checkpoint — schedule shortly before launch.
- NOT a heavy refactor. A light, read-only audit to confirm incremental cleanup actually converged: did any new route reintroduce an inline auth guard / old pattern that H1 (and similar) was meant to eliminate?
- This is the legitimate kernel of "tidy up before launch" — a check that incremental work finished, done well away from the launch-day risk of a large behavior-touching change.
- Purely-cosmetic, zero-behavior cleanups (formatting, dead-file removal, no-logic renames) CAN be batched into this sweep — they carry no rollback risk. Behavior-touching cleanups (like H1) must NOT wait for this; do them incrementally, early.

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
