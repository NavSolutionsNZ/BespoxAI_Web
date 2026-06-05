# SWC Parse Failure — RequirementsBuilder.tsx

**Status:** Unresolved after Session 16  
**File:** `components/RequirementsBuilder.tsx`  
**Symptom:** Vercel build fails with `Unexpected token 'div'. Expected jsx identifier` every single push. Local `tsc --noEmit` passes clean every time.

---

## The Goal

Adding collapsible panels to the customer requirements view (`RequirementsBuilder.tsx`). The feature itself is correct and TypeScript-clean — the problem is SWC refusing to compile the file after any additions.

---

## The Core Problem

`RequirementsBuilder.tsx` is ~2459 lines (session-14 baseline). Adding any meaningful code (~30+ lines) causes Vercel's SWC TSX parser to fail with a cryptic `Unexpected token 'div'` at the `return (` of the main component function.

**The error always points to the main `return (` of the component** — never the actual offending code. This is SWC reporting the wrong location; the real cause is something earlier in the file.

**The error line number tracks the `return (` exactly.** As we add/remove lines above it, the error line number moves with it — confirming SWC is failing somewhere before the return and then reporting the failure at the first JSX it encounters.

**Local TypeScript (`tsc --noEmit`) always passes clean.** This is a SWC-specific issue, not a TypeScript issue.

---

## What Makes It Fail

The file was last successfully deployed at commit `1fe2829` (session 14, "Update context files — session 14 complete"). The baseline is 2459 lines.

Adding the collapse feature requires ~36 lines of new code. The additions that consistently triggered the failure:

### 1. `} as const` on BANNER_CONFIG (already in baseline at line 959)
When new code shifts `BANNER_CONFIG` from line 959 to ~line 985+, SWC starts failing. Removing `as const` doesn't fix it — the position is the trigger, not the syntax.

### 2. `if (error) return <div...>` (inline single-line JSX)
The baseline has `if (error)   return <div style=...>...</div>` as a one-liner before the main return. SWC chokes on this when the file grows. Converting to multi-line `if (error) return (\n  <div>...\n)` just moves the error to the closing `)`.

### 3. `const BANNER_CONFIG = {...}` defined inside component body (~26 lines)
A large object literal defined inside the component function body, right before `return (`. Moving it to module level appeared to fix one issue but revealed the next.

### 4. `Record<string, string[]>` inside component body
TypeScript generic type annotations inside the component function body confuse SWC in large `.tsx` files.

---

## Everything Tried (30+ failed deploys)

### Approach 1: Fix the type annotations
- Removed `Record<string, string[]>` from inside component → still failed
- Moved `CollapseMap` type alias to module level → still failed  
- Replaced `{[k:string]:boolean}` with module-level type alias → still failed
- Removed `as const` from BANNER_CONFIG → still failed (different line)
- Removed `textAlign: 'right' as const` from JSX style prop → still failed

### Approach 2: Move things to module level
- Moved `BANNER_CONFIG` to module level → still failed (next issue revealed)
- Added `CardToggleBtn` at module level → fine on its own, but combined with other additions still fails
- Moved `isCardCollapsedFn`, `CARD_OPEN_FOR` to module level → still failed
- Extracted invoice PDF functions (330 lines) to `components/invoicePDF.ts` → reduced file to 2140 lines, still failed

### Approach 3: Fix the early return pattern
- `if (error) return <div...>` (single line) → failed at line N
- `if (error) return (\n  <div>...\n)` (multi-line) → failed at line N+4 (closing `)`)
- `{error && <div...>}` inside main return with `{!error && <>...</>}` wrapper → not yet confirmed, last attempt in flight

### Approach 4: Rebuild from baseline
- `git checkout 1fe2829 -- components/RequirementsBuilder.tsx` to restore working baseline
- Applied minimal diff (~36 lines) matching exact admin page pattern
- Still failed — `BANNER_CONFIG` at ~line 985 is the trigger

### Approach 5: File splitting
- Extracted `generateInvoicePDF` and `generateReviewInvoicePDF` to `components/invoicePDF.ts`
- Reduced to 2140 lines — still failed
- Reverted this (invoicePDF.ts deleted, RequirementsBuilder restored)

---

## Current State of the File

