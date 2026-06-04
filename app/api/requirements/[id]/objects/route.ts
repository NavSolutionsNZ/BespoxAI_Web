import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parseObjectFile } from '@/lib/bc-object-parser'

export const dynamic = 'force-dynamic'

// ── GET /api/requirements/[id]/objects ────────────────────────────────────────
// Returns all parsed object records for this requirement.

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any

  const requirement = await (prisma as any).requirement.findUnique({
    where: { id: params.id },
    select: { tenantId: true },
  })
  if (!requirement) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (user.role !== 'superadmin' && requirement.tenantId !== user.tenantId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rawObjects = await (prisma as any).tenantObjectFile.findMany({
    where:   { requirementId: params.id },
    select:  {
      id: true, filename: true, objectType: true, objectId: true,
      objectName: true, language: true, summary: true, parseError: true,
      uploadedAt: true,
      uploadedBy: { select: { name: true, email: true } },
      content: true,
    },
    orderBy: { uploadedAt: 'asc' },
  })

  const objects = (rawObjects as any[]).map(o => ({
    ...o,
    hasContent: !!o.content,
    content: undefined,
  }))

  return NextResponse.json({ objects })
}

// ── POST /api/requirements/[id]/objects ───────────────────────────────────────
// Two accepted formats:
//
// 1. JSON body (from client-side C/AL split after BCAgent fetch):
//    { objects: [{ objectType, objectId, objectName, language, versionList, content }] }
//    Upserts by tenantId + objectType + objectId — overwrites existing.
//
// 2. multipart/form-data (manual file upload, field name "files"):
//    Parses via bc-object-parser. Original behaviour preserved.
//
// Superadmin only.

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  if (user.role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: {
      tenantId: true, status: true, title: true,
      tenant: { select: { name: true, githubOrg: true, githubRepo: true, partnerAccount: { select: { githubToken: true } } } },
    },
  })
  if (!requirement) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── JSON path: pre-parsed objects from client-side split ──────────────────
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    const inbound = body.objects as Array<{
      objectType:  string
      objectId:    number | null
      objectName:  string
      language:    string
      versionList: string | null
      content:     string
    }>

    if (!inbound?.length)
      return NextResponse.json({ error: 'No objects provided' }, { status: 400 })

    const upserted: any[] = []
    for (const o of inbound) {
      // Parse C/AL content for rich summary (fields, functions, version list)
      let richSummary: Record<string, any> = {}
      if (o.content) {
        try {
          const parsed = parseObjectFile(o.content, `${o.objectType}_${o.objectId}.txt`)
          if (parsed.length > 0 && !parsed[0].parseError) {
            richSummary = parsed[0].summary ?? {}
          }
        } catch { /* parser failure is non-fatal */ }
      }

      // Build summary from parser output + client-extracted metadata
      const summary: Record<string, any> = {
        ...richSummary,
        ...(o.versionList ? { versionList: o.versionList } : {}),
        ...(o.content     ? { sizeBytes: new TextEncoder().encode(o.content).length } : {}),
      }

      // Upsert: match on tenantId + objectType + objectId (or objectName if no id)
      const existing = await (prisma as any).tenantObjectFile.findFirst({
        where: {
          tenantId:   requirement.tenantId,
          objectType: o.objectType,
          ...(o.objectId != null
            ? { objectId: o.objectId }
            : { objectName: o.objectName }),
        },
        select: { id: true },
      })

      let rec: any
      const data = {
        tenantId:      requirement.tenantId,
        requirementId: params.id,
        filename:      `${o.objectType}_${o.objectId ?? o.objectName}.txt`,
        objectType:    o.objectType,
        objectId:      o.objectId ?? null,
        objectName:    o.objectName,
        language:      (o.language ?? 'CAL') as string,
        summary,
        content:       o.content ?? null,
        parseError:    false,
        uploadedById:  (session.user as any).id,
      }

      if (existing) {
        rec = await (prisma as any).tenantObjectFile.update({
          where:  { id: existing.id },
          data:   { ...data, uploadedAt: new Date() },
          select: { id: true, objectType: true, objectId: true, objectName: true, uploadedAt: true },
        })
      } else {
        rec = await (prisma as any).tenantObjectFile.create({
          data,
          select: { id: true, objectType: true, objectId: true, objectName: true, uploadedAt: true },
        })
      }
      upserted.push(rec)
    }

    // Invalidate tenant context cache so new objects appear in AI calls immediately
    const { invalidateTenantContext } = await import('@/lib/tenant-context')
    invalidateTenantContext(requirement.tenantId)

    // Push objects to GitHub
    let githubResult: { org: string; repo: string; branch: string } | null = null
    let githubError: string | null = null
    if (process.env.GITHUB_CUSTOMER_REPOS_TOKEN) {
      const objectsWithContent = inbound.filter(o => o.content)
      if (objectsWithContent.length > 0) {
        try {
          const { pushObjectsToGitHub, resolvePartnerToken } = await import('@/lib/github')
          const partnerGithubToken = await resolvePartnerToken(requirement.tenant.partnerAccount?.githubToken)
          githubResult = await pushObjectsToGitHub({
            tenantName:          requirement.tenant.name,
            tenantGithubOrg:     requirement.tenant.githubOrg,
            partnerGithubToken,
            requirementId:       params.id,
            requirementTitle:    requirement.title,
            objects:             objectsWithContent,
            commitMessage:       `feat: save ${objectsWithContent.length} object${objectsWithContent.length !== 1 ? 's' : ''} to knowledge base`,
          })
          await Promise.all([
            (prisma as any).requirement.update({
              where: { id: params.id },
              data:  { githubBranch: githubResult.branch },
            }),
            requirement.tenant.githubRepo !== githubResult.repo
              ? (prisma as any).tenant.update({
                  where: { id: requirement.tenantId },
                  data:  { githubRepo: githubResult.repo, githubOrg: githubResult.org },
                })
              : Promise.resolve(),
          ])
        } catch (e: any) {
          console.error('[github] push failed:', e)
          githubError = e.message ?? 'GitHub push failed'
        }
      }
    } else {
      githubError = 'GITHUB_CUSTOMER_REPOS_TOKEN not set'
    }

    return NextResponse.json({
      upserted: upserted.length,
      objects: upserted,
      github: githubResult ?? { error: githubError },
    })
  }

  // ── multipart/form-data path: manual file upload (original behaviour) ─────
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const files = formData.getAll('files') as File[]
  if (!files || files.length === 0)
    return NextResponse.json({ error: 'No files provided' }, { status: 400 })

  const created: any[] = []

  for (const file of files) {
    let content: string
    try {
      content = await file.text()
    } catch {
      // Unreadable file — store a parse-error record
      const rec = await (prisma as any).tenantObjectFile.create({
        data: {
          tenantId:      requirement.tenantId,
          requirementId: params.id,
          filename:      file.name,
          objectType:    'Unknown',
          objectId:      null,
          objectName:    file.name,
          language:      'AL',
          summary:       {},
          parseError:    true,
          uploadedById:  user.id,
        },
        select: {
          id: true, filename: true, objectType: true, objectId: true,
          objectName: true, language: true, summary: true, parseError: true,
          uploadedAt: true,
        },
      })
      created.push(rec)
      continue
    }

    // Parse — may return multiple objects for C/AL files
    const parsed = parseObjectFile(content, file.name)

    for (const p of parsed) {
      const rec = await (prisma as any).tenantObjectFile.create({
        data: {
          tenantId:      requirement.tenantId,
          requirementId: params.id,
          filename:      p.filename,
          objectType:    p.objectType,
          objectId:      p.objectId,
          objectName:    p.objectName,
          language:      p.language,
          summary:       p.summary,
          parseError:    p.parseError,
          uploadedById:  user.id,
        },
        select: {
          id: true, filename: true, objectType: true, objectId: true,
          objectName: true, language: true, summary: true, parseError: true,
          uploadedAt: true,
          uploadedBy: { select: { name: true, email: true } },
        },
      })
      created.push(rec)
    }
  }

  // Return the full updated list for this requirement
  const objects = await (prisma as any).tenantObjectFile.findMany({
    where:   { requirementId: params.id },
    select:  {
      id: true, filename: true, objectType: true, objectId: true,
      objectName: true, language: true, summary: true, parseError: true,
      uploadedAt: true,
      uploadedBy: { select: { name: true, email: true } },
    },
    orderBy: { uploadedAt: 'asc' },
  })

  return NextResponse.json({ objects, created: created.length })
}
