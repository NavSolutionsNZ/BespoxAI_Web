# BespoxAI Web Portal — Component Roadmap

**Last Updated:** June 5, 2026 (Session 16)

---

## Current State — What's Live

### ✅ Production & Working

**Session 14 — Partner Phase 4 White-label Branding (continued)**
- [x] primaryColour/secondaryColour removed from branding stack — name and logo only
- [x] Client portal fully isolated: billing page redirects managedByPartner users, UpgradePrompt replaced with contact-partner screen
- [x] Settings page: branding fetch + sidebar logo branding-aware
- [x] Misleading test env placeholders fixed (both settings + partner tenant detail)
- [x] DB: primaryColour + secondaryColour columns dropped from PartnerAccount

**Session 14 — Partner Phase 4 White-label Branding**
- [x] `/api/branding` route — resolves BrandingConfig per user (partner, managed client, or BespoxAI default)
- [x] Partner layout: fetches branding on mount, applies brandName/logoUrl/primaryColour/secondaryColour when isWhiteLabel
- [x] Dashboard: fetches branding, applies to sidebar logo, CFO heading, print export title/header/footer
- [x] CSS variable injection: --forest (primaryColour) and --jade (secondaryColour) overridden at runtime when isWhiteLabel
- [x] secondaryColour field added to PartnerAccount schema + SQL applied
- [x] resolveBranding: HEX6 validation on both colour fields, invalid values fall back to BespoxAI defaults
- [x] Partner settings: secondaryColour input added to Branding section
- [x] Installer routes (settings + partner): agentBrandName resolved from partnerAccount, injected into PS1 + bat
- [x] Install-BespoxAI.ps1: $BrandName param added, all terminal output/paths/task/account names use it; X-BespoxAI-Key + id=BespoxAI left as internal protocol strings

**Session 13 — Partner Phase 2 Session 3**
- [x] `/partner/team` page — invite, role change, remove (admin edit / developer read-only)
- [x] `/partner/settings` page — Company Info, Branding, White-label Email, GitHub, Change Password
- [x] Partner dashboard reverted to clean clients-only (no tabs)
- [x] Partner layout: Settings + Team nav visible to partner_developer role
- [x] `PartnerAccount.fromEmail` added to schema + SQL applied
- [x] `sendEmail` accepts optional `from` override
- [x] `getPartnerFromEmail(tenantId)` helper in notifications.ts
- [x] All 7 customer-facing notify functions + notifyUserWelcome accept tenantId for white-label from address
- [x] `notifyPartnerTeamWelcome` added
- [x] `resolvePartnerToken()` in lib/github.ts — decrypts AES-256-GCM partner token
- [x] tokenOverride threaded through all github.ts functions
- [x] objects, sync-from-github, coding-assistant, commit routes resolve + pass partner token
- [x] `/api/partner/users` GET/POST + `/api/partner/users/[id]` PATCH/DELETE
- [x] `/api/partner/account` PATCH expanded to cover all settings fields
- [x] Settings overview: "To configure, go to BC Installer tab" hidden for partner-managed users

**Session 12 — Partner Phase 2 BCAgent + Client UX**
- [x] Partner BCAgent routes (installer, sync-config, provision-rdp)
- [x] BCAgent tab in /partner/tenants/[id]
- [x] managedByPartner flag in JWT/session
- [x] BC Installer tab hidden for partner-managed users
- [x] Request Connection / Request Upgrade flow

**Session 11 — Partner Phase 2 Core**
- [x] User.tenantId nullable
- [x] /partner/tenants/[id] 4-tab view
- [x] Add Client form at /partner/tenants/new
- [x] Partner tenant API routes

**Session 10 — Partner Phase 1**
- [x] PartnerAccount, PartnerUser, PartnerSignupRequest tables
- [x] lib/crypto.ts, lib/branding.ts, lib/partner-auth.ts
- [x] Partner portal dark sidebar layout
- [x] Partner self-serve signup
- [x] Superadmin Partners tab
- [x] partners.bespoxai.com domain