The file is currently at commit `0d68e29` with:
- Collapse feature added (state + isCardCollapsed + toggleCard + CardToggleBtn + 6 panel wrappers)
- `BANNER_CONFIG` moved to module level (no `as const`)
- `if (error)` early return removed — error now shown via `{error && ...}` inside main return
- TypeScript: clean
- Vercel: last deploy (`dpl_BMNYhUcEqyMJ2X655uvL6JK1uNcH`) failed at line 989 `)` — the closing paren of the if-return block (now removed in `0d68e29`)

The latest push (`0d68e29`) has not yet been confirmed as passing or failing at time of writing.

---

## Key Facts for Debugging

1. **`app/admin/page.tsx` builds fine** with the same collapse pattern (`isAdminCardCollapsed`, `collapsedAdminCards`, `Record<string, string[]>` inside function body). That file is ~4195 lines.

2. **The error always says `Unexpected token 'div'` at `return (`** — SWC is not telling you what it actually choked on.

3. **The line that triggers the failure shifts predictably** as code is added/removed above it — confirming it's a position-sensitive SWC bug.

4. **Local `node_modules/.bin/tsc --noEmit` passes clean** on every attempt.

5. **The baseline `1fe2829` deploys fine** — it's only additions that break it.

6. **Constructs that appear to be position-sensitive triggers:**
   - `} as const` closing a large object literal inside a component function
   - `if (cond) return (...)` before the main `return (` when the file is large
   - Large object literals (`BANNER_CONFIG`) defined inside component body near the end of the function

7. **The Vercel build cache** restores from `J5xnEExRV1LJV8GZEDjrCHgWQMZE` (session-14 READY deploy) on every build — unclear if this contributes.

---

## Hypothesis

SWC's TSX parser has a position-sensitive bug in large `.tsx` files. When the file reaches a certain size/structure, certain TypeScript constructs (`as const`, inline JSX early returns, large object literals before `return`) confuse the parser's state machine, causing it to lose track of whether it's in a type expression or a JSX expression context.

The `app/admin/page.tsx` at 4195 lines doesn't hit this — possibly because it doesn't have the same pre-return constructs, or because it's in the `app/` directory which may use different compilation settings.

---

## The Collapse Feature Code (for reference)

The feature itself is correct — needs to be applied in a way that doesn't trigger SWC:

```typescript
// State (inside component)
const [collapsedCards, setCC] = useState<Record<string,boolean>>({})
function toggleCard(id: string) { setCC(prev => ({ ...prev, [id]: !isCardCollapsed(id, prev) })) }
function isCardCollapsed(id: string, map?: Record<string,boolean>): boolean {
  const m = map ?? collapsedCards
  if (id in m) return m[id]
  const dash = id.lastIndexOf('-')
  const prefix = id.slice(0, dash)
  const reqId = id.slice(dash + 1)
  const req = reqs.find((r: any) => r.id === reqId)
  const st = req?.status ?? 'draft'
  const openFor: Record<string, string[]> = {
    desc:    ['draft','needs_clarification','quote_rejected'],
    spec:    ['draft','submitted','needs_clarification','quote_rejected','in_review'],
    feasib:  ['submitted','needs_clarification','in_review'],
    quote:   ['quoted','deposit_required','complete_pending_payment','fully_paid'],
    uat:     ['in_uat','uat_confirmed','uat_rejected'],
    proddep: ['uat_confirmed','complete_pending_payment','fully_paid'],
    addenda: [],
  }
  return !(openFor[prefix] ?? []).includes(st)
}
```

```tsx
// CardToggleBtn (module level)
function CardToggleBtn({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return <button onClick={onToggle} style={{...}} title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▾' : '▴'}</button>
}
```

Panel toggle pattern:
```tsx
<div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
  <label>Panel Title</label>
  <CardToggleBtn collapsed={!!isCardCollapsed('key-'+req.id)} onToggle={()=>toggleCard('key-'+req.id)} />
</div>
<div style={{overflow:'hidden',maxHeight:isCardCollapsed('key-'+req.id)?0:'9999px',transition:'max-height 0.25s ease'}}>
  {/* panel content */}
</div>
```

`selectReq` should call `setCC({})` at the start to reset collapse state on requirement selection.
