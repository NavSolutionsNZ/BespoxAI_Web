# Partner Pipeline Parity Audit
**Question:** Can a partner (as deliverer) and their customer fully run the requirement lifecycle, each in their role, the same way BespoxAI (deliverer) and a direct customer can?

**Short answer:** No — the *status-transition* spine is mirrored (Session 22), and the *AI panels* are mirrored (Session 23), but several **capabilities attached to the lifecycle are missing on the partner side**. Below is the full map.

**Update (S26):** C1 (S25), **C2 (partner mark-unable — already built; audit line was stale)**, and **C4 (objects + deploy pipeline — built S26)** are now RESOLVED. Remaining open: **C3** (addendum) and **C5** (prod go-live approval). C5 pairs directly with C4 — it sets `prodApprovedAt`, which is the gate the partner prod-deploy step waits on.

Legend: ✅ present · ❌ missing · ➖ N/A by design

---

## A. Customer-side capabilities (the partner's CUSTOMER vs a direct customer)

| Capability | Direct customer | Partner customer | Notes |
|---|---|---|---|
| Create requirement | ✅ | ✅ | |
| Edit draft (title/desc/area/priority) before submit | ✅ | ✅ | Bug 4 (S22) |
| Submit / resubmit | ✅ | ✅ | partner PATCH |
| Answer "needs clarification" | ✅ | ✅ | customerAnswers |
| Approve quote → deposit_required | ✅ | ✅ | |
| Reject quote | ✅ | ✅ | |
| Pay deposit | ✅ Stripe (`pay-deposit`) | ➖ manual mark by partner | partner pipeline = manual payments, by design |
| UAT approve | ✅ | ✅ | S22 |
| UAT reject (scope-creep AI) | ✅ | ✅ | S22 |
| Pay balance | ✅ Stripe (`pay-balance`) | ➖ manual mark by partner | by design |
| **See dev assignment / reassign** | ✅ FIXED (S25) — internal staff only; customers never | ✅ FIXED (S25) — partner_admin assigns own staff; customer never | **RESOLVED `408876c`/`7415e45`** |
| Prod go-live approval (`prod-approve`) | ✅ customer approves go-live | ❓ **UNVERIFIED** | see C5 |

**Customer leak — RESOLVED (S25):** `RequirementsBuilder.tsx` "Assigned to"/Reassign now gated `superadmin||developer` only; `/assign` superadmin-only + rejects partner tenants; `/mark-unable` assigned-dev-or-superadmin + rejects partner tenants. Partner assignment lives in the partner requirement PATCH (partner_admin, own staff).

---

## B. Deliverer-side capabilities (PARTNER as deliverer vs BESPOXAI as deliverer)

| Capability | BespoxAI deliverer | Partner deliverer | Gap |
|---|---|---|---|
| Move to in_review | ✅ | ✅ | |
| Send back (needs_clarification + questions) | ✅ | ✅ | |
| Issue quote / consultant note | ✅ | ✅ | |
| Mark deposit paid | ✅ | ✅ (manual) | |
| Start development | ✅ | ✅ | |
| Mark work complete | ✅ | ✅ | |
| Mark balance paid → fully_paid | ✅ | ✅ (manual) | |
| AI: feasibility / spec / dev-plan / dev-notes / coding | ✅ | ✅ | S23 |
| **Assign / reassign developer** | ✅ (`assign` + modal + workload) | ✅ DONE (S25) — partner PATCH, partner_admin, own staff | **C1 RESOLVED** |
| **Developer "mark unable to complete"** | ✅ (`mark-unable`) | ✅ DONE — partner `mark-unable` route (requirePartnerSession + tenant ownership, notifies partner admins) | **C2 RESOLVED** (was already built; audit line was stale) |
| **Addendum (post-acceptance spec change)** | ✅ (`addendum`) | ❌ **MISSING** | **C3** |
| **Submit-for-review (senior dev gate)** | ✅ (`submit-for-review`) | ❌ likely N/A — partner is the senior | verify, prob ➖ |
| **Objects: sync from GitHub / write / list** (`objects/*`, `sync-from-github`, `write`) | ✅ | ✅ DONE (S26) — partner `objects/{sync-from-github,write,route GET}`; partner authors via coding-assistant+commit then syncs (no fetch-from-BC needed) | **C4 RESOLVED** |
| **Deploy to test** (`objects/deploy-test`) | ✅ | ✅ DONE (S26) — partner `objects/deploy-test` → in_uat, notifies client (white-label) | **C4 RESOLVED** |
| **Deploy to prod** (`objects/deploy-prod`) | ✅ | ✅ DONE (S26) — partner `objects/deploy-prod`, gated on `prodApprovedAt` (blocked until C5) | **C4 RESOLVED** |
| **Prod go-live approval doc** (`prod-approval` → `prod-approve`) | ✅ | ❌ **MISSING** | **C5** |

---

## C. The real gaps, prioritized

