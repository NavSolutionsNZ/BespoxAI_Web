# BespoxAI Web Portal — Project Summary

**Project Owner:** Rich Lancaster (richard.lancaster — Windows/MINGW64 environment)
**Current Status:** Full Next.js application deployed to Vercel. Live at bespoxai.com.
**Repository:** NavSolutionsNZ/BespokeAI_Web (GitHub)
**Hosting:** Vercel (auto-deploys on push to main)
**Created:** April 2026
**Last Updated:** May 25, 2026 (Session 6)

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
- **Claude uses sparse checkout** — never clones the full repo. Include `"prisma"` in set.
- **api.github.com is blocked** — but `github.com` git operations work
- **Push:** `git push origin master:main`

---

## Session 6 Key Changes (May 25, 2026)

### Deploy to Test — ✅ NOW WORKING
Full end-to-end deploy + compile to test environment is working on GWM Dev.

Fixes applied this session to get it working:
- **testNavDatabaseName not reaching agent** — installer route was overwriting DB value with body default on every download. Fixed: installer route now uses tenant DB values directly for all PS1 replace calls, and does NOT save test env fields (managed by settings PATCH only)
- **NonInteractive mode error** on Import-NAVApplicationObject — fixed with `-Confirm:$false`
- **$NavIde not set** — NavModelTools.ps1 requires `$NavIde = path to finsql.exe`. Fixed: wildcard search for finsql.exe assigned to `$NavIde` before dot-sourcing NavModelTools
- **Compile-NAVApplicationObject** needing `-NavServerInstance` and `-NavServerManagementPort` — fixed with environment-specific `$mgmtPort` variable
- **testNavServerInstance empty** — `testBcInstance` used as fallback in compile when `testNavServerInstance` not set
- **Response write crash on dropped connection** — wrapped in try-catch

### Sync Config to Agent (new feature)
- New BCAgent endpoint: `POST /bespoxai/update-config` — writes agent.config.json + updates in-memory vars immediately (no restart needed)
- New API route: `POST /api/settings/sync-config`
- UI: "↑ Sync Config to Agent" button in Settings → BC Installer tab
- Logs only changed fields (field: old → new value), or "no changes detected"
- Does not sync bcPassword/bcUsername

### New Config Fields — Production + Test Management Ports
- `navManagementPort` — production NAV server management port for compile schema sync
- `testNavManagementPort` — test NAV server management port
- Both added to: DB schema, settings API, ProdEnvForm/TestEnvForm UI, installer PS1 params, agent.config.json, BCAgent compile params, sync-config payload, update-config endpoint
- `testNavServerInstance` now has explicit UI field in TestEnvForm

### Installer — Major Improvements
- All PS1 replace calls now use `tenant` DB object directly (not body values)
- Test env fields no longer saved from installer route (prevented overwriting saved values)
- agent.config.json now includes `bcPort`, `agentPort`, and correct `bcBaseUrl` with instance path
- Version shown on Download Installer button — fetched dynamically from `GET /api/settings/installer`
- Installer banner shows all production AND test env fields at startup
- BAT/ZIP filename includes version: `Install-BespoxAI-v2.9-{tenant}.zip`

### Installer — Auto-Stop on Reinstall
- No uninstall needed before reinstalling
- Stops existing BespoxAI-BCAgent scheduled task (regardless of state)
- Uses `netstat -ano` to find PID on port
- Verifies process `Win32_Process.CommandLine` contains `BCAgent.ps1` before killing (safe — won't kill other processes)
- Waits up to 5s for port to free
- Only warns if port still in use by something that isn't BCAgent

### BCAgent Version
- Bumped to **v2.9** this session (was v2.4 at start)
- **Version must be bumped on every push** — two places: `$AgentVersion`/`$Version` in Install-BespoxAI.ps1, `AGENT_VERSION` in installer/route.ts
- Will reset at go-live

### schema.prisma — Now Actively Maintained
- Added `navManagementPort Int? @default(7045)` to Tenant
- Added `testNavManagementPort Int? @default(7045)` to Tenant
- Added `mustChangePassword Boolean @default(false)` to User (was in DB via SQL but not in schema)
- Include `"prisma"` in sparse checkout from now on

### Process Note (CRITICAL — reinforced this session)
- **Never push without explicit confirmation from Rich**
- **Diagnose before architecting** — always ask for logs/errors first
- **Discuss significant changes** before implementing

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

### Schema Changes — Session 6
```sql
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "testNavManagementPort" INTEGER NOT NULL DEFAULT 7045;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "navManagementPort" INTEGER NOT NULL DEFAULT 7045;
```
Both applied ✅. prisma/schema.prisma updated ✅.

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

## BCAgent — Session 6 Changes (CRITICAL)

- **Version: 2.9**
- Installer auto-stop on reinstall (netstat + CommandLine check)
- Sync Config endpoint: POST /bespoxai/update-config
- Deploy compile uses environment-specific mgmtPort ($NavMgmtPort vs $TestNavMgmtPort)
- agent.config.json now includes bcPort, agentPort, full bcBaseUrl with instance
- All PS1 installer replace strings verified against actual PS1 param declarations

### BCAgent Architecture
```
Portal (Vercel) → https://{subdomain}-agent.bespoxai.com (Cloudflare tunnel)
  → cloudflared (Windows service, --protocol http2, runs as SYSTEM)
  → localhost:9099 (BCAgent scheduled task, runs as BC user account)
  → localhost:8048/{bcInstance} (BC/NAV OData, NTLM via UseDefaultCredentials)
```

### Known NAV v14 OData Limitations
- `$orderby=Posting_Date desc` NOT supported on GeneralLedgerEntry, SalesInvoice
- `$filter` on Posting_Date NOT supported on posted documents
- `$apply`, `groupby`, `aggregate()` NOT supported

---

## CFO Assistant Query Pipeline

1. **Router** (jsonMode:true) — classify needsData
2. **Planner** (jsonMode:true) — pick entity + OData params
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
4. Customer receives temp credentials + welcome email with password change warning
5. Login → onboarding Step 0 (set permanent password) → Step 1-5 (name, product, connection)
6. Settings → BC Installer → Download (auto-creates tunnel first time)
7. Run installer on Windows server as Administrator (port 9099) — no uninstall needed for reinstall

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
