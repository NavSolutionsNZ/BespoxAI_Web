# BespoxAI Web Portal — Project Summary

**Project Owner:** Rich Lancaster (richard.lancaster — Windows/MINGW64 environment)
**Current Status:** Full Next.js application deployed to Vercel. Live at bespoxai.com.
**Repository:** NavSolutionsNZ/BespokeAI_Web (GitHub)
**Hosting:** Vercel (auto-deploys on push to main)
**Created:** April 2026
**Last Updated:** May 25, 2026 (Session 5)

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

- **Repo:** `NavSolutionsNZ/BespokeAI_Web`
- **Branch:** `main`
- **Claude uses sparse checkout** — never clones the full repo
- **api.github.com is blocked** — but `github.com` git operations work
- **Push:** `git push origin master:main`

---

## Session 5 Key Changes (May 25, 2026)

### Admin — Tenants Tab
- STATUS column now shows **Connected / Not Connected** based on `tunnelId` (not account `active`)
- Added `ConnectedPill` component (separate from `StatusPill` to avoid SWC template literal issues)

### Deployment Pipeline — Write & Deploy to Test
- **Sync from GitHub → DB** button added to Deploy panel — pulls latest files from GitHub branch into `TenantObjectFile` so developer edits are picked up before deploying
- New API route: `POST /api/requirements/[id]/objects/sync-from-github`
- New API route: `GET /api/requirements/[id]/objects/write` (reads objects, writes to BCAgent deployment folder)
- **BCAgent stream read fix:** `Stream.Read()` now loops until all bytes consumed — fixes "Unterminated string" on large payloads (e.g. Codeunit 80)
- **BCAgent JSON response fix:** Backslashes in Windows paths now escaped in JSON responses
- **Write route hardening:** try-catch around BCAgent fetch; text-first JSON parse with regex fallback for `snapshotId`
- **deploy-test + deploy-prod route hardening:** same text-first JSON parse, try-catch around fetch, removed template literals
- `writeSnapshotId` persisted to DB (`testDeploySnapshotId`) immediately after successful write — Step 2 stays available across sessions
- Deploy error handling fixed in admin UI — real error messages now shown instead of `<!DOCTYPE` HTML
- **Deploy + Compile to Test still failing** — error returns immediately (not timeout). Need to check BCAgent logs at `C:\BespoxAI\Agent\BCAgent.log` on GWM server to diagnose. **Do not assume timeout — ask Rich to check logs first.**

### Onboarding — Step 0: Force Password Change
- New `mustChangePassword Boolean` column on User (added via raw SQL — schema.prisma NOT yet updated — do this on PC)
- New API route: `POST /api/settings/profile/change-password`
- Onboarding Step 0 shown when `mustChangePassword = true` — user must set permanent password before proceeding
- `mustChangePassword = true` set automatically on: provision (admin creates tenant), invite (settings/users)
- `mustChangePassword = false` cleared on successful password change
- Session token updated via `update()` call — `mustChangePassword` flows through JWT like `onboardingDone`

### Welcome Email
- `notifyUserWelcome()` added to `lib/notifications.ts`
- Sent automatically on provision AND settings/users invite
- Shows temp credentials + amber warning about mandatory password change on first login
- **Settings → Profile: Change Password** collapsible section added for all users (requires current password)

### Mobile Responsiveness — ALL user types covered
- **Settings:** Sticky top nav bar, horizontal tab strip, fluid grids (`auto-fit`), reduced padding, scroll-to-top on tab change
- **Dashboard:** Slide-over sidebar (fixed position overlay on mobile), backdrop tap to close, auto-closes on nav selection, compact header/badge
- **Admin:** Slide-over sidebar + ☰ hamburger toggle, auto-closes on tab selection
- **Onboarding:** Sidebar hidden on mobile (progress bar at top replaces it), reduced padding
- **Billing:** Header wraps cleanly on mobile, plan cards already use `auto-fit`
- **Login:** Corner links tightened to 20px
- **Signup:** Card padding uses `clamp()` for mobile

