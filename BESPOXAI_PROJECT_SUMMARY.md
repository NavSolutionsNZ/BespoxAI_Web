# BespoxAI Web Portal — Project Summary

**Project Owner:** Rich Lancaster (richard.lancaster — Windows/MINGW64 environment)
**Current Status:** Full Next.js application deployed to Vercel. Live at bespoxai.com.
**Repository:** NavSolutionsNZ/BespokeAI_Web (GitHub)
**Hosting:** Vercel (auto-deploys on push to main)
**Created:** April 2026
**Last Updated:** May 23, 2026 (Session 3)

---

## ⚠️ Critical Architecture Note

**This is NOT a single HTML file project.** The live production site at bespoxai.com is a full **Next.js application** with:
- App Router (`/app` directory)
- NextAuth authentication
- Prisma ORM + PostgreSQL (Vercel Postgres)
- Stripe billing
- Cloudflare tunnel for BC/NAV connectivity
- Multiple API routes
- Anthropic Claude API (provider switchable — use fetch pattern, not SDK)
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

## Database

- **Provider:** PostgreSQL via Vercel Postgres
- **ORM:** Prisma — no migrations, uses `db push` or raw SQL
- **Never run** `prisma migrate`

### Known Test IDs
- **Tenant ID:** `cmoqi33pu0000l3b0zusc5hgz`
- **Test Requirement ID:** `cmpdstipk0001tzkg2oq6zlrs`

### Key Schema Changes (Session 3)
```sql
-- Run these if not already applied:
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preferredName" TEXT;
```

---

## Settings Page — CRITICAL Input Pattern

**All form inputs in `app/settings/page.tsx` use refs + defaultValue.**

This was the fix for a persistent input-reset bug. Never use controlled inputs (value/onChange) in this file.

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

## BCAgent — Session 3 Changes

- **Default port: 9099** everywhere (was 8080)
- **Version: 2.4**
- **Uninstaller:** `scripts/Uninstall-BespoxAI.ps1` — run before reinstall
- **Auto-tunnel:** First installer download creates Cloudflare tunnel automatically

---

## Customer Onboarding Flow (NEW Session 3)

1. Sign up → select BC or NAV version → verify email
2. Email triggers `notifyAdminsSignupVerified` to superadmins
3. Superadmin activates from Admin → Signups
4. Customer receives temp credentials
5. Login → onboarding (name fields, BC connection details)
6. Settings → BC Installer → Download (auto-creates tunnel first time)
7. Run installer on Windows server (port 9099)

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

## Key Commits (Session 3 — May 23, 2026)

| Area | Description |
|------|-------------|
| BCAgent | Port 9099, bug fixes (requirementId in export, version stamps) |
| Uninstaller | New script, HTTP.sys handling, pure ASCII |
| Installer | Auto-provision tunnel on first download |
| Signup/Verify | NAV versions, verify useEffect fix, notification to admins |
| Onboarding | Name fields, full BC connection fields, step 5 CTA |
| Settings | White backgrounds, profile card, refs pattern fix, test env simplified |
| Dashboard | White bg, unconnected banner with links, greeting logic |
| Login | White bg, updated branding, request access top-right |
| Admin | Signups cleanup (delete, hide activated), users table full width |
| User model | firstName, lastName, preferredName fields |
| Port | 9099 default everywhere |

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
