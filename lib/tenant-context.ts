/**
 * lib/tenant-context.ts
 *
 * Builds a per-tenant knowledge context string for injection into AI system prompts.
 *
 * Assembles from your existing DB — no new tables needed:
 *   - BC environment (product, version, CU, company, country)
 *   - Enabled BC entities (from entityConfig)
 *   - Customisation history (past requirements with status, quote, notes)
 *   - Uploaded AL objects (from TenantObjectFile)
 *
 * Results are cached per-tenant for 5 minutes — one DB round-trip per tenant
 * per context window, not per AI call.
 *
 * Usage:
 *   import { buildTenantContext, resolveBcVersion } from '@/lib/tenant-context'
 *
 *   // In a route handler:
 *   const tenantCtx = await buildTenantContext(tenantId)
 *   const systemPrompt = `You are a BC consultant...\n\n${tenantCtx}\n\n...rest of prompt`
 *
 * Cache invalidation (call after any tenant data change):
 *   invalidateTenantContext(tenantId)
 */

import { prisma } from '@/lib/db'

// ── Internal types ────────────────────────────────────────────────────────────

interface TenantRow {
  id:          string
  name:        string
  navProduct:  string | null
  navVersion:  string | null
  lastCU:      string | null
  bcInstance:  string
  bcCompany:   string
  bcPort:      number
  agentPort:   number
  country:     string
  entityConfig: unknown
}

interface RequirementRow {
  title:                string
  bcArea:               string
  status:               string
  quote:                unknown
  consultantNote:       string | null
  feasibility:          string | null
  feasibilityNotes:     string | null
  feasibilityCostRange: string | null
}

interface ObjectFileRow {
  objectType: string
  objectName: string
  objectId:   number | null
  language:   string
}

// ── Per-tenant 5-minute cache ─────────────────────────────────────────────────

interface CacheEntry { context: string; at: number }
const _cache   = new Map<string, CacheEntry>()
const CACHE_TTL = 5 * 60 * 1000

/** Invalidate a tenant's cached context — call after settings/requirements change */
export function invalidateTenantContext(tenantId: string): void {
  _cache.delete(tenantId)
}

// ── BC version resolver ───────────────────────────────────────────────────────
//
// Previously duplicated across ai-spec, feasibility, and dev-plan routes.
// Single source of truth here — routes can import and use directly.

export function resolveBcVersion(
  tenant: {
    navProduct:  string | null
    navVersion:  string | null
    lastCU?:     string | null
    bcInstance?: string
  },
  signupBcVersion?: string | null,
): string {
  // Prefer onboarding-captured fields (set by the tenant, most accurate)
  if (tenant.navProduct && tenant.navVersion) {
    const parts = [tenant.navVersion]
    if (tenant.lastCU) parts.push(`CU: ${tenant.lastCU}`)
    if (tenant.navProduct === 'NAV') {
      parts.push('(C/AL — Navision on-premise)')
    } else if (tenant.navProduct === 'BC') {
      const isHybrid = tenant.navVersion.toLowerCase().includes('14')
      parts.push(isHybrid ? '(on-premise, C/AL + AL hybrid)' : '(AL extensions)')
    }
    return parts.join(' — ')
  }

  // Fall back to signup bcVersion code if available
  if (signupBcVersion) {
    const vMap: Record<string, string> = {
      BC14:    'BC 14 (on-premise, C/AL + AL hybrid)',
      BC15:    'BC 15 (AL extensions)',
      BC16:    'BC 16 (AL extensions)',
      BC17:    'BC 17 (AL extensions)',
      BC18:    'BC 18 (AL extensions)',
      BC19:    'BC 19 (AL extensions)',
      BC20:    'BC 20 (AL extensions)',
      BC21:    'BC 21 (AL extensions)',
      BC22:    'BC 22 (AL extensions)',
      BC23:    'BC 23 (AL extensions)',
      BC24:    'BC 24 (AL extensions)',
      BC25:    'BC 25 (AL extensions, latest)',
      NAV2009: 'NAV 2009 (C/AL)',
      NAV2013: 'NAV 2013 (C/AL)',
      NAV2015: 'NAV 2015 (C/AL)',
      NAV2016: 'NAV 2016 (C/AL)',
      NAV2017: 'NAV 2017 (C/AL)',
      NAV2018: 'NAV 2018 (C/AL)',
    }
    return vMap[signupBcVersion] ?? signupBcVersion
  }

  // Last resort — bcInstance gives some signal
  if (tenant.bcInstance && tenant.bcInstance !== 'GWM_Dev') {
    return `Business Central (instance: ${tenant.bcInstance} — version not confirmed)`
  }

  return 'Business Central / NAV (version not confirmed — assume latest BC SaaS unless context suggests otherwise)'
}

// ── Status labels ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  submitted:                'Submitted',
  needs_clarification:      'Needs clarification',
  in_review:                'Under review',
  quoted:                   'Quoted',
  quote_rejected:           'Quote rejected',
  deposit_required:         'Awaiting deposit',
  deposit_paid:             'Deposit paid',
  in_development:           'In development',
  complete_pending_payment: 'Complete — balance due',
  fully_paid:               'Delivered',
  rejected:                 'Rejected',
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Builds a formatted context string for this tenant, ready to inject
 * into any AI system prompt. Returns an empty string on error (non-fatal).
 *
 * Sections included:
 *   ## Customer BC Environment
 *   ## Enabled BC Entities
 *   ## Customisation History
 *   ## Known BC Objects
 */
