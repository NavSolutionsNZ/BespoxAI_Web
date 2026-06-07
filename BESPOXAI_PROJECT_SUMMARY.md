# BespoxAI Web Portal — Project Summary

**Project Owner:** Rich Lancaster (richard.lancaster — Windows/MINGW64 environment)
**Current Status:** Full Next.js application deployed to Vercel. Live at bespoxai.com.
**Repository:** NavSolutionsNZ/BespoxAI_Web (GitHub) — renamed from BespokeAI_Web
**Hosting:** Vercel (auto-deploys on push to main)
**Created:** April 2026
**Last Updated:** June 7, 2026 (Session 19 — Final)

---

## ⚠️ Critical Architecture Note

**This is NOT a single HTML file project.** The live production site at bespoxai.com is a full **Next.js application** with:
- App Router (`/app` directory)
- NextAuth authentication
- Prisma ORM + PostgreSQL (Vercel Postgres)
- Stripe billing
- Cloudflare tunnel for BC/NAV connectivity
- Multiple API routes
- AI provider switchable (OpenAI or Anthropic — use fetch pattern, not SDK)
- GitHub per-customer repos

**Marketing pages:** `public/index.html` — the LIVE homepage

---

## GitHub Access

- **Repo:** `NavSolutionsNZ/BespoxAI_Web` (renamed from BespokeAI_Web — old URL still redirects)
- **Branch:** `main`
- **Claude uses sparse checkout** — never clones the full repo. Include `"prisma"` and context files in set.
- **api.github.com is blocked** — but `github.com` git operations work
- **Push:** `git push origin master:main`
- **Remote URL:** `https://{TOKEN}@github.com/NavSolutionsNZ/BespoxAI_Web.git`

### Sparse Checkout Setup (every session)
```bash
cd /home/claude
git init repo && cd repo
git remote add origin https://{TOKEN}@github.com/NavSolutionsNZ/BespoxAI_Web.git
git sparse-checkout init
git sparse-checkout set --no-cone "app" "components" "lib" "scripts" "prisma" "BESPOXAI_PROJECT_SUMMARY.md" "BESPOXAI_COMPONENT_ROADMAP.md" "BESPOXAI_FILES_INVENTORY.md"
git pull origin main
git config user.email "claude@anthropic.com" && git config user.name "Claude"
```

---

## Session 19 Key Changes — Part 2 (June 7, 2026)

### Partner Portal UX Improvements
- **Removed Agreement link:** Partner portal navigation menu no longer displays "Agreement" link — partners can access agreement through other channels if needed
- **Password change on first sign-in:** New partners now see a modal overlay requiring password change on first sign-in
  - Modal is non-dismissible until password is successfully set
  - Minimum password length: 8 characters
  - Matches customer onboarding UX (Step 0 password change)
  - Uses `mustChangePassword` JWT flag (already set during partner provision)
- **Modal styling:** Consistent with dark theme partner portal (GitHub-like dark colors)

### Session 19 Key Changes — Part 1 (June 7, 2026)

### Spec Regeneration Locked After Customer Acceptance
- **Customer portal (RequirementsBuilder):** Regen button ONLY shown in `draft` status
  - Once requirement is submitted (any other status), regen button disappears
  - Spec remains read-only (was already read-only)
- **Admin portal (AdminRequirementsTab):** Regen button hidden when status >= `quoted`
  - Developers can regenerate spec while in pre-quote statuses: draft, submitted, in_review, needs_clarification, quote_rejected
  - Once customer approves quote (status: quoted), spec locks for everyone
- **Partner admin portal (RequirementDetail):** Regen button added with same pre-quote restriction
  - New partner spec generation route: `POST /api/partner/tenants/[id]/requirements/[reqId]/ai-spec`
  - Partners can regenerate spec up until customer acceptance (quoted status)
- **Rationale:** Spec generation happens during discovery/refinement phase. Once customer accepts the quote, spec is final and should not be re-generated (only spec updates should be via addenda)
- **Tested & confirmed:** All portals (customer, admin, partner) working with correct button visibility and API flows

---

## Session 18 Key Changes (June 7, 2026)