### Process Note (CRITICAL)
- **Batch deployments:** Claude must NOT push changes without explicit confirmation from Rich
- **Diagnose before architecting:** Always ask for logs/error details before proposing architectural changes
- **Discuss significant changes** (e.g. async deploy pattern) before implementing

---

## Database

- **Provider:** PostgreSQL via Vercel Postgres
- **ORM:** Prisma — no migrations, uses `db push` or raw SQL
- **Never run** `prisma migrate`

### Known Test IDs
- **TestCo1 Tenant ID:** `cmpgqbg8l0001tqej9wpqsx6g` (tunnelSubdomain: testco1, agentPort: 9099)
- **GWM Dev Tenant ID:** `cmoqi33pu0000l3b0zusc5hgz` (tunnelSubdomain: gwmdev — NOT the test tenant)
- **GWM Dev active requirement:** `cmpi4tisk00011422fazu1pxx` (req/cmpi4tis-add-release-date branch)
- **Test Requirement ID:** `cmpdstipk0001tzkg2oq6zlrs`

### Schema Changes — Session 5
```sql
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
```
⚠️ `prisma/schema.prisma` NOT yet updated — add `mustChangePassword Boolean @default(false)` to User model on PC.

### Schema Changes — Session 3
```sql
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preferredName" TEXT;
```

---

## Settings Page — CRITICAL Input Pattern

**All form inputs in `app/settings/page.tsx` use refs + defaultValue.**

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

## BCAgent — Session 5 Changes (CRITICAL)

- **Version: 2.4** (unchanged version number but significant fixes)
- All `Stream.Read()` calls now loop until all bytes consumed — fixes truncation on large payloads
- JSON responses with Windows paths now escape backslashes (`\` → `\\`)
- **Deploy endpoint still synchronous** — async job pattern was explored but reverted pending log diagnosis
- **GWM server has new agent installed** (reinstalled during Session 5)

### BCAgent Architecture
```
Portal (Vercel) → https://{subdomain}-agent.bespoxai.com (Cloudflare tunnel)
  → cloudflared (Windows service, --protocol http2, runs as SYSTEM)
  → localhost:9099 (BCAgent scheduled task, runs as BC user account)
  → localhost:8048 (BC/NAV OData, NTLM via UseDefaultCredentials)
```

### Known NAV v14 OData Limitations (affects CFO assistant planner)
- `$orderby=Posting_Date desc` NOT supported on GeneralLedgerEntry, SalesInvoice — returns 400
- `$filter` on Posting_Date NOT supported on posted documents — returns 400
- `$apply`, `groupby`, `aggregate()` NOT supported — returns 400

---

## CFO Assistant Query Pipeline (Session 4 Fixes)

1. **Router** (classify needsData) — now uses `jsonMode: true` to force JSON from gpt-4o
2. **Planner** (pick entity + OData params) — now uses `jsonMode: true` to force JSON from gpt-4o
3. **OData fetch** — via tunnel → BCAgent → BC
4. **Answerer** — formats response

### Bad Query Steering
```sql
DELETE FROM "QueryLog" WHERE "tenantId" = '{tenantId}' AND entity = '__BAD_QUERY__';
```

---

## Customer Onboarding Flow

1. Sign up → select BC or NAV version → verify email
2. Email triggers `notifyAdminsSignupVerified` to superadmins
3. Superadmin activates from Admin → Signups
4. Customer receives temp credentials + **welcome email** (auto-sent) with password change warning
5. Login → **onboarding Step 0** (set permanent password) → Step 1-5 (name, product, connection)
6. Settings → BC Installer → Download (auto-creates tunnel first time)
7. Run installer on Windows server as Administrator (port 9099)

---

## Brand & Messaging

- **Login tagline:** "Business Central & Microsoft NAV Intelligence Portal"
- **Signup tagline:** "CFO Intelligence for Business Central & Microsoft NAV"
- **Homepage hero:** "Your Business Central. One portal. Complete control."
- **Primary brand line:** "Bespoke AI. Built for the ERP Microsoft left behind."
- **Backgrounds:** White (`#ffffff`) throughout portal
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
- Dashboard: `?view=xxx` persists nav tab
- Unconnected users → default to `customisations` tab
