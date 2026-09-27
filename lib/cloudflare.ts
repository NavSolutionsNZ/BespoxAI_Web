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

// Remove a DNS record by exact hostname (no-op if none exists).
export async function deleteDnsRecordByName(hostname: string) {
  const records = await cfFetch(`/zones/${ZONE_ID}/dns_records?name=${encodeURIComponent(hostname)}`)
  for (const r of (records as any[]) || []) {
    await cfFetch(`/zones/${ZONE_ID}/dns_records/${r.id}`, { method: 'DELETE' })
  }
}

// ── Cloudflare Access (RDP gating) ─────────────────────────────────────────────
// The API token needs Account → "Access: Apps and Policies" Edit and
// "Access: Organizations, Identity Providers, and Groups" Read.

let authDomainCache: string | null = null
let otpIdpCache: string | null = null

// Zero Trust team domain, e.g. "bespoxai.cloudflareaccess.com". Used to fetch
// the keys that sign Access's External Evaluation requests.
export async function getAccessAuthDomain(): Promise<string> {
  if (process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN) return process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN
  if (authDomainCache) return authDomainCache
  const org = await cfFetch(`/accounts/${ACCOUNT_ID}/access/organizations`)
  if (!org?.auth_domain) throw new Error('Could not read the Zero Trust team domain')
  authDomainCache = org.auth_domain as string
  return authDomainCache
}

// The account's One-time PIN login method. RDP apps allow this method only.
export async function getOneTimePinIdpId(): Promise<string> {
  if (otpIdpCache) return otpIdpCache
  const idps = await cfFetch(`/accounts/${ACCOUNT_ID}/access/identity_providers`)
  const otp = ((idps as any[]) || []).find(i => i.type === 'onetimepin')
  if (!otp) throw new Error('One-time PIN login method is not set up in Cloudflare Zero Trust')
  otpIdpCache = otp.id as string
  return otpIdpCache
}

// Create the reusable Allow policy for one tenant's RDP app: anyone who signs
// in, provided the portal's live check (External Evaluation) approves them.
export async function createRdpAccessPolicy(name: string, evaluateUrl: string, keysUrl: string): Promise<{ id: string }> {
  return cfFetch(`/accounts/${ACCOUNT_ID}/access/policies`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      decision: 'allow',
      include:  [{ everyone: {} }],
      require:  [{ external_evaluation: { evaluate_url: evaluateUrl, keys_url: keysUrl } }],
    }),
  })
}

// Create the self-hosted Access app in front of {sub}-rdp.bespoxai.com:
// One-time PIN sign-in, then an Independent MFA authenticator, 8h sessions.
export async function createRdpAccessApp(args: {
  name: string; hostname: string; policyId: string; otpIdpId: string
}): Promise<{ id: string; aud: string }> {
  return cfFetch(`/accounts/${ACCOUNT_ID}/access/apps`, {
    method: 'POST',
    body: JSON.stringify({
      name:                      args.name,
      type:                      'self_hosted',
      domain:                    args.hostname,
      session_duration:          '8h',
      allowed_idps:              [args.otpIdpId],
      auto_redirect_to_identity: true,
      app_launcher_visible:      false,
      mfa_config: {
        mfa_disabled:           false,
        allowed_authenticators: ['totp', 'biometrics', 'security_key'],
        session_duration:       '8h',
      },
      policies: [{ id: args.policyId, precedence: 1 }],
    }),
  })
}

export async function getAccessApp(appId: string): Promise<any | null> {
  try { return await cfFetch(`/accounts/${ACCOUNT_ID}/access/apps/${appId}`) }
  catch { return null }
}

export async function deleteAccessApp(appId: string) {
  return cfFetch(`/accounts/${ACCOUNT_ID}/access/apps/${appId}`, { method: 'DELETE' })
}

export async function deleteAccessPolicy(policyId: string) {
  return cfFetch(`/accounts/${ACCOUNT_ID}/access/policies/${policyId}`, { method: 'DELETE' })
}