**Session 9 — Manual Deploy + Pipeline Dates**
- [x] Manual deploy routes (test + prod)
- [x] Pipeline date fields on all status transitions
- [x] notifyCustomerReadyForUAT
- [x] Collapsible cards in admin (AI Spec, Q&A, Description)
- [x] GST: "plus GST" site-wide

**Session 8 — BCAgent v3.2 + RDP**
- [x] SupportAccountPassword inject fix
- [x] agent.config.json version dynamic
- [x] BCAgent v3.2
- [x] RDP end-to-end confirmed working on TestCo1

**Session 7 — UAT Pipeline + Preferred Name**
- [x] UAT status pipeline (in_uat, uat_confirmed, uat_rejected)
- [x] RDP remote support (BCAgent Step 8)
- [x] Preferred name site-wide
- [x] Settings overview cards

**Session 6 — Deploy Pipeline**
- [x] Deploy + Compile to Test — ✅ FULLY WORKING
- [x] Sync Config to Agent

---

## Session 15 Key Changes (June 5, 2026)

### Admin Collapsible Panels ✅
- Dev Plan, Deploy to Test, Deploy to Production, Quote info, Addenda
- All default collapsed; open panel determined by requirement status via `isAdminCardCollapsed()`
- `isAdminCardCollapsed` uses `openFor` lookup table keyed by status

### Customer Portal Collapsible Panels — ✅ RESOLVED & LIVE (Session 16)
- CardToggleBtn standalone component (same pattern as AdminCardToggleBtn)
- collapsedCards state + toggleCard + isCardCollapsed in RequirementsBuilder
- selectReq resets collapse state to status-appropriate defaults on selection
- Sections wrapped: Description, Feasibility, AI Spec, Quote, UAT, Prod Deploy, Addenda
- **Was NEVER an SWC bug.** The build failure was three real JSX structural errors:
  1. Four collapse-wrapper `<div>`s (quote/uat/proddep/addenda) opened but never closed
  2. An unclosed `{!error && <>` fragment (no matching `</>}`) — this is what made the
     error always point at the main `return (`; an unbalanced fragment desyncs SWC's stack
  3. A corrupted `Sect` component close (`</> }` + stray `</div>`)
- Fixed in commits `7d3b89f` (structural) + `d32f9b1` (template-literal cleanup). Both deployed READY.
- No component extraction was needed — the file is still ~2500 lines and builds fine.

### SWC Diagnosis — CORRECTED (Session 16 supersedes Session 15)
The Session-15 hypothesis ("SWC misreads TS generics/`as const`/large files as JSX") was WRONG.
`Record<K,V>`, `useState<T>({})`, and `as const` are all fine — admin/page.tsx uses them at 4000+ lines.
- **Real rule:** SWC build failures = real JSX tag/fragment imbalance. Find the unclosed
  `<div>` or `<>`/`</>` and close it.
- **Diagnose locally:** `npm i @swc/core`, then `swc.parseSync(code, {syntax:'typescript', tsx:true})`.
  `tsc --noEmit` does NOT catch JSX tag/fragment imbalance (it doesn't use SWC's parser) — that's
  why every prior `tsc`-clean attempt still failed at Vercel.
