import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parseObjectFile } from '@/lib/bc-object-parser'
import { objectInventory } from '@/lib/bc-retrieval'

export const dynamic = 'force-dynamic'

// Node runtime + generous body handling: full C/AL exports are large
export const maxDuration = 300

// ── GET /api/tenants/[id]/objects ─────────────────────────────────────────────
// Environment index inventory: object counts, customisation stats, known tags.

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  if (user.role !== 'superadmin' && user.tenantId !== params.id)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenant = await (prisma as any).tenant.findUnique({
    where: { id: params.id }, select: { id: true, name: true },
  })
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const inventory = await objectInventory(params.id)
  return NextResponse.json({ tenant: tenant.name, ...inventory })
}

// ── POST /api/tenants/[id]/objects ────────────────────────────────────────────
// Ingest a whole-environment object export (superadmin only).
//
// Accepted formats:
//   1. JSON:      { files: [{ filename, content }], pushToGitHub?: boolean }
//   2. multipart: field "files" (one or many), optional field pushToGitHub=true
//
// Each file is parsed (C/AL multi-object exports are split automatically),
// then upserted into TenantObjectFile matched on tenantId + objectType +
// objectId (or objectName when no id) — the same identity rule the
// per-requirement route uses, so environment refreshes update per-requirement
// rows in place without losing their requirement association.
//
// New objects are created environment-scoped (requirementId = null).
//
// With pushToGitHub, the RAW uploaded export files (not one file per object)
// are committed to the tenant repo on the `environment/main` branch —
// full-export provenance and diff history without thousands of API calls.

interface InboundFile { filename: string; content: string }

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  if (user.role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: params.id },
    select: {
      id: true, name: true, githubOrg: true, githubRepo: true,
      partnerAccount: { select: { githubToken: true } },
    },
  })
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── Read inbound files ─────────────────────────────────────────────────────
  const files: InboundFile[] = []
  let pushToGitHub = false

  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    pushToGitHub = !!body.pushToGitHub
    for (const f of body.files ?? []) {
      if (f?.filename && typeof f.content === 'string') files.push({ filename: f.filename, content: f.content })
    }
  } else if (ct.includes('multipart/form-data')) {
    const form = await req.formData()
    pushToGitHub = form.get('pushToGitHub') === 'true'
    for (const entry of form.getAll('files')) {
      if (entry instanceof File) {
        files.push({ filename: entry.name, content: await entry.text() })
      }
    }
  } else {
    return NextResponse.json({ error: 'Send JSON { files: [...] } or multipart form-data with "files"' }, { status: 400 })
  }

  if (files.length === 0)
    return NextResponse.json({ error: 'No files provided' }, { status: 400 })

  // ── Parse & upsert ─────────────────────────────────────────────────────────
  let created = 0, updated = 0, parseErrors = 0
  const errors: string[] = []

  for (const file of files) {
    let parsedObjects
    try {
      parsedObjects = parseObjectFile(file.content, file.filename)
    } catch (e: any) {
      parseErrors++
      errors.push(`${file.filename}: ${e?.message ?? 'parse failed'}`)
      continue
    }

    // For multi-object C/AL exports, re-split so each row stores its own source
    const blocks = parsedObjects.length > 1
      ? file.content.split(/(?=^OBJECT\s)/m).map(s => s.trim()).filter(Boolean)
      : [file.content]

    for (let i = 0; i < parsedObjects.length; i++) {
      const obj = parsedObjects[i]
      if (obj.parseError) { parseErrors++; continue }

      const content = blocks[i] ?? file.content
      const sizeBytes = new TextEncoder().encode(content).length

      const existing = await (prisma as any).tenantObjectFile.findFirst({
        where: {
          tenantId:   params.id,
          objectType: obj.objectType,
          ...(obj.objectId != null
            ? { objectId: obj.objectId }
            : { objectName: obj.objectName }),
        },
        select: { id: true },
      })

      const rowData = {
        filename:     `${obj.objectType}_${obj.objectId ?? obj.objectName}.${obj.language === 'AL' ? 'al' : 'txt'}`,
        objectType:   obj.objectType,
        objectId:     obj.objectId,
        objectName:   obj.objectName,
        language:     obj.language,
        summary:      { ...obj.summary, sizeBytes },
        content,
        parseError:   false,
        uploadedById: user.id,
      }

      if (existing) {
        // Environment refresh updates content in place; requirementId untouched
        await (prisma as any).tenantObjectFile.update({
          where: { id: existing.id },
          data:  { ...rowData, uploadedAt: new Date() },
        })
        updated++
      } else {
        await (prisma as any).tenantObjectFile.create({
          data: { ...rowData, tenantId: params.id, requirementId: null },
        })
        created++
      }
    }
  }

  // Environment changed — refresh the AI context cache
  const { invalidateTenantContext } = await import('@/lib/tenant-context')
  invalidateTenantContext(params.id)

  // ── Optional: push raw export files to environment/main ────────────────────
  let githubResult: { org: string; repo: string; branch: string } | null = null
  let githubError:  string | null = null

  if (pushToGitHub) {
    if (!process.env.GITHUB_CUSTOMER_REPOS_TOKEN && !tenant.partnerAccount?.githubToken) {
      githubError = 'GITHUB_CUSTOMER_REPOS_TOKEN not set'
    } else {
      try {
        const { ensureRepo, ensureBranch, pushFiles, resolvePartnerToken } = await import('@/lib/github')
        const partnerToken = await resolvePartnerToken(tenant.partnerAccount?.githubToken)
        const { repo, owner } = await ensureRepo(tenant.name, tenant.githubOrg ?? undefined, partnerToken)
        const branch = await ensureBranch(owner, repo, 'environment/main', partnerToken)
        await pushFiles(
          owner, repo, branch,
          files.map(f => ({ path: `environment/${f.filename}`, content: f.content })),
          `chore: environment export refresh (${files.length} file${files.length !== 1 ? 's' : ''})`,
          partnerToken,
        )
        githubResult = { org: owner, repo, branch }
        if (tenant.githubRepo !== repo) {
          await (prisma as any).tenant.update({
            where: { id: params.id },
            data:  { githubRepo: repo, githubOrg: owner },
          })
        }
      } catch (e: any) {
        console.error('[env-ingest] GitHub push failed:', e)
        githubError = e?.message ?? 'GitHub push failed'
      }
    }
  }

  const inventory = await objectInventory(params.id)

  return NextResponse.json({
    ingested: { files: files.length, created, updated, parseErrors, errors: errors.slice(0, 20) },
    github:   githubResult,
    githubError,
    inventory,
  })
}
