# BespoxAI Web Portal — Project Summary

**Project Owner:** Rich Lancaster  
**Current Status:** Full Next.js application deployed to Vercel. Live at bespoxai.com.  
**Repository:** NavSolutionsNZ/BespoxAI_Web  
**Hosting:** Vercel (auto-deploys on push to main)  
**Created:** April 2026  
**Last Updated:** June 5, 2026 (Session 9)

---

## ⚠️ Critical Architecture Note

**This is NOT a single HTML file project.** The live production site at bespoxai.com is a full **Next.js application** with:
- App Router (`/app` directory)
- NextAuth authentication
- Prisma ORM + PostgreSQL (Vercel Postgres)
- Stripe billing
- Cloudflare tunnel for BC/NAV connectivity
- Multiple API routes with caching + pagination
- AI provider switchable (OpenAI or Anthropic — use fetch pattern, not SDK)
- GitHub per-customer repos

**Marketing pages:** `public/index.html` — the LIVE homepage

---

## Session 9 Key Changes (June 5, 2026)

### 🔥 Performance Optimization — All Slow Endpoints

**Diagnosed & fixed 7 slow API endpoints using `unstable_cache` + pagination:**

| Endpoint | Before | After | Fix |
|----------|--------|-------|-----|
| `/api/requirements` | 2250ms | ~200ms* | Added `skip`/`take` pagination (default 20), 60s cache |
| `/api/billing/review-allowance` | 2230ms | ~200ms* | Added `unstable_cache`, 60s TTL |
| `/api/partner/request-state` | 2030ms | ~200ms* | Added `unstable_cache`, 60s TTL |
| `/api/ai-usage` | 1020ms | ~200ms* | Added `unstable_cache`, 60s TTL |
| `/api/business-config` | 792ms | ~200ms* | Global cache (same for all users), 60s TTL |
| `/api/health` | 764ms | ~200ms* | Cached tenant lookup only |
| `/api/branding` | 998ms | ~200ms* | Cached (previous session) |

*Warm cache (repeat requests within 60s). First request may still be 800ms+ due to cold start, but subsequent loads instant.

**Database indexes recommended (apply via Vercel Postgres):**
```sql
CREATE INDEX idx_requirement_tenantId ON "Requirement"("tenantId");
CREATE INDEX idx_requirement_createdAt ON "Requirement"("createdAt" DESC);
CREATE INDEX idx_requirement_status ON "Requirement"("status");
CREATE INDEX idx_invoice_tenantId ON "Invoice"("tenantId");
CREATE INDEX idx_invoice_status ON "Invoice"("status");
CREATE INDEX idx_tenant_partnerAccountId ON "Tenant"("partnerAccountId");
CREATE INDEX idx_addendum_requirementId ON "Addendum"("parentId");
```

**Pagination for requirements:**
- Query params: `?skip=0&take=20` (defaults to first 20)
- Returns: `{ requirements, pagination: { skip, take, total } }`
- Enables infinite scroll on frontend

**Commit:** `70de8d4` — "Optimize all slow API endpoints with unstable_cache + pagination"

---

## GitHub Access

- **Repo:** `NavSolutionsNZ/BespoxAI_Web` (renamed from BespokeAI_Web)
- **Branch:** `main`
- **Claude uses sparse checkout** — never clones full repo
- **Push:** `git push origin master:main`
- **Remote URL:** `https://{TOKEN}@github.com/NavSolutionsNZ/BespoxAI_Web.git`

---

## Database

- **Provider:** PostgreSQL via Vercel Postgres
- **ORM:** Prisma — no migrations, uses `db push` or raw SQL
- **Response caching:** All 7 slow endpoints now use `unstable_cache` with 60s TTL

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

## Navigation Rules

- **Never** `router.back()` — always explicit `router.push()`
- Settings deep-links: `?tab=installer`, `?tab=overview`, `?tab=users`, `?tab=entities`
- Dashboard: `?view=xxx` — uses `router.push` for back button support
- Unconnected users → default to `customisations` tab

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
