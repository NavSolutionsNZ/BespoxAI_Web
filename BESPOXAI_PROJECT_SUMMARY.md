# BespoxAI Web Portal — Project Summary

**Project Owner:** Rich Lancaster (richard.lancaster — Windows/MINGW64 environment)
**Current Status:** Full Next.js application deployed to Vercel. Live at bespoxai.com.
**Repository:** NavSolutionsNZ/BespokeAI_Web (GitHub)
**Hosting:** Vercel (auto-deploys on push to main)
**Created:** April 2026
**Last Updated:** May 22, 2026 (Session 2)

---

## ⚠️ Critical Architecture Note

**This is NOT a single HTML file project.** The live production site at bespoxai.com is a full **Next.js application** with:
- App Router (`/app` directory)
- NextAuth authentication
- Prisma ORM + PostgreSQL database (hosted on Vercel Postgres)
- Stripe billing integration
- Cloudflare tunnel for BC/NAV connectivity (BCAgent on customer Windows Server)
- Multiple API routes
- Anthropic Claude API for AI features (provider switchable — use fetch pattern, not SDK import)
- GitHub per-customer repos (`lib/github.ts`) — PAT stored as `GITHUB_CUSTOMER_REPOS_TOKEN`

**Marketing pages:**
- `public/index.html` — the LIVE homepage (not root `index.html` — that one is outdated)

---

## GitHub Access (Critical — Read First)

- **Repo:** `NavSolutionsNZ/BespokeAI_Web`
- **Branch:** `main`
- **Claude uses sparse checkout** — never clones the full repo
- **api.github.com is blocked** from the sandbox — but `github.com` git operations work fine
- **Never guess the username** — it is always `NavSolutionsNZ`
- **Note:** Remote may show redirect message to `BespoxAI_Web` (capital B) — push still works

### Efficient Git Workflow (sparse checkout — use every session)
```bash
cd /home/claude
git init repo && cd repo
git remote add origin https://{TOKEN}@github.com/NavSolutionsNZ/BespokeAI_Web.git
git sparse-checkout init
git sparse-checkout set --no-cone \
  "components/RequirementsBuilder.tsx" \
  "app/admin/**" \
  "lib/**"
git pull origin main
git config user.email "claude@anthropic.com"
git config user.name "Claude"
```

**Push always uses:** `git push origin master:main`

New files outside sparse area need `git add --sparse <file>` before regular add.

---

## Database

- **Provider:** PostgreSQL via Vercel Postgres
- **ORM:** Prisma (`prisma/schema.prisma`) — no migrations folder, uses `db push`
- **Schema changes:** Run SQL via Vercel Dashboard → Storage → Postgres → Query
- **Pattern:** `ALTER TABLE "ModelName" ADD COLUMN IF NOT EXISTS "columnName" TYPE;`
- **Never run** `prisma migrate` — always `db push` or raw SQL

### Known Tenant/Requirement IDs (test data)
- **Tenant ID:** `cmoqi33pu0000l3b0zusc5hgz`
- **Test Requirement ID:** `cmpdstipk0001tzkg2oq6zlrs`

### Key Schema Models
- `User.role` — `"superadmin" | "tenant_admin" | "user" | "developer"`
- `Requirement.assignedDeveloperId` — nullable; null = visible to all developers
- `Requirement.githubBranch` — branch name e.g. `req/abc123-shopify`
- `Requirement.parentId` — nullable; set on addenda to link to parent requirement
- `Requirement.prodApprovalSentAt` — when go-live doc emailed to customer
- `Requirement.prodGoLiveDoc` — AI-generated go-live document text
- `Requirement.prodApprovedAt` — when customer approved go-live
- `Requirement.prodApprovedById` — userId who approved
- `Requirement.prodDeployedAt` — when BCAgent prod deploy completed
- `Requirement.prodDeploySnapshotId` — BCAgent snapshot used for prod deploy
- `Tenant.githubOrg` / `Tenant.githubRepo` — per-customer GitHub repo
- `Tenant.testServerSeparate` — boolean; true = separate Windows Server for test env
- `Tenant.testAgentUrl` — URL of BCAgent on separate test server
- `Tenant.testTunnelToken` — Cloudflare tunnel token for test server
- `Tenant.testAgentPort` — BCAgent listening port on test server
- `Tenant.stripeCustomerId` — used for subscription→tenant matching in revenue charts
- `TenantObjectFile.content` — full C/AL source text (TEXT field)
- `TenantObjectFile.summary` — `{fields[], procedures[], versionList, sizeBytes, ...}`