### Admin Portal UI Cleanup & Bug Fixes
- **Removed CFO Assistant link:** Superadmin sidebar no longer shows "← CFO Assistant" link — superadmins don't need direct access. Kept the feature flag in AI Setup (controls customer access).
- **Fixed Users table null reference:** Added null check `u.tenant?.name || '—'` to prevent crashes when tenant is null
- **Root cause diagnosed:** Pat Partner (partner@testpartner.com, user role) was created without tenantId
- **Data integrity fixed:** Assigned Pat Partner to TestCo1 via SQL — `UPDATE "User" SET "tenantId" = 'cmpgqbg8l0001tqej9wpqsx6g' WHERE id = 'cx6r5i4m9r18fr5k5gy87z44g'`
- **Commits:** 4 pushes (sidebar link + null check + context files + email flow)

### Partner Email Flow Cleanup
- **Removed redundant email:** `notifySendPartnerAgreement()` no longer sent during partner email verification
- **Rationale:** Modal in UI now handles agreement review; email was redundant
- **New flow:** 
  - Partner signs up → verifies email → superadmins notified (only)
  - Superadmin activates → partner receives activation confirmation + temporary credentials
  - Partner logs in with temp password → forced to set permanent password (`mustChangePassword: true`)
- **Affected route:** `app/api/partner-signup/verify/route.ts` — removed agreement email call

### Notes on User tenantId
- Schema allows `tenantId` to be nullable — users CAN legitimately have null tenant (e.g., superadmins)
- Non-superadmin users must have a tenantId to be functional
- Admin API POST `/api/admin/users` requires tenantId — prevents creating users without tenant
- Should consider data validation to prevent orphaned users (tenant deleted but user remains)

### Previous Session 18 Work (June 6)
- AI-Generated Functional Spec now collapsible in RequirementsBuilder
- Status-dependent defaults + toggle button styled like AdminCardToggleBtn
- BCAgent v3.3

---

## Session 17 Key Changes (June 6, 2026)

### Requirement Assignment System — LIVE
- Schema: `assignedDeveloperId` (non-nullable, defaults to creating user), `assignedAt`, `unableToCompleteAt`
- **Auto-assignment:** Requirements auto-assign to user who creates them
- **Admin reassign:** `/api/requirements/[id]/assign` — PATCH to reassign to another developer
- **Developer mark unable:** `/api/requirements/[id]/mark-unable` — POST to flag requirement as unable to complete
- **Developer filtered view:** Developers see only their assigned requirements in list
- **Assignment modal:** Circular selectors with workload indicators (counts active reqs per dev: light/moderate/heavy)
- **Modal fix:** Proper state management — circles now fill correctly on click, Assign button responsive
- **Notifications:** `notifyRequirementAssigned()` sent to newly assigned dev, `notifyAdminRequirementUnableToComplete()` sent to tenant admins when dev marks unable
- **Affects:** Both BespoxAI and partner portals (same functionality)
- **Tested & confirmed:** Live and working ✅

### Next Priority
- **AI-Generated Functional Spec** section in admin requirement detail to be independently collapsible

---

## Session 8 Key Changes (May 26, 2026)

### RDP End-to-End Test — Confirmed Working (TestCo1)
- RDP via Cloudflare tunnel fully tested and working on TestCo1
- Local machine requires: `cloudflared.exe` from https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
- Connect command: `cloudflared access rdp --hostname {subdomain}-rdp.bespoxai.com --url localhost:3390`
- Then RDP to `localhost:3390` with username `.\BespoxAI-Support` and password from Admin panel copy button

### Bug Fix: SupportAccountPassword Inject (Step 8 was silently skipped)
- **Root cause:** route.ts `.replace()` searched for `[string] $SupportAccountPassword = '',` (with trailing comma) but PS1 has no trailing comma on last param — replace never matched, password stayed empty, Step 8 skipped with "Skipped — no support account password provided"
- **Fix:** Removed trailing comma from both sides of the `.replace()` in `app/api/settings/installer/route.ts`

### Bug Fix: agent.config.json version hardcoded as '2.4'
- **Root cause:** Step 5 of installer had `version = '2.4'` hardcoded — never updated across versions
- **Fix:** Changed to `version = $AgentVersion` — now always reflects current installer version dynamically

### BCAgent Version Bump → 3.2
- `$AgentVersion` and `$Version` in `Install-BespoxAI.ps1` → `'3.2'`
- `AGENT_VERSION` in `app/api/settings/installer/route.ts` → `'3.2'`

