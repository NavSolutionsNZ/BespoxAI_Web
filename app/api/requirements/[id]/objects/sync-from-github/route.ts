/**
 * POST /api/requirements/[id]/objects/sync-from-github
 *
 * Superadmin only. Pulls the latest C/AL files from the requirement's GitHub
 * branch (objects/ folder) and upserts them into TenantObjectFile with content,
 * so "Write files to server" picks up developer edits.
 *
 * Returns: { synced: number, files: string[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import { listFiles, getFile }        from '@/lib/github'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

async function getGitHubOwner(): Promise<string> {
  const t = process.env.GITHUB_CUSTOMER_REPOS_TOKEN
  if (!t) throw new Error('GITHUB_CUSTOMER_REPOS_TOKEN not set')
  const res  = await fetch('https://api.github.com/user', {
    headers: {
      Authorization:          `Bearer ${t}`,
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  const data = await res.json()
  if (!(data as any).login) throw new Error('Could not resolve GitHub owner from token')
  return (data as any).login as string
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const requirement = await (prisma as any).requirement.findUnique({
    where:   { id: params.id },
    include: { tenant: { select: { id: true, name: true, githubRepo: true, githubOrg: true } } },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  if (!requirement.githubBranch || !requirement.tenant?.githubRepo)
    return NextResponse.json({
      error: 'No GitHub branch linked to this requirement. Fetch objects from BCAgent first.',
    }, { status: 400 })

  const owner = await getGitHubOwner()
  const repo  = requirement.tenant.githubRepo
  const branch = requirement.githubBranch

  // List files in objects/ on the branch
  const fileList = await listFiles(owner, repo, branch, 'objects')
  if (!fileList.length)
    return NextResponse.json({ error: 'No files found in objects/ folder on branch: ' + branch }, { status: 404 })

  const synced: string[] = []
  const errors: string[] = []

  for (const f of fileList) {
    try {
      const content = await getFile(owner, repo, branch, f.path)
      if (!content) { errors.push(f.name + ': empty'); continue }

      // Parse type/id/name from filename: Type_Id_Name.txt
      const base  = f.name.replace(/\.txt$/i, '')
      const parts = base.split('_')
      const objectType = parts[0] ?? 'Unknown'
      const objectId   = parts.length >= 2 && /^\d+$/.test(parts[1]) ? parseInt(parts[1]) : null
      const objectName = parts.slice(objectId != null ? 2 : 1).join('_') || base

      // Upsert — match on tenantId + objectType + objectId
      const existing = await (prisma as any).tenantObjectFile.findFirst({
        where: {
          tenantId:   requirement.tenant.id,
          objectType,
          ...(objectId != null
            ? { objectId }
            : { objectName }),
        },
        select: { id: true },
      })

      const data = {
        tenantId:      requirement.tenant.id,
        requirementId: params.id,
        filename:      f.name,
        objectType,
        objectId:      objectId ?? null,
        objectName,
        language:      'CAL' as string,
        summary:       { sizeBytes: new TextEncoder().encode(content).length, syncedFromGitHub: true },
        content,
        parseError:    false,
        uploadedById:  (session.user as any).id,
      }

      if (existing) {
        await (prisma as any).tenantObjectFile.update({
          where: { id: existing.id },
          data:  { ...data, uploadedAt: new Date() },
        })
      } else {
        await (prisma as any).tenantObjectFile.create({ data })
      }

      synced.push(f.name)
    } catch (e: any) {
      errors.push(f.name + ': ' + (e.message ?? 'unknown error'))
    }
  }

  return NextResponse.json({
    synced: synced.length,
    files:  synced,
    errors: errors.length ? errors : undefined,
    branch,
    repo,
  })
}
