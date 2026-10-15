/**
 * lib/licences.ts
 *
 * Developer licences used by BCAgent full object exports (design §14).
 * One licence per partner account, plus one for Nav Solutions Limited
 * (ownerId = null). Licence bytes are AES-256-GCM encrypted with
 * LICENCE_ENCRYPTION_KEY and are only ever decrypted to hand to the agent
 * for a specific export job — never returned to a browser.
 */

import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { encryptWithKeyEnv, decryptWithKeyEnv } from '@/lib/crypto'
import {
  validateLicenceUpload, type LicenceOwnerId, type LicenceMeta,
} from '@/lib/licence-rules'

export * from '@/lib/licence-rules'

export const LICENCE_KEY_ENV = 'LICENCE_ENCRYPTION_KEY'

export function licenceKeyConfigured(): boolean {
  const raw = process.env[LICENCE_KEY_ENV]
  return !!raw && /^[0-9a-f]{64}$/i.test(raw)
}

function ownerWhere(ownerId: LicenceOwnerId) {
  return { partnerAccountId: ownerId }
}

export async function getLicenceMeta(ownerId: LicenceOwnerId): Promise<LicenceMeta | null> {
  const row = await (prisma as any).partnerLicence.findFirst({
    where:  ownerWhere(ownerId),
    select: { fileName: true, sizeBytes: true, sha256: true, expiresAt: true, uploadedById: true, uploadedAt: true },
  })
  return row ?? null
}

export async function saveLicence(
  ownerId: LicenceOwnerId,
  fileName: string,
  bytes: Buffer,
  uploadedById: string,
  expiresAt: Date | null,
): Promise<LicenceMeta> {
  if (!licenceKeyConfigured()) throw new Error(LICENCE_KEY_ENV + ' is not configured on the server.')
  const problem = validateLicenceUpload(fileName, bytes)
  if (problem) throw new Error(problem)

  const data = {
    fileName:  fileName.replace(/[^\w.\- ]/g, '_').slice(0, 120),
    sizeBytes: bytes.length,
    sha256:    createHash('sha256').update(bytes).digest('hex'),
    encrypted: encryptWithKeyEnv(bytes.toString('base64'), LICENCE_KEY_ENV),
    expiresAt,
    uploadedById,
    uploadedAt: new Date(),
  }
  const existing = await (prisma as any).partnerLicence.findFirst({ where: ownerWhere(ownerId), select: { id: true } })
  const row = existing
    ? await (prisma as any).partnerLicence.update({ where: { id: existing.id }, data })
    : await (prisma as any).partnerLicence.create({ data: { ...data, partnerAccountId: ownerId } })
  return {
    fileName: row.fileName, sizeBytes: row.sizeBytes, sha256: row.sha256,
    expiresAt: row.expiresAt, uploadedById: row.uploadedById, uploadedAt: row.uploadedAt,
  }
}

export async function deleteLicence(ownerId: LicenceOwnerId): Promise<boolean> {
  const res = await (prisma as any).partnerLicence.deleteMany({ where: ownerWhere(ownerId) })
  return res.count > 0
}

/** Server-only: decrypted licence bytes for an export job. */
export async function loadLicenceBytes(ownerId: LicenceOwnerId): Promise<{ bytes: Buffer; sha256: string } | null> {
  const row = await (prisma as any).partnerLicence.findFirst({
    where:  ownerWhere(ownerId),
    select: { encrypted: true, sha256: true, expiresAt: true },
  })
  if (!row) return null
  const bytes = Buffer.from(decryptWithKeyEnv(row.encrypted, LICENCE_KEY_ENV), 'base64')
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== row.sha256) throw new Error('Stored licence failed its integrity check.')
  return { bytes, sha256: row.sha256 }
}

