// lib/rdp-access.ts — who may open a Remote Desktop session to a tenant's
// server, and the Cloudflare Access app that enforces it.
//
// {sub}-rdp.bespoxai.com sits behind a Cloudflare Access app: One-time PIN
// sign-in, then an Independent MFA authenticator. Its single Allow policy
// requires an External Evaluation, so at every sign-in Cloudflare asks
// /api/rdp/access-check/{tenantId} whether this email may connect, and
// canConnectRdp() answers from the database. Nothing is copied into Cloudflare
// that could drift, and every attempt is written to RdpAccessLog.

import crypto from 'crypto'
import { prisma } from './db'
import {
  addRdpIngress, configureTunnelIngress, createRdpDnsRecord, deleteDnsRecordByName,
  createRdpAccessPolicy, createRdpAccessApp, getAccessApp, deleteAccessApp, deleteAccessPolicy,
  getOneTimePinIdpId, getAccessAuthDomain,
} from './cloudflare'

const PORTAL_BASE = 'https://bespoxai.com'
const EVAL_KEY_ENV = 'RDP_ACCESS_EVAL_KEY'   // base64 of an RSA private key PEM

export function rdpHostnameFor(subdomain: string) { return subdomain + '-rdp.bespoxai.com' }
export function agentHostnameFor(subdomain: string) { return subdomain + '-agent.bespoxai.com' }

// ── Access rule ───────────────────────────────────────────────────────────────

export type RdpAccessDecision = { allowed: boolean; userId: string; reason: string }

/**
 * The single rule for RDP access. A tenant's server is reachable only while
 * the customer has consented and RDP is provisioned, and then only by:
 *   - superadmins
 *   - users of the partner that manages the tenant
 *   - BespoxAI developers assigned to any of the tenant's requirements
 * The user must exist and be active.
 */
export async function canConnectRdp(tenantId: string, email: string): Promise<RdpAccessDecision> {
  const deny = (reason: string, userId = ''): RdpAccessDecision => ({ allowed: false, userId, reason })
  const addr = (email || '').trim()
  if (!addr) return deny('no email')

  const tenant = await (prisma as any).tenant.findFirst({
    where:  { id: tenantId },
    select: { id: true, active: true, partnerAccountId: true, rdpConsentAt: true, rdpProvisionedAt: true },
  })
  if (!tenant)                   return deny('tenant not found')
  if (!tenant.active)            return deny('tenant inactive')
  if (!tenant.rdpConsentAt)      return deny('customer has not consented')
  if (!tenant.rdpProvisionedAt)  return deny('RDP not provisioned')

  const user = await (prisma as any).user.findFirst({
    where:  { email: { equals: addr, mode: 'insensitive' } },
    select: { id: true, role: true, active: true },
  })
  if (!user)         return deny('unknown user')
  if (!user.active)  return deny('user inactive', user.id)

  if (user.role === 'superadmin') return { allowed: true, userId: user.id, reason: 'superadmin' }

  if (tenant.partnerAccountId) {
    const pu = await (prisma as any).partnerUser.findFirst({
      where:  { userId: user.id, partnerAccountId: tenant.partnerAccountId },
      select: { id: true },
    })
    if (pu) return { allowed: true, userId: user.id, reason: 'partner user' }
  }

  if (user.role === 'developer') {
    const req = await (prisma as any).requirement.findFirst({
      where:  { tenantId, assignedDeveloperId: user.id },
      select: { id: true },
    })
    if (req) return { allowed: true, userId: user.id, reason: 'assigned developer' }
  }

  return deny('not authorised for this tenant', user.id)
}

// ── Provision / tear down ─────────────────────────────────────────────────────

type ProvisionResult = { rdpHostname: string; steps: string[] }

/**
 * Put the tenant's RDP hostname behind Access, then publish it. Order matters:
 * the Access app is created before the tunnel route and DNS, so the hostname
 * is never reachable without Access in front of it. Safe to re-run.
 */
