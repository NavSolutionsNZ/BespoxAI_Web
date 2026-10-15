import { parseMetadata, type ODataMetadata } from '@/lib/bc-entities'

/**
 * A tenant's OData $metadata (entity sets + properties), fetched through its
 * BespoxAI Agent and cached per tenant, so the CFO Assistant only plans against
 * entities and fields that actually exist.
 *
 * Never throws: returns null when the agent or BC can't be reached, and the
 * caller falls back to the static catalogue. Failures are cached briefly so a
 * down agent doesn't add a 20-second timeout to every question.
 */

const TTL_MS      = 6 * 60 * 60 * 1000
const FAIL_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; ttl: number; value: ODataMetadata | null }>()

interface MetadataTenant {
  tenantId: string
  agentBaseUrl: string
  bcInstance: string | null
  apiKey: string
}

export async function getTenantMetadata(tenant: MetadataTenant): Promise<ODataMetadata | null> {
  if (!tenant.bcInstance) return null
  const key = tenant.tenantId + '|' + tenant.bcInstance
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value

  let value: ODataMetadata | null = null
  try {
    const res = await fetch(tenant.agentBaseUrl + '/' + tenant.bcInstance + '/ODataV4/$metadata', {
      headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/xml' },
      signal: AbortSignal.timeout(20_000),
    })
    if (res.ok) {
      const parsed = parseMetadata(await res.text())
      if (parsed.entitySets.length) value = parsed
    }
  } catch { /* unreachable — fall back below */ }

  cache.set(key, { at: Date.now(), ttl: value ? TTL_MS : FAIL_TTL_MS, value })
  return value
}

/** Forget a tenant's cached metadata (after discovery, so new services show up at once). */
export function clearTenantMetadata(tenantId: string) {
  for (const k of Array.from(cache.keys())) if (k.startsWith(tenantId + '|')) cache.delete(k)
}
