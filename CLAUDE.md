# BespoxAI Web Portal

Next.js (App Router) + Prisma/PostgreSQL + NextAuth + Stripe, deployed on Vercel.
Serves on-premises Dynamics NAV / Business Central customers, plus a white-label
partner portal. Owner: Rich Lancaster (C/AL developer, Windows/Git Bash).

**This is not a static site.** `public/index.html` is the marketing homepage;
everything else is the Next.js app.

Domains: `bespoxai.com` (main portal), `partners.bespoxai.com` (partner portal —
**plural**; the singular form does not exist).

---

## How to work with me

- **Design first, then build.** Agree scope and approach before writing code.
  Surface a decision only when it's genuinely ambiguous or has real trade-offs;
  otherwise proceed.
- **Once the design is agreed and checks pass, commit and push by default.**
  Don't ask for approval per commit. Batch low-risk changes into one commit.
- **Root cause before fix.** If a rule is wrong in one place, grep every surface
  before declaring it done. Symptom-patching one screen at a time has caused
  repeated regressions here.
- **Honest accounting.** Surface mistakes. Remove redundant code when patching.
  Prefer a thorough audit over a quick incremental patch.
- **Don't overscope.** Display changes and functional changes are different
  things; don't turn one into the other.

---

## Git

- Working copy is a normal clone at `C:\Dev\BespoxAI_Web`; local branch `main`
  tracks `origin/main`. **Push with plain `git push`.**
- Repo: `github.com/NavSolutionsNZ/BespoxAI_Web`
  (old name `BespokeAI_Web` still redirects — don't use it).
- Older notes in the context files say to push with `git push origin master:main`.
  That was correct for the previous sparse-checkout workflow, where the local
  branch was `master`. It does not apply here and will fail.
- Commit in logical slices with descriptive messages. Each slice should be green
  on Vercel before the next begins.

## Vercel verification

- Project `prj_AT4GXatATIi2FaUCS62Ttp2AivRo`, team `team_eZ4MqWjZdsPA2iWoK4exjjPF`.
- Auto-deploys on push to `main`, typically 60–90s.
- After pushing, wait ~90s then check the deployment. `READY` = green.
- Pull build logs on failure before theorising about the cause.

---

## Hard rules

### Database
- **Never run `prisma migrate` or `db push`.** Schema changes are SQL-first:
  Rich runs raw SQL in Vercel → Storage → Postgres → Query, then
  `prisma/schema.prisma` is updated manually to match.
- **`findUnique` only accepts unique, non-null fields.** Using it with a
  non-unique or nullable filter throws "needs at least one of id" at runtime and
  is often swallowed by a catch. Use `findFirst`. This has bitten us at least
  three times (Stripe webhook, `getTenantById`, `/api/health`).
- When mirroring a `create` across pipelines, check for **required FKs with no
  DB default** — e.g. `Requirement.assignedDeveloperId`. Missing one produces an
  empty-body 500.

### AI providers
- **Never import `@anthropic-ai/sdk`** (or instantiate `new OpenAI()` at module
  top level) in API routes. Use the provider-agnostic `fetch` pattern via
  `getAiConfig()`; the provider is switchable from the admin UI.

### SWC / JSX (strict — these are parse-time failures, not style preferences)
- Use `cond ? <JSX/> : null`, **not** `cond && <JSX/>`, in large function returns.
- **No template literals with `${vars}` in JSX** — use string concatenation.
  Same for inline styles and JSX text nodes.
- Define helpers and standalone sub-components **outside** the main component.
- `React.useState` fails in standalone functions — use destructured `useState`.
- A parse error in a large `.tsx` means a real JSX structural imbalance. It is
  not an SWC quirk. `tsc --noEmit` does **not** catch tag/fragment imbalance.
- Don't merge `BillingCharts` back into `SuperAdminDashboard` — it's extracted
  deliberately.

### Settings page inputs
- `app/settings/page.tsx` must use **refs + `defaultValue`**. Controlled inputs
  (`value`/`onChange`) cause constant re-renders and input-reset bugs.

### Navigation
- **Never `router.back()`** — always explicit `router.push()`.
- Tab changes use `router.push` (not `replace`) so history works.
- Settings always carries `?tab=` in the URL.

### BCAgent
- Edit `scripts/Install-BespoxAI.ps1` only — it contains the embedded agent code.
- **Bump the version in all three places** on every push: `$AgentVersion` and
  `$Version` in the PS1, and `AGENT_VERSION` in
  `app/api/settings/installer/route.ts`.
- Default agent port is **9099** (not 8080).
- BCAgent runs as the BC user account, never as SYSTEM.
- Use `HttpWebRequest`, not `HttpClient` (WinHTTP-backed NTLM).

### Other
- Address users by `preferredName ?? firstName` — never the full name.
- Unicode characters (`…`, `—`, `✓`) are written literally in JSX and string
  literals, not as `\u` escapes.
- Don't edit root `index.html` — edit `public/index.html`.
- Partner UI colours use the semantic `--rb-*` CSS vars, never hardcoded hex.
  The surface sets `data-rb-theme="dark|light"` on an ancestor.

---

## Context files

`BESPOXAI_PROJECT_SUMMARY.md`, `BESPOXAI_COMPONENT_ROADMAP.md`, and
`BESPOXAI_FILES_INVENTORY.md` at the repo root hold session history, the work
backlog, and the file map. **Read them for context; do not modify them** unless
explicitly told to — they're updated at session end on Rich's direction.

Shorthand labels (C2, C3, C5…) are defined in
`PARTNER_PIPELINE_PARITY_AUDIT.md`. Resolve them by reading that file.

---

## Known trap

`app/api/admin/requirements/route.ts` has a function named `superadminGuard`
that actually permits **both** `superadmin` and `developer`. The behaviour is
probably intentional; the name lies. Don't copy it into a new route assuming
superadmin-only, and don't "correct" it without checking callers.
`lib/api-auth.ts` holds honestly-named replacements (`requireUser`,
`requireSuperadmin`, `requireSuperadminOrDeveloper`, `requireTenant`) — it's
committed but dormant, being rolled out incrementally rather than big-bang.
