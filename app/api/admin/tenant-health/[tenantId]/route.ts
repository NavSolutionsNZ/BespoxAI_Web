import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(_req: Request, props: { params: Promise<{ tenantId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId } })
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const agentBase = `https://${tenant.tunnelSubdomain}-agent.bespoxai.com`
  const start = Date.now()

  try {
    const res = await fetch(`${agentBase}/health`, {
      headers: { 'X-BespoxAI-Key': tenant.apiKey },
      signal: AbortSignal.timeout(8_000),
    })
    const latencyMs = Date.now() - start
    const data = await res.json().catch(() => ({}))
    return NextResponse.json({ ok: res.ok, latencyMs, detail: data })
  } catch (err: any) {
    return NextResponse.json({ ok: false, latencyMs: Date.now() - start, error: err.message })
  }
}
