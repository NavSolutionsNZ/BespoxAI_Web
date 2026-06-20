/**
 * POST /api/partner/tenants/[id]/requirements/[reqId]/objects/sync-from-github
 *
 * Partner-deliverer equivalent of the direct
 * /api/requirements/[id]/objects/sync-from-github.
 *
 * Pulls the latest C/AL files from the requirement's GitHub branch (objects/
 * folder) and upserts them into TenantObjectFile with content, so the partner's
 * "Write files to server" step picks up the latest committed objects.
 *
 * Auth: requirePartnerSession + assertTenantBelongsToPartner + assertPartnerCanDevelop.
 * GitHub token resolved from the partner account (partner org → BespoxAI fallback).
 *
 * Returns: { synced: number, files: string[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  requirePartnerSession,
  assertTenantBelongsToPartner,
  assertPartnerCanDevelop,
} from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import { listFiles, getFile, resolvePartnerToken } from '@/lib/github'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

async function getGitHubOwner(tokenOverride?: string | null): Promise<string> {
  const t = tokenOverride ?? process.env.GITHUB_CUSTOMER_REPOS_TOKEN
  if (!t) throw new Error('GITHUB_CUSTOMER_REPOS_TOKEN not set')
  const res  = await fetch('https://api.github.com/user', {
    headers: {
      Authorization:          'Bearer ' + t,
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
  { params }: { params: { id: string; reqId: string } }
) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  try {
    await assertPartnerCanDevelop(session.partnerAccountId)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Forbidden' }, { status: 403 })
  }

  const requirement = await (prisma as any).requirement.findFirst({
    where:   { id: params.reqId, tenantId: params.id },
    include: { tenant: { select: { id: true, name: true, githubRepo: true, githubOrg: true, partnerAccount: { select: { githubToken: true } } } } },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  if (!requirement.githubBranch || !requirement.tenant?.githubRepo)
    return NextResponse.json({
      error: 'No GitHub branch linked to this requirement. Commit objects via the coding assistant first.',
    }, { status: 400 })

  const partnerToken = await resolvePartnerToken(requirement.tenant.partnerAccount?.githubToken)
  const owner = await getGitHubOwner(partnerToken)
  const repo  = requirement.tenant.githubRepo
  const branch = requirement.githubBranch

  const fileList = await listFiles(owner, repo, branch, 'objects', partnerToken)
  if (!fileList.length)
    return NextResponse.json({ error: 'No files found in objects/ folder on branch: ' + branch }, { status: 404 })

  const synced: string[] = []
  const errors: string[] = []

  for (const f of fileList) {
    try {
      const content = await getFile(owner, repo, branch, f.path, partnerToken)
      if (!content) { errors.push(f.name + ': empty'); continue }

      const base  = f.name.replace(/\.txt$/i, '')
      const parts = base.split('_')
      const objectType = parts[0] ?? 'Unknown'
      const objectId   = parts.length >= 2 && /^\d+$/.test(parts[1]) ? parseInt(parts[1]) : null
      const objectName = parts.slice(objectId != null ? 2 : 1).join('_') || base

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
        requirementId: params.reqId,
        filename:      f.name,
        objectType,
        objectId:      objectId ?? null,
        objectName,
        language:      'CAL' as string,
        summary:       { sizeBytes: new TextEncoder().encode(content).length, syncedFromGitHub: true },
        content,
        parseError:    false,
        uploadedById:  session.userId,
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
