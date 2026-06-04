/**
 * POST /api/requirements/[id]/coding-assistant/commit
 *
 * Commits accepted C/AL code back to the requirement's GitHub branch.
 * Called when a developer accepts an AI-generated or modified object.
 *
 * Body: { filename: string, content: string, commitMessage?: string }
 *
 * Superadmin and developer roles only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import { pushFiles, resolvePartnerToken } from '@/lib/github'

export const dynamic = 'force-dynamic'

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
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  const role    = (session?.user as any)?.role
  if (!session?.user || !['superadmin', 'developer'].includes(role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { filename, content, commitMessage } = await req.json()
  if (!filename?.trim() || !content?.trim())
    return NextResponse.json({ error: 'filename and content are required' }, { status: 400 })

  const requirement = await (prisma as any).requirement.findUnique({
    where:   { id: params.id },
    include: { tenant: { include: { partnerAccount: { select: { githubToken: true } } } } },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!requirement.githubBranch || !requirement.tenant?.githubRepo)
    return NextResponse.json({ error: 'No GitHub branch linked to this requirement' }, { status: 400 })

  try {
    const partnerToken = await resolvePartnerToken(requirement.tenant?.partnerAccount?.githubToken)
    const owner  = await getGitHubOwner(partnerToken)
    const repo   = requirement.tenant.githubRepo
    const branch = requirement.githubBranch

    // Normalise filename — strip any path prefix, keep under objects/
    const safeName = filename.replace(/^objects\//, '').replace(/[^a-zA-Z0-9_\-. ]/g, '_')
    const path     = `objects/${safeName}`

    const msg = commitMessage?.trim() || `chore: update ${safeName} via Coding Assistant`

    await pushFiles(owner, repo, branch, [{ path, content }], msg, partnerToken)

    return NextResponse.json({ ok: true, path, branch })
  } catch (e: any) {
    console.error('[coding-assistant/commit]', e)
    return NextResponse.json({ error: e.message ?? 'Commit failed' }, { status: 500 })
  }
}
