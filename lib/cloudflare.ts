// lib/cloudflare.ts — Cloudflare API helpers for tunnel provisioning

const CF_BASE    = 'https://api.cloudflare.com/client/v4'
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!
const API_TOKEN  = process.env.CLOUDFLARE_API_TOKEN!
const ZONE_ID    = process.env.CLOUDFLARE_ZONE_ID!

function cfHeaders() {
  return {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type':  'application/json',
  }
}

async function cfFetch(path: string, init?: RequestInit) {
  const res  = await fetch(`${CF_BASE}${path}`, { ...init, headers: { ...cfHeaders(), ...(init?.headers ?? {}) } })
  const json = await res.json() as { success: boolean; result: any; errors: any[] }
  if (!json.success) throw new Error(json.errors?.map((e: any) => e.message).join(', ') || 'Cloudflare API error')
  return json.result
}

// Create a named tunnel and return { id, name }
export async function createTunnel(name: string): Promise<{ id: string; name: string }> {
  return cfFetch(`/accounts/${ACCOUNT_ID}/cfd_tunnel`, {
    method: 'POST',
    body: JSON.stringify({ name, config_src: 'cloudflare' }),
  })
}

// Get the connector token for a tunnel (used by cloudflared service install)
export async function getTunnelToken(tunnelId: string): Promise<string> {
  const result = await cfFetch(`/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`)
  return typeof result === 'string' ? result : result.token ?? result
}

// Configure the tunnel to route a hostname to a local service
export async function configureTunnelIngress(tunnelId: string, hostname: string, localService: string) {
  return cfFetch(`/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`, {
    method: 'PUT',
    body: JSON.stringify({
      config: {
        ingress: [
          { hostname, service: localService },
          { service: 'http_status:404' },  // catch-all required by CF
        ],
      },
    }),
  })
}

// Create a CNAME DNS record pointing the subdomain to the tunnel
export async function createDnsRecord(hostname: string, tunnelId: string) {
  return cfFetch(`/zones/${ZONE_ID}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type:    'CNAME',
      name:    hostname,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      ttl:     1,  // auto
    }),
  })
}

// Delete a tunnel (for cleanup / deactivation)
export async function deleteTunnel(tunnelId: string) {
  return cfFetch(`/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}`, { method: 'DELETE' })
}

// ── RDP Support ────────────────────────────────────────────────────────────────

// Add RDP ingress to an existing tunnel alongside the BCAgent rule.
// Rebuilds the full ingress config with both rules (agent + RDP) + catch-all.
export async function addRdpIngress(
  tunnelId:      string,
  agentHostname: string,
  agentPort:     number,
  rdpHostname:   string,
) {
  return cfFetch(`/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`, {
    method: 'PUT',
    body: JSON.stringify({
      config: {
        ingress: [
          { hostname: agentHostname, service: `http://localhost:${agentPort}` },
          { hostname: rdpHostname,   service: 'rdp://localhost:3389' },
          { service: 'http_status:404' },
        ],
      },
    }),
  })
}

// Create CNAME DNS record for the RDP hostname
export async function createRdpDnsRecord(hostname: string, tunnelId: string) {
  return cfFetch(`/zones/${ZONE_ID}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type:    'CNAME',
      name:    hostname,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      ttl:     1,
    }),
  })
}