### RDP Cleanup Script (for post-testing removal of BespoxAI-Support)
```powershell
net user BespoxAI-Support /delete
net user BespoxAI-Support  # verify gone
```
RDP setting and firewall rule can be left — do not disable RDP as it locks out other admin access.

---

## Session 7 Key Changes (May 26, 2026)

### UAT Status Pipeline
- deploy-test → sets `status: 'in_uat'` on success
- uat-approve → sets `status: 'uat_confirmed'`
- uat-reject → sets `status: 'uat_rejected'`
- STATUS_PIPELINE, STATUS_COLOR, statusLabel updated in RequirementsBuilder + admin
- UAT panel condition driven by status not testDeployedAt
- Null-guard on testDeployedAt date display

### RDP Remote Support (v3.1)
- BCAgent installer Step 8: creates `BespoxAI-Support` local Windows account, adds to Administrators + Remote Desktop Users, enables RDP (port 3389)
- `$SupportAccountPassword` param baked in at installer download, stored as `rdpPassword` in DB
- `lib/cloudflare.ts`: `addRdpIngress()` + `createRdpDnsRecord()` — isolated, existing functions untouched
- `POST /api/admin/provision-rdp`: adds CF ingress + DNS for `{subdomain}-rdp.bespoxai.com`
- Admin tenants table: `[RDP — Tenant Name]` button + `[⧉]` copy password button
- Schema: `rdpPassword String?` added to Tenant
- SQL applied: `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "rdpPassword" TEXT;`

### Back Button Fixes
- Settings tabs: `router.push('/settings?tab=x')` instead of `setTab()` — history entries created
- Settings: `router.replace` to `?tab=overview` on load if no tab param
- Dashboard settings icon: pushes `/settings?tab=overview` (distinct history entry)
- Dashboard nav: `router.replace` → `router.push` for tab changes

### Preferred Name — Site-wide
- `lib/auth.ts`: `firstName` + `preferredName` added to JWT, session, and session refresh
- Rule: `preferredName ?? firstName` only — no fallback to full name
- Dashboard greeting + sidebar, Admin sidebar, Settings sidebar all use preferred name
- `lib/notifications.ts`: `displayName()` helper + `getCustomerEmail` fetches both fields
- CFO assistant answerer: addresses user by `preferredName ?? firstName`
- **Users must log out and back in** for token to pick up new fields

### Installer Filename
- Download button now triggers `Install-BespoxAI-v3.2.zip` (versioned filename)
- Fixed in `app/settings/page.tsx` — `download` attribute was hardcoded

### White Backgrounds
- `--white` CSS variable changed from `#FAFAF8` → `#ffffff` — true white site-wide