### C1 — Partner developer assignment/reassign (the trigger for this audit) ✅ RESOLVED (S25)
- DONE: partner requirement PATCH (`app/api/partner/tenants/[id]/requirements/[reqId]`) accepts `assignedDeveloperId`, gated `partner_admin`, validates assignee is a `PartnerUser` of that account. UI dropdown in partner requirement detail (candidates from `/api/partner/users`). Admin side made read-only on partner tenants. (`408876c`)
- NOT built: the workload-indicator modal (direct portal has one); partner uses a simple dropdown. Add the modal later if wanted — not required for parity.

### C2 — Partner developer "mark unable to complete" ✅ RESOLVED (already built)
- Partner-side `mark-unable` route exists at `app/api/partner/tenants/[id]/requirements/[reqId]/mark-unable/route.ts`: `requirePartnerSession` + `assertTenantBelongsToPartner`, sets `unableToCompleteAt`, notifies partner admins via `notifyPartnerRequirementUnableToComplete`. The direct `/mark-unable` rejects partner tenants (S25) by design; the partner route is the correct path on partner tenants. Audit's "still open" line was stale.

### C3 — Addendum (post-acceptance scope change)
- Direct flow lets the deliverer add an addendum after a spec is accepted (quoted+). No partner equivalent. Partner deliverer needs this to handle change requests without a fresh requirement.

### C4 — Objects + deployment pipeline ✅ RESOLVED (S26, two slices)
**Design confirmed:** objects target the **client tenant's** BCAgent (same tunnel + `apiKey`) regardless of deliverer — so the partner routes do byte-identical agent calls; only the auth gate + notification routing differ. Partner authors via coding-assistant + commit, then syncs from GitHub (no fetch-from-BC step needed on the partner side).

**Slice 1 — API (`2b388fd`):** four routes under `app/api/partner/tenants/[id]/requirements/[reqId]/objects/`:
- `sync-from-github` — pulls C/AL from the requirement branch via `resolvePartnerToken` (partner org → BespoxAI fallback), upserts `TenantObjectFile`.
- `write` — writes selected files to the client BCAgent Deployments folder, returns + persists `testDeploySnapshotId`.
- `deploy-test` — agent import+compile to test, sets `status:'in_uat'` + `testDeployedAt`, clears prior UAT cycle, reuses `notifyCustomerReadyForUAT` (already white-labels via `getPartnerFromEmail`).
- `deploy-prod` — agent import+compile to prod, **keeps the `prodApprovedAt` gate**, sets `prodDeployedAt`, reuses `notifyCustomerProdDeployed`.
- Auth on all four: `requirePartnerSession` + `assertTenantBelongsToPartner` + `assertPartnerCanDevelop`. write/deploy-test/deploy-prod additionally gated to **partner_admin OR the requirement's assigned developer** via new `partnerCanDeploy()` in `lib/partner-auth.ts` (server-enforced → 403; button not hidden).

**Slice 2 — UI + list route (`62d694c`):**
- `objects/route.ts` (GET) — lists deployable object files (metadata + `hasContent`) so the write step can collect `fileIds`.
- "Deploy to Client BC" card in partner `RequirementDetail`, gated to dev stages (`in_development`..`complete_pending_payment`). Linear flow: Sync from GitHub → Write Files to Server → Deploy + Compile to Test; plus a Production step gated on `prodApprovedAt` (shows "awaiting client go-live approval" until C5). Per-object compile results for test + prod. Theme-aware via `--rb-*`, SWC-safe JSX.
- `Requirement` type extended with `testDeploySnapshotId`/`prodDeploySnapshotId`/`prodApprovedAt`/`assignedDeveloperId` (already in the GET payload via `REQ_INCLUDE`).

**Testing prerequisites:** requirement needs a linked `githubBranch` (≥1 committed object) AND the client tenant's **test NAV database** configured, else Write returns a clear config error. deploy-prod stays blocked (clean message) until C5 sets `prodApprovedAt` — to test prod before C5, set `prodApprovedAt` via SQL on a test requirement.

### C5 — Production go-live approval (OPEN — next)
- Direct flow: deliverer generates a go-live approval doc (`prod-approval`), customer approves (`prod-approve`). No partner equivalent. Needed to close out prod deployments cleanly.
- **Now the natural next item:** C4's partner `deploy-prod` is gated on `prodApprovedAt`, which only C5 can set. Until C5, partner production deploys stay blocked (by design). Build C5 to unblock them.

---

## D. Superadmin posture on partner tenants (your ruling)
- Superadmin is **read-only** on partner-managed delivery: can SEE assignment/status, cannot reassign or drive partner deliverer actions.
- Admin requirement view: hide deliverer-action controls when `tenant.partnerAccountId` is set (show state only).

---

## E. Suggested sequencing — STATUS
1. **Hotfix** ✅ DONE (S25) — customer leak removed, `assign` locked to superadmin, admin read-only on partner tenants.
2. **C1 + C2** ✅ DONE — C1 (S25 partner assignment), C2 (partner mark-unable, pre-existing).
3. **C3** — addendum parity. OPEN.
4. **C4** ✅ DONE (S26) — objects + deploy pipeline for partner (two slices, `2b388fd` + `62d694c`).
5. **C5** — prod go-live approval parity. OPEN — **next**; unblocks C4's partner prod deploy.

Remaining: **C3** (addendum) and **C5** (go-live approval). C5 is the natural pairing with C4.