export async function provisionRdpAccess(tenantId: string): Promise<ProvisionResult> {
  const tenant = await (prisma as any).tenant.findFirst({
    where:  { id: tenantId },
    select: {
      id: true, name: true, tunnelId: true, tunnelSubdomain: true, agentPort: true,
      rdpConsentAt: true, rdpAccessAppId: true, rdpAccessPolicyId: true,
    },
  })
  if (!tenant) throw new RdpError(404, 'Tenant not found')
  if (!tenant.rdpConsentAt) throw new RdpError(403, 'The customer has not consented to remote support access')
  if (!tenant.tunnelId || !tenant.tunnelSubdomain) throw new RdpError(400, 'Tenant has no tunnel — download and run the installer first')
  if (!process.env[EVAL_KEY_ENV]) throw new RdpError(500, EVAL_KEY_ENV + ' is not set')

  const subdomain   = tenant.tunnelSubdomain as string
  const rdpHostname = rdpHostnameFor(subdomain)
  const steps: string[] = []

  // 1. Access app + policy (reuse if still present in Cloudflare)
  let appId    = tenant.rdpAccessAppId as string | null
  let policyId = tenant.rdpAccessPolicyId as string | null
  if (appId && !(await getAccessApp(appId))) {
    if (policyId) await deleteAccessPolicy(policyId).catch(() => {})
    appId = null; policyId = null
  }
  if (!appId) {
    try {
      const otpIdpId = await getOneTimePinIdpId()
      const policy = await createRdpAccessPolicy(
        'RDP ' + subdomain + ' — portal live check',
        PORTAL_BASE + '/api/rdp/access-check/' + tenant.id,
        PORTAL_BASE + '/api/rdp/access-keys',
      )
      policyId = policy.id
      try {
        const app = await createRdpAccessApp({
          name: 'RDP — ' + tenant.name + ' (' + subdomain + ')',
          hostname: rdpHostname, policyId: policy.id, otpIdpId,
        })
        appId = app.id
      } catch (e) {
        await deleteAccessPolicy(policy.id).catch(() => {})
        throw e
      }
    } catch (e: any) {
      throw new RdpError(502, 'Failed to create the Cloudflare Access app: ' + e.message)
    }
    await (prisma as any).tenant.update({
      where: { id: tenant.id },
      data:  { rdpAccessAppId: appId, rdpAccessPolicyId: policyId },
    })
    steps.push('Access app created for ' + rdpHostname + ' (One-time PIN + MFA, portal live check)')
  } else {
    steps.push('Access app already in place for ' + rdpHostname)
  }

  // 2. Tunnel route, 3. DNS
  try {
    await addRdpIngress(tenant.tunnelId, agentHostnameFor(subdomain), (tenant.agentPort as number) || 9099, rdpHostname)
    steps.push('RDP route added: ' + rdpHostname + ' -> rdp://localhost:3389')
  } catch (e: any) {
    throw new RdpError(502, 'Failed to add RDP route: ' + e.message)
  }
  try {
    await createRdpDnsRecord(rdpHostname, tenant.tunnelId)
    steps.push('DNS record created: ' + rdpHostname)
  } catch (e: any) {
    steps.push('DNS record: ' + e.message + ' (may already exist — continuing)')
  }

  await (prisma as any).tenant.update({ where: { id: tenant.id }, data: { rdpProvisionedAt: new Date() } })
  return { rdpHostname, steps }
}

/**
 * Remove RDP from the tenant: route first (cuts connectivity), then DNS, then
 * the Access app and policy. Each step is attempted even if an earlier one
 * fails; the live check already denies once consent is withdrawn, so a
 * partial teardown never re-opens access. Returns whether there was anything
 * to remove, and any errors for reporting.
 */