---

## Brand & Messaging

### Taglines
- **Homepage hero:** "Your Business Central. One portal. Complete control."
- **Invoice tagline:** "Your Business Central. One portal. Complete control."
- **Primary brand line:** "Bespoke AI. Built for the ERP Microsoft left behind."

### Color Scheme
- Gold/amber: `rgba(200,149,42,0.06)` bg / `rgba(200,149,42,0.25)` border / `var(--amber)` text
- Forest/green: `rgba(10,92,70,0.06)` bg / `rgba(10,92,70,0.25)` border / `var(--forest)` text
- Used for: Production Environment card (gold), Test Environment card (green)

---

## Business Context

### Plans & Pricing (all excl. GST — 15% GST added at checkout)
| Plan | Price | AI Tokens/month |
|------|-------|-----------------|
| Free / Trial | Free | 50,000 |
| Starter | $59/mo | 50,000 |
| Assistant | $299/mo | 300,000 |
| Manager | $499/mo | 750,000 |
| Executive | $999/mo | 3,000,000 |
| Specification Review | $249 one-time | — |

### Payment Terms (per tenant)
| Key | Label | Behaviour |
|-----|-------|-----------|
| terms1 | Standard | 20% deposit + 80% on completion |
| terms2 | Deposit + Monthly | 20% deposit + balance 20th following month |
| terms3 | Account | No deposit, full amount 20th following month |

---

## Application Architecture (Next.js)

### Key Directories
```
BespokeAI_Web/
├── app/
│   ├── dashboard/page.tsx      ← ?view=xxx URL param; back → /dashboard
│   ├── billing/page.tsx        ← back → /dashboard
│   ├── settings/page.tsx       ← back → /dashboard
│   ├── admin/page.tsx          ← URL syncs req: ?tab=requirements&req={id}
│   │                              DeployToProductionPanel, DeployToTestPanel
│   │                              renderMdLight for consultant note
│   ├── api/
│   │   ├── requirements/[id]/
│   │   │   ├── prod-approval/route.ts   ← AI go-live doc, provider-agnostic fetch
│   │   │   ├── prod-approve/route.ts    ← customer approves go-live
│   │   │   ├── coding-assistant/route.ts
│   │   │   ├── coding-assistant/commit/
│   │   │   ├── addendum/route.ts
│   │   │   ├── dev-plan/
│   │   │   ├── objects/route.ts
│   │   │   ├── objects/deploy-test/
│   │   │   ├── objects/deploy-prod/route.ts  ← BCAgent prod deploy
│   │   │   └── ...
│   │   └── ...
├── components/
│   ├── RequirementsBuilder.tsx ← URL sync, renderMdLight, Documents section
│   │                              selectReq()/clearReq() for navigation
│   │                              customer list: quote hidden, badges cleaned
│   └── SuperAdminDashboard.tsx ← BillingCharts sub-component (SWC)
├── lib/
│   ├── notifications.ts        ← + prod deployment notifications
│   ├── tenant-context.ts
│   ├── github.ts
│   └── ...
├── prisma/schema.prisma
└── public/index.html           ← LIVE marketing homepage
```

### Dashboard NavItems (valid values ONLY)
```
assistant | health | customisations | cashflow | monthend | migration
```
**Never use `view=requirements`.**

---

## AI System

### Provider-Agnostic Pattern (CRITICAL)
Never import `@anthropic-ai/sdk` in API routes. Always use the fetch pattern:
```typescript
const cfg = await getAiConfig()
const apiKey = cfg.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
if (cfg.provider === 'anthropic') {
  fetch('https://api.anthropic.com/v1/messages', { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, ... })
} else {
  fetch('https://api.openai.com/v1/chat/completions', { headers: { 'Authorization': 'Bearer ' + apiKey }, ... })
}
```

