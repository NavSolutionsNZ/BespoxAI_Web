// lib/partner-from-email.ts — a white-label partner's "From" address is only
// used once someone has proved they control that mailbox.
//
// Setting fromEmail (partner settings) doesn't change it; it emails a one-time
// link to the new address. Clicking it (/api/partner/account/verify-from-email)
// stores the address with fromEmailVerifiedAt. Notifications only use a
// verified address, so a partner can't send mail "from" an address they don't
// own (e.g. billing@bespoxai.com or another company's domain).

import crypto from 'crypto'
import { prisma } from './db'
import { sendEmail } from './email'

const IDENT_PREFIX = 'partner-from-email:'
const TTL_MS = 24 * 60 * 60 * 1000
const PORTAL = process.env.NEXTAUTH_URL ?? 'https://bespoxai.com'

const EMAIL_RE = /^[^\s@<>"',;]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export function isAllowedFromEmail(email: string): boolean {
  if (!EMAIL_RE.test(email)) return false
  const domain = email.split('@')[1].toLowerCase()
  return domain !== 'bespoxai.com' && !domain.endsWith('.bespoxai.com')
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** Start verification of a new From address for a partner account. */
export async function requestFromEmailVerification(partnerAccountId: string, partnerName: string, email: string) {
  const identifier = IDENT_PREFIX + partnerAccountId + ':' + email
  await (prisma as any).verificationToken.deleteMany({ where: { identifier: { startsWith: IDENT_PREFIX + partnerAccountId + ':' } } })
  const token = crypto.randomBytes(32).toString('hex')
  await (prisma as any).verificationToken.create({ data: { identifier, token, expires: new Date(Date.now() + TTL_MS) } })

  const url = PORTAL + '/api/partner/account/verify-from-email?token=' + token
  await sendEmail({
    to: email,
    subject: 'Confirm this address for ' + partnerName + ' notifications',
    html:
      '<div style="font-family:sans-serif;max-width:520px;color:#1a2a1e">' +
      '<p>' + escapeHtml(partnerName) + ' asked to send its client notifications from <strong>' + escapeHtml(email) + '</strong>.</p>' +
      '<p>If that was you and you manage this mailbox, confirm it:</p>' +
      '<p><a href="' + url + '" style="display:inline-block;background:#0A5C46;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Confirm this address</a></p>' +
      '<p style="color:#8a9a8e;font-size:12px">The link expires in 24 hours. If you didn\'t expect this, ignore it — nothing changes.</p>' +
      '</div>',
  })
}

/** Complete verification from the emailed link. Returns the verified address, or null. */
export async function confirmFromEmail(token: string): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const rec = await (prisma as any).verificationToken.findFirst({ where: { token } })
  if (!rec || !String(rec.identifier).startsWith(IDENT_PREFIX)) return null
  await (prisma as any).verificationToken.delete({ where: { token } }).catch(() => {})
  if (new Date(rec.expires) < new Date()) return null

  const rest = String(rec.identifier).slice(IDENT_PREFIX.length)
  const sep = rest.indexOf(':')
  const partnerAccountId = rest.slice(0, sep)
  const email = rest.slice(sep + 1)
  if (!partnerAccountId || !isAllowedFromEmail(email)) return null

  await (prisma as any).partnerAccount.update({
    where: { id: partnerAccountId },
    data:  { fromEmail: email, fromEmailVerifiedAt: new Date() },
  })
  return email
}