export async function deprovisionRdpAccess(tenantId: string): Promise<{ removed: boolean; errors: string[] }> {
  const tenant = await (prisma as any).tenant.findFirst({
    where:  { id: tenantId },
    select: { id: true, tunnelId: true, tunnelSubdomain: true, agentPort: true, rdpAccessAppId: true, rdpAccessPolicyId: true, rdpProvisionedAt: true },
  })
  if (!tenant) return { removed: false, errors: [] }
  if (!tenant.rdpProvisionedAt && !tenant.rdpAccessAppId && !tenant.rdpAccessPolicyId) return { removed: false, errors: [] }
  const errors: string[] = []
  const subdomain = tenant.tunnelSubdomain as string | null

  if (tenant.tunnelId && subdomain) {
    try {
      await configureTunnelIngress(tenant.tunnelId, agentHostnameFor(subdomain), 'http://localhost:' + ((tenant.agentPort as number) || 9099))
    } catch (e: any) { errors.push('route: ' + e.message) }
    try { await deleteDnsRecordByName(rdpHostnameFor(subdomain)) }
    catch (e: any) { errors.push('dns: ' + e.message) }
  }
  if (tenant.rdpAccessAppId) {
    try { await deleteAccessApp(tenant.rdpAccessAppId) } catch (e: any) { errors.push('access app: ' + e.message) }
  }
  if (tenant.rdpAccessPolicyId) {
    try { await deleteAccessPolicy(tenant.rdpAccessPolicyId) } catch (e: any) { errors.push('access policy: ' + e.message) }
  }

  await (prisma as any).tenant.update({
    where: { id: tenant.id },
    data:  errors.length
      ? { rdpProvisionedAt: null }
      : { rdpProvisionedAt: null, rdpAccessAppId: null, rdpAccessPolicyId: null },
  })
  return { removed: true, errors }
}

export class RdpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// ── External Evaluation JWTs ──────────────────────────────────────────────────

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function evalPrivateKey(): crypto.KeyObject {
  const raw = process.env[EVAL_KEY_ENV]
  if (!raw) throw new Error(EVAL_KEY_ENV + ' is not set')
  const pem = raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  return crypto.createPrivateKey(pem)
}

function evalPublicJwk() {
  const jwk = crypto.createPublicKey(evalPrivateKey()).export({ format: 'jwk' }) as any
  const kid = b64url(crypto.createHash('sha256').update(jwk.n).digest()).slice(0, 16)
  return { ...jwk, kid, alg: 'RS256', use: 'sig' }
}

/** JWKS served at /api/rdp/access-keys for Cloudflare to verify our answers. */
export function evalJwks() {
  return { keys: [evalPublicJwk()] }
}

/** Sign the answer to an External Evaluation request (valid 60s). */
export function signEvalResponse(payload: { success: boolean; nonce?: string }): string {
  const now    = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT', kid: evalPublicJwk().kid }
  const body   = { ...payload, iat: now, exp: now + 60 }
  const input  = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(body))
  const sig    = crypto.sign('RSA-SHA256', Buffer.from(input), evalPrivateKey())
  return input + '.' + b64url(sig)
}

let certsCache: { at: number; keys: any[] } | null = null

async function accessCerts(force = false): Promise<any[]> {
  if (!force && certsCache && Date.now() - certsCache.at < 10 * 60 * 1000) return certsCache.keys
  const domain = await getAccessAuthDomain()
  const res = await fetch('https://' + domain + '/cdn-cgi/access/certs', { cache: 'no-store' })
  if (!res.ok) throw new Error('Could not fetch Access certs: HTTP ' + res.status)
  const json = await res.json() as { keys?: any[] }
  certsCache = { at: Date.now(), keys: json.keys || [] }
  return certsCache.keys
}

/**
 * Verify the token Cloudflare Access sends to the evaluate URL: RS256, signed
 * by this account's Access keys, not expired. Returns its claims or null.
 */
export async function verifyAccessEvalToken(token: string): Promise<any | null> {
  const parts = (token || '').split('.')
  if (parts.length !== 3) return null
  let header: any, claims: any
  try {
    header = JSON.parse(fromB64url(parts[0]).toString('utf8'))
    claims = JSON.parse(fromB64url(parts[1]).toString('utf8'))
  } catch { return null }
  if (header.alg !== 'RS256' || !header.kid) return null

  let jwk = (await accessCerts()).find(k => k.kid === header.kid)
  if (!jwk) jwk = (await accessCerts(true)).find(k => k.kid === header.kid)   // key rotation
  if (!jwk) return null

  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(parts[0] + '.' + parts[1]),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }),
    fromB64url(parts[2]),
  )
  if (!ok) return null
  const now = Math.floor(Date.now() / 1000)
  if (typeof claims.exp === 'number' && claims.exp < now) return null
  return claims
}