- SWC reports the wrong *line* (nearest JSX it can't reconcile). Trust tag/fragment balance
  counts over the reported location. Fix first mismatch → re-parse → repeat until PARSE OK.
- Style-prop template literals → string concatenation (done for all 11 in RequirementsBuilder).
  JS-context template literals (fetch URLs, `.map()` joins) are fine — leave them.

---

## Work Backlog (Prioritized)

### 🔴 HIGH PRIORITY

#### 1. Deploy + Compile to Production — Test When Ready
**Status:** Code complete. Will be tested when Rich is ready.

#### 2. CFO Assistant — NAV v14 OData Planner Tuning
**Known issues:**
- `$orderby=Posting_Date desc` returns 400 on GeneralLedgerEntry, SalesInvoice in NAV v14
- `$filter` on Posting_Date not supported on posted documents
- Some tiles show `,` (Overdue Debtors, Cash & Bank, Outstanding Payables)
**Fix:** Update planner system prompt in `app/api/query/route.ts`

#### 3. Async Job Pattern for Deploy Timeout
BCAgent returns jobId immediately, portal polls for completion.
Requires BCAgent Start-Job background threading + portal polling endpoint + UI progress.

### 🟡 MEDIUM PRIORITY

#### 4. Partner Phase 3 — Billing
- bespoxai_collected: standard Stripe checkout for partner clients
- partner_collected: revenue share invoicing to partner

#### 5. Partner Phase 4 — White-label Branding ✅ COMPLETE
- [x] resolveBranding() applied to partner portal + customer dashboard (name + logo only — no colour overrides)
- [x] agentBrandName wired into installer generation (both settings + partner routes)
- [ ] Full SMTP per partner (fromEmail stored, BespoxAI SMTP still used — deferred)

#### 6. Collapsible Sections in Admin Requirements View
- [x] Admin panels done (Dev Plan, Deploy to Test, Deploy to Prod, Quote, Addenda)
- [x] Customer portal panels — DONE & LIVE (Session 16). Was a JSX tag/fragment imbalance, not an SWC bug.

#### 7. Customer Requirement View — UAT Rejection History

#### 8. Human-Readable Deployment Folder Names

#### 9. Installer — Directory creation message
"Directories created" → "Directories verified/created"

#### 10. Health Scanner — Real Data

#### 11. Dynamic Web Service Creation (CFO Assistant prerequisite)

#### 12. Last CU — Auto-fetch from BC

### 🟢 LOW PRIORITY

#### 13. Save AI Dev Notes to Requirement
#### 14. Phase 2 — Scheduled Production Deployment
#### 15. VS Code Extension for Coding Assistant
#### 16. Bundle cloudflared in installer zip

---

## How Claude Should Work on This Project

1. **Get PAT from Rich** at start of session
2. **Sparse checkout** — never full clone
3. **Read context files first** — never guess at file structure or API signatures
4. **Check imports** before every push
5. **Never import `@anthropic-ai/sdk`** — use provider-agnostic fetch pattern
6. **Never use `router.back()`** — always explicit `router.push()`
7. **Full file rewrites** — use `create_file` or bash heredoc, NOT Python str_replace patches, when rewriting an entire page component. Python patches are only for targeted single-occurrence replacements in large files.
8. **Targeted edits** — always verify target string is unique before replacing; view file immediately before editing
9. **Push:** `git push origin master:main`
10. **Vercel auto-deploys** in ~30–60s — check logs via Vercel MCP on errors
11. **DB changes:** SQL in Vercel → Storage → Postgres → Query, then update prisma/schema.prisma
12. **Settings inputs:** always use refs + defaultValue — NEVER controlled inputs
13. **Update context files** at end of session
14. **BCAgent edits:** edit Install-BespoxAI.ps1 only
15. **NEVER push without explicit confirmation from Rich**
16. **DIAGNOSE BEFORE ARCHITECTING:** always check Vercel MCP logs before proposing solutions
17. **DISCUSS SIGNIFICANT CHANGES** before implementing
18. **BUMP VERSION on every push** — `$AgentVersion`/`$Version` in PS1 + `AGENT_VERSION` in installer/route.ts

### SWC/JSX Rules (critical)
- **SWC build failure = real JSX tag/fragment imbalance, NOT a parser bug or file-size issue.** Find the unclosed `<div>` / unbalanced `<>`/`</>` and close it. Diagnose locally with `@swc/core` (`swc.parseSync(code,{syntax:'typescript',tsx:true})`) — `tsc --noEmit` does NOT catch this. SWC reports the wrong line (nearest JSX); trust balance counts, fix first mismatch, re-parse until PARSE OK.
- Use `cond ? <JSX/> : null` NOT `cond && <JSX/>` in large function returns
- No template literals `${vars}` in JSX (style props, text, children) — use string concatenation. JS-context literals (fetch URLs, `.map()` joins) are fine.
- `Record<K,V>`, `useState<T>({})`, `as const` are all SAFE in large component bodies (disproven Session-15 myth) — do not waste time refactoring these to fix a build.
- Large components: extract sub-sections as separate named functions OUTSIDE main component
- `React.useState` fails in standalone functions — use destructured `useState`
- Never import `@anthropic-ai/sdk` — use provider-agnostic fetch pattern