### Settings Overview — Production/Test Environment Cards
- Renamed "BC Connection" → "Production Environment Details"
- Removed "System Configuration" card
- Added Product + Last CU fields to Production Environment Details (read-only from DB)
- Removed Agent URL, Status, Member Since from display
- Both cards use consistent grid layout (label above value, font-body text)
- Test env shows all fields with `—` for blanks
- "Leave blank" instruction removed from test env overview (it's read-only)

### Vercel MCP
- Connected Session 7 — Claude can now pull deployment logs directly via Vercel MCP
- Team ID: `team_eZ4MqWjZdsPA2iWoK4exjjPF`
- Project ID: `prj_AT4GXatATIi2FaUCS62Ttp2AivRo`

---

## Database

- **Provider:** PostgreSQL via Vercel Postgres
- **ORM:** Prisma — no migrations, uses `db push` or raw SQL
- **Never run** `prisma migrate`
- **No local clone needed** — Vercel runs `prisma generate` on deploy from schema.prisma in GitHub

### Known Test IDs
- **TestCo1 Tenant ID:** `cmpgqbg8l0001tqej9wpqsx6g` (tunnelSubdomain: testco1, agentPort: 9099)
- **GWM Dev Tenant ID:** `cmoqi33pu0000l3b0zusc5hgz` (tunnelSubdomain: gwmdev — NOT the test tenant)
- **GWM Dev active requirement:** `cmpi4tisk00011422fazu1pxx` (req/cmpi4tis-add-release-date branch)
- **Test Requirement ID:** `cmpdstipk0001tzkg2oq6zlrs`

### Schema Changes — Session 7
```sql
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "rdpPassword" TEXT;
```
Applied ✅. prisma/schema.prisma updated ✅.

---

## Settings Page — CRITICAL Input Pattern

**ProdEnvForm and TestEnvForm use refs + defaultValue (not controlled inputs).**

```tsx
// CORRECT — refs pattern
const refs = { field: useRef<HTMLInputElement>(null) }
<input ref={refs.field} defaultValue={initial.field} ... />
const val = refs.field.current?.value || ''

// WRONG — causes reset bug
const [val, setVal] = useState('')
<input value={val} onChange={e => setVal(e.target.value)} ... />
```

---

## BCAgent v3.2 — Architecture

```
Portal (Vercel) → https://{subdomain}-agent.bespoxai.com (Cloudflare tunnel)
  → cloudflared (Windows service, --protocol http2, runs as SYSTEM)
  → localhost:9099 (BCAgent scheduled task, runs as BC user account)
  → localhost:8048/{bcInstance} (BC/NAV OData, NTLM via UseDefaultCredentials)

RDP: https://{subdomain}-rdp.bespoxai.com (separate CF tunnel ingress)
  → localhost:3389 (Windows RDP)
  → BespoxAI-Support account (local admin, RDP enabled by installer Step 8)
```

### RDP Connection (Rich's local machine)
1. Download cloudflared: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
2. Run: `cloudflared access rdp --hostname {subdomain}-rdp.bespoxai.com --url localhost:3390`
3. RDP to `localhost:3390` — username `.\BespoxAI-Support`, password from Admin panel

### Known NAV v14 OData Limitations
- `$orderby=Posting_Date desc` NOT supported on GeneralLedgerEntry, SalesInvoice
- `$filter` on Posting_Date NOT supported on posted documents
- `$apply`, `groupby`, `aggregate()` NOT supported

---

## CFO Assistant Query Pipeline

1. **Router** (jsonMode:true) — classify needsData
2. **Planner** (jsonMode:true) — pick entity + OData params
3. **OData fetch** — via tunnel → BCAgent → BC
4. **Answerer** — formats response, addresses user by preferredName ?? firstName

---

## Customer Onboarding Flow

1. Sign up → select BC or NAV version → verify email
2. Email triggers `notifyAdminsSignupVerified` to superadmins
3. Superadmin activates from Admin → Signups
4. Customer receives temp credentials + welcome email with password change warning
5. Login → onboarding Step 0 (set permanent password) → Step 1-5 (name, product, connection)
6. Settings → BC Installer → Download (auto-creates tunnel first time, generates rdpPassword on first download only)
7. Run installer on Windows server as Administrator (port 9099) — no uninstall needed for reinstall

---

## Brand & Messaging

- **Login tagline:** "Business Central & Microsoft NAV Intelligence Portal"
- **Signup tagline:** "CFO Intelligence for Business Central & Microsoft NAV"
- **Homepage hero:** "Your Business Central. One portal. Complete control."
- **Primary brand line:** "Bespoke AI. Built for the ERP Microsoft left behind."
- **Backgrounds:** White (`#ffffff`) throughout portal — `--white: #ffffff` in globals.css
- **Placeholder color:** `#8a9a8e` (global CSS)

---

## Plans & Pricing

| Plan | Price | AI Tokens/month |
|------|-------|-----------------|
| Free / Trial | Free | 50,000 |
| Starter | $59/mo | 50,000 |
| Assistant | $299/mo | 300,000 |
| Manager | $499/mo | 750,000 |
| Executive | $999/mo | 3,000,000 |
| Specification Review | $249 one-time | — |

---

## AI System — Provider-Agnostic Pattern (CRITICAL)

Never import `@anthropic-ai/sdk` in API routes:

```typescript
const cfg = await getAiConfig()
const apiKey = cfg.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
if (cfg.provider === 'anthropic') {
  fetch('https://api.anthropic.com/v1/messages', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, ...
  })
}
```

---

## Navigation Rules

- **Never** `router.back()` — always explicit `router.push()`
- Settings deep-links: `?tab=installer`, `?tab=overview`, `?tab=users`, `?tab=entities`
- Settings always has tab in URL — `router.replace('/settings?tab=overview')` on load if none
- Dashboard: `?view=xxx` — uses `router.push` (not replace) for back button support
- Unconnected users → default to `customisations` tab
- Back button works correctly across: Settings tabs, Dashboard nav, Admin tabs
