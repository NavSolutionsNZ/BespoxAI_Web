/**
 * lib/licence-rules.ts — pure rules for export licences (no database, no crypto).
 */

export const MAX_LICENCE_BYTES = 512 * 1024
const ALLOWED_EXT = /\.(flf|bclicense)$/i

/** null = Nav Solutions Limited */
export type LicenceOwnerId = string | null

export interface LicenceMeta {
  fileName:     string
  sizeBytes:    number
  sha256:       string
  expiresAt:    Date | null
  uploadedById: string
  uploadedAt:   Date
}

/** The licence that runs a tenant's export: the managing partner's, or Nav Solutions' for direct tenants. */
export function licenceOwnerForTenant(tenant: { partnerAccountId: string | null }): LicenceOwnerId {
  return tenant.partnerAccountId ?? null
}

export function validateLicenceUpload(fileName: string, bytes: Buffer): string | null {
  if (!ALLOWED_EXT.test(fileName)) return 'Licence file must be a .flf (or .bclicense) file.'
  if (bytes.length === 0) return 'Licence file is empty.'
  if (bytes.length > MAX_LICENCE_BYTES) return 'Licence file is larger than 512 KB — is this the right file?'
  return null
}

/** Why this owner's licence can't be used right now, or null if it can. */
export function licenceProblem(meta: LicenceMeta | null, at: Date = new Date()): string | null {
  if (!meta) return 'No developer licence has been uploaded for this partner.'
  if (meta.expiresAt && meta.expiresAt.getTime() < at.getTime()) return 'The developer licence expired on ' + meta.expiresAt.toISOString().slice(0, 10) + '.'
  return null
}
