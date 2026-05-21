/**
 * POST /api/requirements/[id]/fetch-objects
 *
 * Superadmin only. Calls the BCAgent /bespoxai/objects/export endpoint for the
 * requirement's tenant and streams the resulting zip directly to the browser.
 *
 * For NAV/BC14: BCAgent runs Export-NAVApplicationObject server-side and returns
 * a zip of the C/AL .txt output. No content stored here — client-side split picks
 * objects to save via POST /api/requirements/[id]/objects (JSON path).
 *
 * For BC (AL, v15+): fetches extensions + web services metadata from the BC
 * Automation API and returns a formatted text zip.
 *
 * Body: { objects: Array<{ type: string; id: number }> }
 *       type = "Table" | "Codeunit" | "Page" | "Report" | "XMLport" | "Query"
 *
 * maxDuration: 60s (Hobby plan). Spec-driven filters (10-30 objects) complete in
 * ~10-20s. Bump to 300 after upgrading to Vercel Pro.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60  // bump to 300 on Vercel Pro

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── Load requirement → derive tenant (never use session tenant) ────────────
  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: { tenantId: true },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: requirement.tenantId },
    select: {
      id: true, name: true, tunnelSubdomain: true, apiKey: true,
      navProduct: true, navDatabaseName: true,
    },
  })
  if (!tenant)
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.tunnelSubdomain)
    return NextResponse.json({ error: 'No tunnel configured for this tenant' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const { objects } = body as { objects?: Array<{ type: string; id: number }> }

  const agentBase = `https://${tenant.tunnelSubdomain}-agent.bespoxai.com`

  // ── NAV / BC14 path ────────────────────────────────────────────────────────
  if (tenant.navProduct === 'NAV' || tenant.navProduct === null) {
    if (!objects || objects.length === 0)
      return NextResponse.json({ error: 'No objects specified' }, { status: 400 })

    if (!tenant.navDatabaseName)
      return NextResponse.json({
        error: 'NAV database name not configured. Add it in the BC Installer tab and regenerate the installer.',
      }, { status: 400 })

    if (objects.length > 50)
      return NextResponse.json({
        error: `Too many objects (${objects.length}). Select 50 or fewer per fetch to stay within the 60s timeout.`,
      }, { status: 400 })

    const agentRes = await fetch(`${agentBase}/bespoxai/objects/export`, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-BespoxAI-Key':  tenant.apiKey,
      },
      body: JSON.stringify({ objects }),
    })

    if (!agentRes.ok) {
      let msg = `BCAgent returned ${agentRes.status}`
      try {
        const err = await agentRes.json()
        msg = err.error ?? msg
      } catch {}
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    // Stream zip straight to browser
    return new NextResponse(agentRes.body, {
      status: 200,
      headers: {
        'Content-Type':        'application/zip',
        'Content-Disposition': 'attachment; filename="nav-objects.zip"',
        'X-Tenant-Name':       tenant.name,
        'X-Object-Count':      String(objects.length),
      },
    })
  }

  // ── BC (AL, v15+) path — metadata only ────────────────────────────────────
  const results: string[] = [
    `BespoxAI — BC Metadata Export`,
    `Tenant: ${tenant.name}`,
    `Exported: ${new Date().toISOString()}`,
    ``,
    `${'='.repeat(60)}`,
    `INSTALLED EXTENSIONS`,
    `${'='.repeat(60)}`,
  ]

  try {
    const extUrl = `${agentBase}/api/v2.0/extensions?$top=100`
    const extRes = await fetch(extUrl, { headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/json' } })
    if (extRes.ok) {
      const extData = await extRes.json()
      const exts = extData.value ?? []
      for (const e of exts) {
        results.push(`${e.displayName ?? e.name} | Publisher: ${e.publisher} | Version: ${e.versionMajor}.${e.versionMinor}.${e.versionBuild} | ID: ${e.packageId}`)
      }
      results.push(``, `Total extensions: ${exts.length}`)
    }
  } catch {
    results.push('(Could not fetch extensions — check BC connection)')
  }

  results.push(``, `${'='.repeat(60)}`, `PUBLISHED WEB SERVICES`, `${'='.repeat(60)}`)

  try {
    const wsUrl = `${agentBase}/api/v2.0/webServices?$top=200`
    const wsRes = await fetch(wsUrl, { headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/json' } })
    if (wsRes.ok) {
      const wsData = await wsRes.json()
      const svcs = wsData.value ?? []
      for (const w of svcs) {
        results.push(`${w.objectType} ${w.objectId} "${w.objectName}" → Service: ${w.serviceName}`)
      }
      results.push(``, `Total web services: ${svcs.length}`)
    }
  } catch {
    results.push('(Could not fetch web services)')
  }

  const txt = results.join('\n')

  // Return as a zip for consistent handling in the client
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('bc-metadata.txt', txt)
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  return new NextResponse(zipBuf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': 'attachment; filename="bc-metadata.zip"',
      'X-Tenant-Name':       tenant.name,
    },
  })
}
