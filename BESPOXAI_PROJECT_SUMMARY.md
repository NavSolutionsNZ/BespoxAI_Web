# BespoxAI Web Portal — Project Summary

**Project Owner:** Rich Lancaster (richard.lancaster — Windows/MINGW64 environment)
**Current Status:** Full Next.js application deployed to Vercel. Live at bespoxai.com.
**Repository:** NavSolutionsNZ/BespokeAI_Web (GitHub)
**Hosting:** Vercel (auto-deploys on push to main)
**Created:** April 2026
**Last Updated:** May 23, 2026 (Session 4)

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

## Session 4 Key Changes (May 24, 2026)

### C/AL Export Pipeline — Fully Working
- End-to-end tested on GWM: fetch → parse → GitHub repo → object push ✅
- finsql.exe used directly (Export-NAVApplicationObject removed in BC14)
- BC14 path: `C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\140\RoleTailored Client\finsql.exe`
- finsql writes ANSI/ASCII (no BOM) — read with `Get-Content -Raw`
- Objects grouped by type: one finsql launch per type (Type=Table;ID=27|37)
- id=BespoxAI prevents ZUP file conflicts on multi-instance servers
- navDatabaseServer must be real SQL Server IP (GWM: 10.24.244.19, not localhost)

### Installer Fixes
- Scheduled task: SYSTEM first + schtasks.exe /change for domain accounts
- Register-ScheduledTask -User fails with domain SIDs in BAT RunAs context
- Write-Log/Write-OK/BCUser/BCPass scope issues all resolved
- bcUsername saved to Tenant on installer download (pre-fills form)
- Uninstaller port check: netstat instead of blocking TcpClient

### Portal Fixes
- New Request button: showCreate added to left panel hide condition
- BC/NAV labels: erpLabel derived from navProduct throughout portal
- navProduct passed as string (not boolean) through JWT/session
- bcConnected now actually passed to RequirementsBuilder
- Entity discovery: $metadata URL fixed (no Company() segment)
- Tenant interface in settings/page.tsx: bcUsername field added

### GWM Server Details (for reference)
- NAV version: BC14 (Microsoft Dynamics 365 Business Central 140)
- SQL Server: 10.24.244.19
- Database: GWM_Dev_DB
- BC instance: GWM_Dev
- NavModelTools: C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\140\RoleTailored Client\NavModelTools.ps1
- NavAdminTool: C:\Program Files\Microsoft Dynamics 365 Business Central\140\Service\NavAdminTool.ps1
- CustomSettings.config: C:\Program Files\Microsoft Dynamics 365 Business Central\140\Service\Instances\GWM_Dev\CustomSettings.config


---

## Database

- **Provider:** PostgreSQL via Vercel Postgres
- **ORM:** Prisma — no migrations, uses `db push` or raw SQL
- **Never run** `prisma migrate`

### Known Test IDs
- **TestCo1 Tenant ID:** `cmpgqbg8l0001tqej9wpqsx6g` (tunnelSubdomain: testco1, agentPort: 9099)
- **GWM Dev Tenant ID:** `cmoqi33pu0000l3b0zusc5hgz` (tunnelSubdomain: gwmdev — NOT the test tenant)
- **Test Requirement ID:** `cmpdstipk0001tzkg2oq6zlrs`

### Key Schema Changes (Session 3)
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

## BCAgent — Session 4 Changes (CRITICAL)

- **Version: 2.4** — fully tested and working end-to-end
- **Default port: 9099** everywhere
- **Scheduled task runs as BC user account** (not SYSTEM) — required for NTLM/Kerberos auth to BC OData
- **UseDefaultCredentials = true** in HttpWebRequest — uses Windows token like browser SSO
- **HttpWebRequest** (not HttpClient) — HttpClient has NTLM handshake issues on Windows Server
- **No Add-Type System.Net.Http** — HttpWebRequest uses native WinHTTP, no assembly load needed
- **--protocol http2** on cloudflared service — QUIC/UDP blocked for SYSTEM account in corporate networks
- **Service recovery** configured — auto-restart cloudflared on failure (5s/10s/30s)
- **Cloudflared event log registry key** cleaned up on install and uninstall
- **Uninstall-BespoxAI.bat** — right-click Run as Administrator shim for the PS1 uninstaller

### BCAgent Architecture
```
Portal (Vercel) → https://{subdomain}-agent.bespoxai.com (Cloudflare tunnel)
  → cloudflared (Windows service, --protocol http2, runs as SYSTEM)
  → localhost:9099 (BCAgent scheduled task, runs as BC user account)
  → localhost:8048 (BC/NAV OData, NTLM via UseDefaultCredentials)
```

### Why BCAgent runs as BC user (not SYSTEM)
SYSTEM cannot authenticate to BC OData via NTLM/Kerberos with explicit credentials on loopback.
Running as the BC user (e.g. incadea\9lancasterr) allows UseDefaultCredentials=true to use the
Windows token — same mechanism as browser SSO. Password stored in agent.config.json and
Windows Task Scheduler credential store.

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
The router uses `__BAD_QUERY__` entries from QueryLog to steer away from known-bad queries.
If CFO assistant routes everything as generic, check for stale bad query entries:
```sql
DELETE FROM "QueryLog" WHERE "tenantId" = '{tenantId}' AND entity = '__BAD_QUERY__';
```

---

## Customer Onboarding Flow

1. Sign up → select BC or NAV version → verify email
2. Email triggers `notifyAdminsSignupVerified` to superadmins
3. Superadmin activates from Admin → Signups
4. Customer receives temp credentials
5. Login → onboarding (name fields, BC connection details)
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

## Key Commits (Session 4 — May 23, 2026)

| Area | Description |
|------|-------------|
| BCAgent installer | NativeCommandError fix (ErrorActionPreference around cloudflared install) |
| BCAgent installer | Stale Cloudflared event log registry key cleanup |
| BCAgent installer | Add-Type System.Net.Http removed (HttpWebRequest uses WinHTTP natively) |
| BCAgent installer | HttpClient → HttpWebRequest for NTLM (HttpClient breaks NTLM on Windows Server) |
| BCAgent installer | Scheduled task runs as BC user (not SYSTEM) — fixes NTLM loopback auth |
| BCAgent installer | UseDefaultCredentials=true — Windows token auth like browser SSO |
| BCAgent installer | --protocol http2 on cloudflared service (QUIC/UDP blocked on SYSTEM account) |
| BCAgent installer | cloudflared service auto-restart on failure |
| BCAgent installer | NTLM domain\username split (superseded by UseDefaultCredentials) |
| Uninstaller | Registry key cleanup, Uninstall-BespoxAI.bat right-click Run as Admin shim |
| lib/tenants.ts | agentPort fallback 8080 → 9099 |
| app/api/query/route.ts | jsonMode:true on router + planner callAI (gpt-4o prose fix) |

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