### Coding Assistant (`api/requirements/[id]/coding-assistant/`)
- Loads all C/AL files from the requirement's GitHub branch into AI context
- Streams conversational response — developer describes changes, AI writes complete objects
- Commit endpoint pushes accepted C/AL back to the branch
- Auto-detects OBJECT blocks in AI response — shows "↑ Commit to Branch" per object
- Visible in admin for `in_development` requirements with a `githubBranch`

### Dev Assistant (`api/requirements/[id]/dev-notes/`)
- Ghostwriter framing — AI writes AS the admin, never addresses them
- Output may be shown directly to customer — no internal/justification language
- Consultant note renders with `renderMdLight` in both admin and customer views

### Production Deployment Flow (Phase 2 — NEW)
1. UAT approved → `DeployToProductionPanel` appears in admin (amber border)
2. Admin clicks "Generate & Send Go-Live Doc" → AI generates plain-English summary → saved to `prodGoLiveDoc` → emailed to customer
3. Customer sees go-live doc in portal → clicks "Approve Go-Live" → sets `prodApprovedAt` → notifies superadmins
4. Admin clicks "Deploy to Production" → confirm gate → calls BCAgent `/bespoxai/objects/deploy` with `environment: "production"` → sets `prodDeployedAt` → emails customer "live"
5. Customer can download go-live doc from Documents section for audit records

---

## Navigation & Back Button (FIXED Session 2)

**Rule:** Never use `router.back()` anywhere in the app. Always use explicit routes.

| Page | Back button destination |
|------|------------------------|
| Admin sidebar "← CFO Assistant" | `router.push('/dashboard')` |
| Settings sidebar | `router.push('/dashboard')` |
| Billing header | `router.push('/dashboard')` |

**Admin requirement URL sync:**
- Selecting a requirement → `?tab=requirements&req={id}`
- Deselecting → `?tab=requirements`
- `useEffect` syncs from URL on back/forward navigation
- Deep-linking to `/admin?tab=requirements&req={id}` works on load

**Customer portal (RequirementsBuilder) URL sync:**
- `selectReq(req)` → pushes `?req={id}`
- `clearReq()` → removes `?req` param
- `useEffect` syncs on back/forward + deep links

---

## Markdown Rendering

Two functions — choose based on background:

| Function | Location | Use for |
|----------|----------|---------|
| `renderMd` + `mdInline` | `app/admin/page.tsx` | Dark backgrounds (dev assistant panel) |
| `renderMdLight` + `mdInlineLight` | `app/admin/page.tsx` + `components/RequirementsBuilder.tsx` | Light/cream backgrounds (consultant note, customer quote card) |

Numbered items: `textAlign: right` on number span, `alignItems: baseline`. Dash sub-items: `paddingLeft: 20`.

---

## Customer List — What's Visible

Customers see in the list:
- Status badge
- BC Area
- Action-required indicators (step 1: generate spec, review fee required, etc.)
- Review paid/included/waived badges — **only while status ≤ deposit_required** (hidden after)

Customers do NOT see in the list:
- Quote amount (superadmin only)
- `✦ spec` indicator
- `? Nq` question count

---

## Addendum Flow

- Customer can add addenda to `deposit_paid` or `in_development` requirements only
- Addenda start as `draft` — customer generates spec, refines, then clicks "Submit Addendum for Review →"
- No $249 review fee for addenda — goes straight to admin review
- `Requirement.parentId` links addendum to parent
- Admin sees addenda in flat requirements list (amber "Addendum" badge) and in parent detail panel
- Customer sees addenda nested under parent with clickable cards; "← Back to original requirement" link in detail

---

## Email Notifications (`lib/notifications.ts`)

All fire-and-forget. Triggers:

**→ Superadmin notified:**
- Customer submits requirement (incl. addenda)
- Customer answers clarification
- Customer rejects quote
- Customer pays deposit (Stripe webhook)
- UAT approved / rejected
- Customer approves go-live doc (`notifyAdminsProdApproved`) ← NEW

