# BespoxAI Web Portal — Project Summary

**Project Owner:** Rich Lancaster (richard.lancaster — Windows/MINGW64 environment)
**Current Status:** Full Next.js application deployed to Vercel. Live at bespoxai.com.
**Repository:** NavSolutionsNZ/BespoxAI_Web (GitHub) — renamed from BespokeAI_Web
**Hosting:** Vercel (auto-deploys on push to main)
**Created:** April 2026
**Last Updated:** June 4, 2026 (Session 13)

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

## Session 13 Key Changes (June 4, 2026)

### Partner Programme — Phase 2 Session 3 (Team, Settings, White-label, GitHub token)

#### Partner Team Management
- `GET/POST /api/partner/users` — list team, invite new member (admin only)
- `PATCH/DELETE /api/partner/users/[id]` — change role / remove (admin only)
- Guards: cannot demote or remove last admin
- Invite creates User with `mustChangePassword=true`, sends `notifyPartnerTeamWelcome`
- `/partner/team/page.tsx` — full team management page (separate route, not dashboard tab)
- `/partner/settings/page.tsx` — company settings page (see below)
- `app/partner/dashboard/page.tsx` — reverted to clean clients-only (no tabs)
- Partner layout: Settings + Team nav now visible to `partner_developer` role (read-only view)

#### Partner Settings Page (`/partner/settings`)
- **Company Info**: `contactName`, `phone`, `address`, `gstNumber`, `billingEmail` — `name` is read-only (superadmin only)
- **Branding**: `brandName`, `agentBrandName`, `logoUrl`, `primaryColour`, `isWhiteLabel` checkbox
- **White-label Email**: `fromEmail` — with SPF/DKIM warning note
- **GitHub**: `githubOrg`, `githubToken` (encrypted on save, placeholder `••••••••` = no change)
- **Change Password**: uses existing `/api/settings/profile/change-password`
- Admins: all sections editable. Developers: all sections read-only.

#### White-label From-address
- `PartnerAccount.fromEmail String?` added to schema
- SQL applied: `ALTER TABLE "PartnerAccount" ADD COLUMN IF NOT EXISTS "fromEmail" TEXT;`
- `lib/email.ts`: `sendEmail` accepts optional `from` override
- `lib/notifications.ts`: `getPartnerFromEmail(tenantId)` helper looks up partner's fromEmail
- All 7 customer-facing notify functions + `notifyUserWelcome` accept `tenantId?` and pass partner fromEmail through
- `notifyPartnerTeamWelcome` added — uses partner brandName + fromEmail if white-label
- 8 API callers updated to pass `tenantId` to notification calls
- Admin + partner account PATCH routes allow `fromEmail`

#### GitHub Partner Token Resolution
- `lib/github.ts`: `resolvePartnerToken(encryptedToken)` exported — decrypts via `lib/crypto.ts`
- `tokenOverride` threaded through all 6 internal functions: `ensureRepo`, `getBranchSha`, `ensureBranch`, `pushFiles`, `getFile`, `listFiles` and `pushObjectsToGitHub`
- `objects`, `sync-from-github`, `coding-assistant`, `commit` routes fetch and pass decrypted partner token
- Falls back to `GITHUB_CUSTOMER_REPOS_TOKEN` env var if no partner token set

#### `/api/partner/account` PATCH expanded
- Now covers: `contactName`, `phone`, `address`, `gstNumber`, `billingEmail`, `brandName`, `logoUrl`, `primaryColour`, `isWhiteLabel`, `agentBrandName`, `fromEmail`, `githubOrg`, `githubToken` (encrypted)

#### Settings Overview — BC Installer hint hidden for partner-managed users
- "To configure, go to the BC Installer tab" hidden when `managedByPartner=true`
- Both Production Environment and Test Environment cards affected

---

## Session 12 Key Changes (June 4, 2026)

### Partner Programme — Phase 2 BCAgent + Client UX
- **Partner BCAgent routes** — `POST /api/partner/tenants/[id]/installer`, `sync-config`, `provision-rdp`
- **BCAgent tab** in `/partner/tenants/[id]` — full Production + Test env form (editable, refs pattern)
- **`managedByPartner`** flag added to JWT/session for tenant users whose tenant has a `partnerAccountId`
- **Client user settings** — BC Installer tab hidden for partner-managed users; URL redirect guard added
- **Dashboard** — partner-managed clients: Upgrade/Billing sidebar hidden, installer setup prompt replaced
- **Request Connection / Request Upgrade buttons** — `POST /api/partner/request`, `GET /api/partner/request-state`

### Schema changes — Session 12
```sql
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "connectionRequestedAt"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "connectionRequestedToEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "upgradeRequestedAt"         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "upgradeRequestedToEmail"    TEXT;
```
Applied ✅

---

## Session 11 Key Changes (June 4, 2026)

### Partner Programme — Phase 2
- `User.tenantId` made nullable — partner users have no tenant
- SQL: `ALTER TABLE "User" ALTER COLUMN "tenantId" DROP NOT NULL;`
- `/partner/tenants/[id]` — 4-tab client management: Overview, Requirements, Users, Settings
- `POST /api/partner/tenants` — creates tenant with `partnerAccountId`, no tunnel
- Add Client form at `/partner/tenants/new`

---

## Session 10 Key Changes (June 4, 2026)

### Partner Programme — Phase 1
- PartnerAccount, PartnerUser, PartnerSignupRequest tables
- `lib/crypto.ts`, `lib/branding.ts`, `lib/partner-auth.ts`
- Partner portal dark sidebar layout + dashboard
- Partner self-serve signup flow
- Superadmin Partners tab
- partners.bespoxai.com domain

---

## Database

- **Provider:** PostgreSQL via Vercel Postgres
- **ORM:** Prisma — no migrations, uses `db push` or raw SQL
- **Never run** `prisma migrate`

### Known Test IDs
- **TestCo1 Tenant ID:** `cmpgqbg8l0001tqej9wpqsx6g` (tunnelSubdomain: testco1, agentPort: 9099)
- **GWM Dev Tenant ID:** `cmoqi33pu0000l3b0zusc5hgz` (tunnelSubdomain: gwmdev)
- **GWM Dev active requirement:** `cmpi4tisk00011422fazu1pxx`
- **Test Partner:** slug: testpartner, login: partner@testpartner.com / Partner123!
- **Test client user:** client@acmedist.com / password (tenant_admin on Acme, managedByPartner=true)

### Schema changes — Session 13
```sql
ALTER TABLE "PartnerAccount" ADD COLUMN IF NOT EXISTS "fromEmail" TEXT;
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
4. Customer receives temp credentials + welcome email
5. Login → onboarding Step 0 (set permanent password) → Step 1-5
6. Settings → BC Installer → Download
7. Run installer on Windows server as Administrator (port 9099)

---

## Brand & Messaging

- **Login tagline:** "Business Central & Microsoft NAV Intelligence Portal"
- **Signup tagline:** "CFO Intelligence for Business Central & Microsoft NAV"
- **Homepage hero:** "Your Business Central. One portal. Complete control."
- **Primary brand line:** "Bespoke AI. Built for the ERP Microsoft left behind."
- **Backgrounds:** White (`#ffffff`) throughout portal
- **Placeholder color:** `#8a9a8e`
- **GST:** All prices show "plus GST"

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

---

## Vercel MCP Access
- **Team ID:** `team_eZ4MqWjZdsPA2iWoK4exjjPF`
- **Project ID:** `prj_AT4GXatATIi2FaUCS62Ttp2AivRo`
- Use `Vercel:list_deployments` + `Vercel:get_deployment_build_logs` to check errors
