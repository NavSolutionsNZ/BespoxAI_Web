import { prisma } from './db'

export interface TenantConfig {
  tenantId: string
  name: string
  tunnelSubdomain: string
  bcInstance: string
  bcCompany: string
  apiKey: string
  agentBaseUrl: string
  entityConfig: Record<string, boolean> | null
  country: string
  navProduct: string | null
  navVersion: string | null
  lastCU: string | null
  bcPort: number
  agentPort: number
}

export async function getTenantById(tenantId: string): Promise<TenantConfig | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId, active: true },
    select: {
      id: true, name: true, tunnelSubdomain: true,
      bcInstance: true, bcCompany: true, apiKey: true,
      entityConfig: true, country: true,
      navProduct: true, navVersion: true, lastCU: true,
      bcPort: true, agentPort: true,
    },
  })
  if (!tenant) return null
  return mapTenant(tenant)
}

export async function getTenantBySubdomain(
  subdomain: string,
): Promise<TenantConfig | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { tunnelSubdomain: subdomain, active: true },
  })
  if (!tenant) return null
  return mapTenant(tenant)
}

function mapTenant(tenant: {
  id: string
  name: string
  tunnelSubdomain: string
  bcInstance: string
  bcCompany: string
  apiKey: string
  entityConfig?: any
  navProduct?: string | null
  navVersion?: string | null
  lastCU?: string | null
  bcPort?: number | null
  agentPort?: number | null
}): TenantConfig {
  return {
    tenantId: tenant.id,
    name: tenant.name,
    tunnelSubdomain: tenant.tunnelSubdomain,
    bcInstance: tenant.bcInstance,
    bcCompany: tenant.bcCompany,
    apiKey: tenant.apiKey,
    agentBaseUrl: `https://${tenant.tunnelSubdomain}-agent.bespoxai.com`,
    entityConfig: (tenant.entityConfig as Record<string, boolean> | null) ?? null,
    country:    (tenant as any).country ?? 'NZ',
    navProduct: tenant.navProduct ?? null,
    navVersion: tenant.navVersion ?? null,
    lastCU:     tenant.lastCU ?? null,
    bcPort:     tenant.bcPort ?? 8048,
    agentPort:  tenant.agentPort ?? 9099,
  }
}

/**
 * Build a full OData URL for a given entity + optional query params.
 * e.g. buildODataUrl(tenant, 'Customer', '$top=10&$filter=...')
 */
export function buildODataUrl(
  tenant: TenantConfig,
  entity: string,
  params?: string,
): string {
  const base = `${tenant.agentBaseUrl}/${tenant.bcInstance}/ODataV4/Company('${tenant.bcCompany}')/${entity}`
  return params ? `${base}?${params}` : base
}
