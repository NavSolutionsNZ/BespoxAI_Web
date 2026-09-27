// lib/rdp.ts — the BCAgent remote-support (RDP) account password.
//
// The installer creates a local Windows account in the Administrators group on
// the customer's BC server, using this password. It is stored AES-256-GCM
// encrypted under its own key, and the plaintext only ever exists in the
// generated installer and in a logged, superadmin-only reveal
// (app/api/admin/tenants/[id]/rdp-password).

import crypto from 'crypto'
import { prisma } from './db'
import { encryptWithKeyEnv, decryptWithKeyEnv, isEncryptedValue } from './crypto'

const KEY_ENV = 'RDP_PASSWORD_ENCRYPTION_KEY'

// Kill switch lives in ./rdp-flags so client components can import it too.
export { RDP_PROVISIONING_ENABLED, RDP_PROVISIONING_DISABLED_MESSAGE } from './rdp-flags'

export function generateRdpPassword(): string {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower   = 'abcdefghjkmnpqrstuvwxyz'
  const digits  = '23456789'
  const symbols = '!@#$'
  const all     = upper + lower + digits + symbols
  const bytes   = crypto.randomBytes(12)
  // Guarantee complexity: 1 upper, 1 lower, 1 digit, 1 symbol + 8 random
  const pwd = [
    upper[bytes[0]  % upper.length],
    lower[bytes[1]  % lower.length],
    digits[bytes[2] % digits.length],
    symbols[bytes[3] % symbols.length],
    ...Array.from(bytes.slice(4)).map(b => all[b % all.length]),
  ]
  // Fisher-Yates shuffle
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]]
  }
  return pwd.join('')
}

/**
 * Return the plaintext support-account password to embed in an installer,
 * creating and storing (encrypted) a new one if none exists.
 *
 * A stored value that isn't in encrypted form (legacy plaintext) is never
 * reused — it's replaced. That's safe because the installer resets the
 * account's password every time it runs.
 */
export async function getOrCreateRdpPassword(
  tenantId: string,
  stored: string | null | undefined,
): Promise<string> {
  if (stored && isEncryptedValue(stored)) return decryptWithKeyEnv(stored, KEY_ENV)

  const plain = generateRdpPassword()
  await (prisma as any).tenant.update({
    where: { id: tenantId },
    data:  { rdpPassword: encryptWithKeyEnv(plain, KEY_ENV) },
  })
  return plain
}

/** Decrypt a stored password. Any caller that hands the result to a person must logRdpAccess(). */
export function decryptRdpPassword(stored: string): string {
  return decryptWithKeyEnv(stored, KEY_ENV)
}

// Every path that gives a person the plaintext password is recorded:
//   'reveal'             — superadmin reveal endpoint
//   'installer_download' — the password is embedded in the downloaded installer script
// Consent changes are recorded in the same log as evidence of the customer's decision:
//   'consent_granted' / 'consent_withdrawn'
// Callers await this *before* returning the password, so if the audit write
// fails the password is not disclosed.
export type RdpAccessAction = 'reveal' | 'installer_download' | 'consent_granted' | 'consent_withdrawn'

export async function logRdpAccess(entry: {
  tenantId:  string
  userId:    string
  userEmail: string
  action:    RdpAccessAction
}): Promise<void> {
  await (prisma as any).rdpAccessLog.create({ data: entry })
}

export { isEncryptedValue }

/**
 * Record the customer's decision on remote support access. Only a customer's
 * tenant admin may call this path — callers must enforce that.
 *
 * Granting stamps who and when. Withdrawing clears consent and the stored
 * password, so nothing can be revealed and the next installer run removes the
 * support account from the server. The change and its audit row are written in
 * one transaction. Returns the resulting rdpConsentAt (null when withdrawn).
 */
export async function setRdpConsent(args: {
  tenantId:  string
  userId:    string
  userEmail: string
  granted:   boolean
}): Promise<Date | null> {
  const { tenantId, userId, userEmail, granted } = args
  const current = await (prisma as any).tenant.findFirst({
    where:  { id: tenantId },
    select: { rdpConsentAt: true },
  })
  if (!current) throw new Error('Tenant not found')
  if (!!current.rdpConsentAt === granted) return current.rdpConsentAt ?? null   // no change, no log

  const rdpConsentAt = granted ? new Date() : null
  await (prisma as any).$transaction([
    (prisma as any).tenant.update({
      where: { id: tenantId },
      data:  granted
        ? { rdpConsentAt, rdpConsentByUserId: userId }
        : { rdpConsentAt: null, rdpConsentByUserId: null, rdpPassword: null },
    }),
    (prisma as any).rdpAccessLog.create({
      data: { tenantId, userId, userEmail, action: granted ? 'consent_granted' : 'consent_withdrawn' },
    }),
  ])
  return rdpConsentAt
}
