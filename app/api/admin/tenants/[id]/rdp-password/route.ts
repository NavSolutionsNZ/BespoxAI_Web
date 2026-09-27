import { NextRequest, NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { decryptRdpPassword, isEncryptedValue, logRdpAccess } from '@/lib/rdp'

export const dynamic = 'force-dynamic'

// POST /api/admin/tenants/[id]/rdp-password — superadmin only.
//
// Decrypts the tenant's remote-support account password on demand. The reveal
// is written to RdpAccessLog before the password is returned; if that write
// fails, nothing is disclosed. POST rather than GET so it is never prefetched
// or cached.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireSuperadmin()
  if (auth instanceof NextResponse) return auth

  const tenant = await (prisma as any).tenant.findFirst({
    where:  { id: params.id },
    select: { id: true, rdpPassword: true },
  })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.rdpPassword || !isEncryptedValue(tenant.rdpPassword)) {
    return NextResponse.json({ error: 'No RDP password stored for this tenant' }, { status: 404 })
  }

  const password = decryptRdpPassword(tenant.rdpPassword)

  await logRdpAccess({
    tenantId:  tenant.id,
    userId:    (auth.user as any).id,
    userEmail: auth.user?.email ?? '',
    action:    'reveal',
  })

  return NextResponse.json({ password }, { headers: { 'Cache-Control': 'no-store' } })
}