export async function buildTenantContext(tenantId: string): Promise<string> {
  const hit = _cache.get(tenantId)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.context

  try {
    const [tenant, requirements, objects] = await Promise.all([

      (prisma as any).tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true, name: true,
          navProduct: true, navVersion: true, lastCU: true,
          bcInstance: true, bcCompany: true,
          bcPort: true, agentPort: true,
          country: true, entityConfig: true,
        },
      }) as Promise<TenantRow | null>,

      // All non-draft requirements, most recent first, capped at 20
      (prisma as any).requirement.findMany({
        where: {
          tenantId,
          status: { notIn: ['draft', 'rejected'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          title:                true,
          bcArea:               true,
          status:               true,
          quote:                true,
          consultantNote:       true,
          feasibility:          true,
          feasibilityNotes:     true,
          feasibilityCostRange: true,
        },
      }) as Promise<RequirementRow[]>,

      // Uploaded AL objects, most recent first, deduplicated below
      (prisma as any).tenantObjectFile.findMany({
        where: { tenantId, parseError: false },
        orderBy: { uploadedAt: 'desc' },
        take: 30,
        select: {
          objectType: true,
          objectName: true,
          objectId:   true,
          language:   true,
        },
      }) as Promise<ObjectFileRow[]>,

    ])

    if (!tenant) {
      _cache.set(tenantId, { context: '', at: Date.now() })
      return ''
    }

    const lines: string[] = []

    // ── Section 1: BC Environment ────────────────────────────────────────────
    const bcVersion = resolveBcVersion(tenant)
    lines.push('## Customer BC Environment')
    lines.push(`Product: ${bcVersion}`)
    // Only show company name if it's been customised away from the default
    if (tenant.bcCompany && tenant.bcCompany !== 'GWM') {
      lines.push(`BC Company: ${tenant.bcCompany}`)
    }
    lines.push(`Country: ${tenant.country}`)

    // ── Section 2: Enabled BC Entities ───────────────────────────────────────
    const entityConfig = tenant.entityConfig as Record<string, boolean> | null
    if (entityConfig) {
      const enabled = Object.entries(entityConfig)
        .filter(([, v]) => v !== false)
        .map(([k]) => k)
      if (enabled.length > 0) {
        lines.push('\n## Enabled BC Entities')
        lines.push(enabled.join(', '))
      }
    }

    // ── Section 3: Customisation History ────────────────────────────────────
    if (requirements.length > 0) {
      const count = requirements.length
      lines.push(`\n## Customisation History (${count} requirement${count !== 1 ? 's' : ''})`)

      for (const r of requirements) {
        const label = STATUS_LABELS[r.status] ?? r.status
        const quote = r.quote ? ` — $${Number(r.quote).toLocaleString()} NZD` : ''
        lines.push(`- [${r.bcArea}] ${r.title} — ${label}${quote}`)

        if (r.feasibility) {
          const range = r.feasibilityCostRange ? ` (${r.feasibilityCostRange})` : ''
          lines.push(`  Feasibility: ${r.feasibility}${range}`)
        }

        if (r.consultantNote) {
          // Trim long notes to keep token overhead bounded (~200 chars)
          const note = r.consultantNote.replace(/\s+/g, ' ').trim()
          const trimmed = note.length > 200 ? note.slice(0, 200) + '…' : note
          lines.push(`  Note: ${trimmed}`)
        }
      }
    }

    // ── Section 4: Known AL Objects ──────────────────────────────────────────
    if (objects.length > 0) {
      lines.push('\n## Known BC Objects (fetched from customer system)')
      const seen = new Set<string>()
      for (const o of objects) {
        const dedupeKey = `${o.objectType}-${o.objectId ?? o.objectName}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        const id  = o.objectId ? ` ${o.objectId}` : ''
        const s   = (o.summary ?? {}) as Record<string, any>
        const vl  = s.versionList ? ` — ${s.versionList}` : ''
        lines.push(`- ${o.objectType}${id} "${o.objectName}" (${o.language})${vl}`)

        // Fields (Tables)
        if (s.fields?.length) {
          const fieldList = s.fields.slice(0, 15).map((f: any) => `${f.name}(${f.type})`).join(', ')
          const more = s.fields.length > 15 ? ` +${s.fields.length - 15} more` : ''
          lines.push(`  Fields: ${fieldList}${more}`)
        }
        // Procedures / functions (Codeunits)
        if (s.procedures?.length) {
          const procList = s.procedures.slice(0, 10).map((p: any) => p.name).join(', ')
          const more = s.procedures.length > 10 ? ` +${s.procedures.length - 10} more` : ''
          lines.push(`  Functions: ${procList}${more}`)
        }
        // Event subscribers
        if (s.eventSubscribers?.length) {
          lines.push(`  Subscribes: ${s.eventSubscribers.map((e: any) => `${e.object}.${e.event}`).join(', ')}`)
        }
        // Source table (Pages)
        if (s.sourceTable) lines.push(`  Source table: ${s.sourceTable}`)
      }
    }

    const context = lines.join('\n')
    _cache.set(tenantId, { context, at: Date.now() })
    return context

  } catch (e) {
    console.error('[tenant-context] Failed to build context:', e)
    return ''
  }
}
