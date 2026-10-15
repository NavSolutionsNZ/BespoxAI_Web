/**
 * lib/licence-routes.ts
 *
 * Shared GET / POST / DELETE handling for the licence endpoints
 * (/api/admin/licence for Nav Solutions, /api/partner/licence for partners).
 * Callers do the auth and pass the resolved owner.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getLicenceMeta, saveLicence, deleteLicence, licenceKeyConfigured, licenceProblem,
  type LicenceOwnerId,
} from '@/lib/licences'

export async function licenceGet(ownerId: LicenceOwnerId) {
  const meta = await getLicenceMeta(ownerId)
  return NextResponse.json({
    keyConfigured: licenceKeyConfigured(),
    licence: meta,
    problem: licenceProblem(meta),
  })
}

export async function licencePost(req: NextRequest, ownerId: LicenceOwnerId, userId: string) {
  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: 'Expected a multipart upload with a "file" field.' }, { status: 400 })
  }
  const file = form.get('file')
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'No licence file uploaded.' }, { status: 400 })

  const expiresRaw = form.get('expiresAt')
  let expiresAt: Date | null = null
  if (typeof expiresRaw === 'string' && expiresRaw.trim()) {
    const d = new Date(expiresRaw.trim())
    if (isNaN(d.getTime())) return NextResponse.json({ error: 'Expiry date is not a valid date.' }, { status: 400 })
    expiresAt = d
  }

  try {
    const bytes = Buffer.from(await (file as File).arrayBuffer())
    const meta = await saveLicence(ownerId, (file as File).name || 'licence.flf', bytes, userId, expiresAt)
    return NextResponse.json({ licence: meta, problem: licenceProblem(meta) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Upload failed' }, { status: 400 })
  }
}

export async function licenceDelete(ownerId: LicenceOwnerId) {
  const removed = await deleteLicence(ownerId)
  return NextResponse.json({ removed })
}