**→ Customer notified:**
- Admin sends clarification
- Admin sends quote
- Admin starts development
- Admin marks complete / requests balance
- Go-live doc sent for approval (`notifyCustomerProdApproval`) ← NEW
- Production deployment complete (`notifyCustomerProdDeployed`) ← NEW

---

## BCAgent Architecture

### Version v2.4 (current)
PowerShell HttpListener service. All config injected at install time.

**Endpoints:**
| Endpoint | Method | Purpose |
|---|---|---|
| `/bespoxai/objects/export` | POST | Export C/AL objects as zip → `C:\BespoxAI\Regression\` |
| `/bespoxai/objects/write` | POST | Write deployment files → `C:\BespoxAI\Deployments\` |
| `/bespoxai/objects/deploy` | POST | Import + compile. `environment: "test"\|"production"` |
| `/bespoxai/objects/snapshots` | GET | List all snapshots |
| `/bespoxai/objects/cleanup` | POST | Delete regression/deployment folders |

**Note:** Production deployment uses the existing `/deploy` endpoint with `environment: "production"`. No BCAgent changes required for Phase 2. Scheduling (Task Scheduler + `/schedule` endpoint) is deferred.

---

## Developer Role

- Role value: `"developer"`
- Can access admin requirements tab (filtered to unassigned + assigned to them)
- Cannot access: tenant management, billing, AI config, business settings
- Assigned per-requirement via dropdown in requirement detail header (superadmin only)
- `assignedDeveloperId` nullable — null means visible to all developers

---

## Key Commits (Session 2 — May 22, 2026)
| Commit | Description |
|--------|-------------|
| `e759624` | Phase 2: Production deployment — go-live doc, customer approval, prod deploy |
| `ab10d11` | Fix prod-approval: remove SDK import, use provider-agnostic fetch |
| `3c948cd` | Fix type error: ProdDeployPanelProps uses AdminReq not Requirement |
| `5906b28` | Fix: use useState directly in DeployToProductionPanel |
| `d5adec7` | Admin: URL updates when viewing requirement, back button works |
| `5ec6803` | Fix back button across entire app |
| `cf6b333` | Fix consultant note markdown rendering on cream background |
| `56fcc3f` | Fix consultant note: indent dash bullets |
| `4521f1f` | Fix markdown in both admin and customer views (alignment + colors) |
| `82b649f` | Customer UX: hide quote in list, clean badges, Documents section |
| `5d4b31e` | Hide internal list badges from customers (spec, ?Nq) |
| `07f6233` | Fix empty state: loading message while fetching |

---

## Preferred Working Style

1. Rich provides GitHub PAT at session start
2. Claude uses **sparse checkout** — never full clone
3. **Check imports before pushing** — TypeScript errors from missing imports waste deploy cycles
4. Use Python `content.replace(old, new, 1)` for tricky replacements — not `str_replace` when strings repeat
5. Write replacements to `/tmp/fix_xxx.py` files — never heredocs
6. `git config user.email "claude@anthropic.com" && git config user.name "Claude"` before every commit
7. Push with `git push origin master:main`
8. Vercel auto-deploys in ~30–60s
9. DB changes: run SQL in Vercel → Storage → Postgres → Query, then update `prisma/schema.prisma`
10. Update context files at end of session

### SWC/JSX Rules (critical — enforce strictly)
- Use `cond ? <JSX/> : null` NOT `cond && <JSX/>` in large function returns
- Wrap keyword-like text in JSX: `{'text: $'+val}` not `text: ${val}`
- No template literals with `${vars}` in JSX — use string concatenation
- No template literals in JSX text nodes between tags
- Variables defined inside a child component are NOT in scope in parent JSX
- After any insertion: check for duplicated blocks
- **Large components hitting SWC limits:** extract sub-sections as separate named functions OUTSIDE the main component
- Self-closing divs `<div ... />` count as opens in grep — use Python depth tracing to debug structure issues
- `React.useState` fails in standalone functions — use destructured `useState` from import
- Never import `@anthropic-ai/sdk` — use provider-agnostic fetch pattern
