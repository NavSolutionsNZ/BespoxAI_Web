# Partner Pipeline Parity Audit
**Question:** Can a partner (as deliverer) and their customer fully run the requirement lifecycle, each in their role, the same way BespoxAI (deliverer) and a direct customer can?

**Short answer:** No — the *status-transition* spine is mirrored (Session 22), and the *AI panels* are mirrored (Session 23), but several **capabilities attached to the lifecycle are missing on the partner side**. Below is the full map.

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
| **Developer "mark unable to complete"** | ✅ (`mark-unable`) | ❌ **MISSING** for partner_developer | **C2** (direct route now rejects partner tenants; partner equivalent not built) |
| **Addendum (post-acceptance spec change)** | ✅ (`addendum`) | ❌ **MISSING** | **C3** |
| **Submit-for-review (senior dev gate)** | ✅ (`submit-for-review`) | ❌ likely N/A — partner is the senior | verify, prob ➖ |
| **Objects: fetch from BC / GitHub** (`fetch-objects`, `objects/*`, `sync-from-github`, `write`) | ✅ | ❌ **MISSING** | **C4** — but partner uses coding-assistant+commit; need to confirm the deploy path |
| **Deploy to test** (`objects/deploy-test`, `manual-deploy-test`) | ✅ | ❌ **MISSING** | **C4** |
| **Deploy to prod** (`objects/deploy-prod`, `manual-deploy-prod`) | ✅ | ❌ **MISSING** | **C4** |
| **Prod go-live approval doc** (`prod-approval` → `prod-approve`) | ✅ | ❌ **MISSING** | **C5** |

---

## C. The real gaps, prioritized

### C1 — Partner developer assignment/reassign (the trigger for this audit) ✅ RESOLVED (S25)
- DONE: partner requirement PATCH (`app/api/partner/tenants/[id]/requirements/[reqId]`) accepts `assignedDeveloperId`, gated `partner_admin`, validates assignee is a `PartnerUser` of that account. UI dropdown in partner requirement detail (candidates from `/api/partner/users`). Admin side made read-only on partner tenants. (`408876c`)
- NOT built: the workload-indicator modal (direct portal has one); partner uses a simple dropdown. Add the modal later if wanted — not required for parity.

### C2 — Partner developer "mark unable to complete" (still open)
- Mirror `mark-unable` for `partner_developer` self-service. NOTE: the direct `/mark-unable` now REJECTS partner tenants (S25), so a partner-side route is required for this to work at all on partner tenants.

### C3 — Addendum (post-acceptance scope change)
- Direct flow lets the deliverer add an addendum after a spec is accepted (quoted+). No partner equivalent. Partner deliverer needs this to handle change requests without a fresh requirement.

### C4 — Objects + deployment pipeline (the BIGGEST gap)
- Direct deliverer can: fetch C/AL objects, sync from GitHub, write to BCAgent, **deploy to test** (→ in_uat), **deploy to prod**.
- Partner deliverer has the **coding assistant + commit** (writes C/AL to GitHub) but **no deploy path** — so a partner can author objects but cannot push them to the customer's test/prod BC. The lifecycle visibly stops: partner can reach `in_development` and AI-write code, but the "Deploy to Test → in_uat → UAT" loop has no partner trigger.
- **This is the thing that most breaks "fully see out the requirement lifecycle."**
- Needs design: does the partner deploy via the **customer tenant's** BCAgent (same tunnel mechanics, partner-authenticated)? Almost certainly yes — the objects target the customer's BC regardless of who delivers.

### C5 — Production go-live approval
- Direct flow: deliverer generates a go-live approval doc (`prod-approval`), customer approves (`prod-approve`). No partner equivalent. Needed to close out prod deployments cleanly.

---

## D. Superadmin posture on partner tenants (your ruling)
- Superadmin is **read-only** on partner-managed delivery: can SEE assignment/status, cannot reassign or drive partner deliverer actions.
- Admin requirement view: hide deliverer-action controls when `tenant.partnerAccountId` is set (show state only).

---

## E. Suggested sequencing (for discussion — NOT yet approved)
1. **Hotfix (low risk, deploy first):** A — remove customer leak in `RequirementsBuilder`; B — lock direct `assign` API to superadmin; D — superadmin read-only gate on partner tenants in admin view.
2. **C1 + C2:** partner assignment + mark-unable (self-contained, mirrors a known pattern).
3. **C3:** addendum parity.
4. **C4:** objects + deploy pipeline for partner — **largest, needs its own design pass** (BCAgent targeting, deploy-test/prod routes, status→in_uat wiring).
5. **C5:** prod go-live approval parity.

Each of 2–5 is a session-sized chunk. 1 is small and stops the active bug.
