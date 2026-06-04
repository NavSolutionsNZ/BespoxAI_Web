/**
 * lib/github.ts
 *
 * GitHub integration for BespoxAI customer repos.
 *
 * Each customer gets a private repo under the NavSolutionsNZ org (or their own
 * org if configured). Fetched C/AL objects are stored per-requirement on a
 * dedicated branch, providing version history, diffs, and a working surface
 * for the AI coding assistant.
 *
 * Repo naming:   bespoxai-{tenantSlug}
 * Branch naming: req/{requirementId}-{title-slug}
 * Default org:   NavSolutionsNZ
 *
 * Required env var: GITHUB_CUSTOMER_REPOS_TOKEN (classic PAT, repo scope)
 *
 * API used: GitHub REST v3 (no SDK — keeps the bundle lean)
 */

const GITHUB_API  = 'https://api.github.com'
const DEFAULT_ORG = 'NavSolutionsNZ'

function token(override?: string | null): string {
  if (override) return override
  const t = process.env.GITHUB_CUSTOMER_REPOS_TOKEN
  if (!t) throw new Error('GITHUB_CUSTOMER_REPOS_TOKEN env var not set')
  return t
}

/**
 * Resolve the GitHub token for a partner account.
 * Decrypts the stored AES-256-GCM token if present; falls back to the
 * environment variable token otherwise.
 */
export async function resolvePartnerToken(encryptedToken: string | null | undefined): Promise<string | null> {
  if (!encryptedToken) return null
  try {
    const { decryptToken } = await import('@/lib/crypto')
    return decryptToken(encryptedToken)
  } catch (e) {
    console.error('[github] failed to decrypt partner token:', e)
    return null
  }
}

function headers(extra: Record<string, string> = {}, tokenOverride?: string | null): Record<string, string> {
  return {
    Authorization:        `Bearer ${token(tokenOverride)}`,
    Accept:               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':       'application/json',
    ...extra,
  }
}

// ── Slug helpers ──────────────────────────────────────────────────────────────

export function tenantSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function requirementSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function repoName(tenantName: string): string {
  return `bespoxai-${tenantSlug(tenantName)}`
}

export function branchName(requirementId: string, title: string): string {
  return `req/${requirementId.slice(0, 8)}-${requirementSlug(title)}`
}

// ── Repo management ───────────────────────────────────────────────────────────

/**
 * Ensure a private repo exists for this tenant.
 * Returns the repo name. Creates it if absent.
 * org defaults to NavSolutionsNZ; pass tenant.githubOrg to override.
 */
export async function ensureRepo(
  tenantName: string,
  org: string = DEFAULT_ORG,
  tokenOverride?: string | null,
): Promise<{ repo: string; owner: string }> {
  const repo = repoName(tenantName)

  // Get authenticated user (repo lives under personal account)
  const meRes = await fetch(`${GITHUB_API}/user`, { headers: headers({}, tokenOverride) })
  const me    = await meRes.json()
  const owner = (me as any).login as string
  if (!owner) throw new Error('Could not determine GitHub user from token')

  // Check if repo already exists under owner
  const check = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: headers({}, tokenOverride),
  })

  if (check.status === 200) return { repo, owner } // already exists

  if (check.status !== 404) {
    const err = await check.json().catch(() => ({}))
    throw new Error(`GitHub repo check failed: ${check.status} — ${(err as any).message ?? ''}`)
  }

  // Create under authenticated user (works with repo-scoped PAT without org admin rights)
  const create = await fetch(`${GITHUB_API}/user/repos`, {
    method: 'POST',
    headers: headers({}, tokenOverride),
    body: JSON.stringify({
      name:        repo,
      description: `BespoxAI — ${tenantName} BC/NAV object repository`,
      private:     true,
      auto_init:   true, // creates main branch with README
    }),
  })

  if (!create.ok) {
    const err = await create.json().catch(() => ({}))
    throw new Error(`Failed to create GitHub repo: ${create.status} — ${(err as any).message ?? ''}`)
  }

  // Brief pause to let GitHub initialise the repo before we try to use it
  await new Promise(r => setTimeout(r, 1500))

  return { repo, owner }
}

// ── Branch management ─────────────────────────────────────────────────────────

/**
 * Get the SHA of the HEAD commit on a branch (or main if not found).
 */
async function getBranchSha(org: string, repo: string, branch: string, tokenOverride?: string | null): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${org}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    { headers: headers({}, tokenOverride) },
  )
  if (!res.ok) return null
  const data = await res.json()
  return (data as any).object?.sha ?? null
}

/**
 * Ensure a branch exists for this requirement.
 * Branches from main if it doesn't exist yet.
 * Returns the branch name.
 */
export async function ensureBranch(
  org: string,
  repo: string,
  branch: string,
  tokenOverride?: string | null,
): Promise<string> {
  const existing = await getBranchSha(org, repo, branch, tokenOverride)
  if (existing) return branch

  // Get main SHA to branch from
  const mainSha = await getBranchSha(org, repo, 'main', tokenOverride)
  if (!mainSha) throw new Error(`Could not find main branch SHA in ${org}/${repo}`)

  const res = await fetch(`${GITHUB_API}/repos/${org}/${repo}/git/refs`, {
    method:  'POST',
    headers: headers({}, tokenOverride),
    body:    JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Failed to create branch ${branch}: ${res.status} — ${(err as any).message ?? ''}`)
  }

  return branch
}

// ── File operations ───────────────────────────────────────────────────────────

export interface GitHubFile {
  path:    string   // e.g. "objects/Codeunit_80_Sales-Post.txt"
  content: string   // raw text content
}

/**
 * Push one or more files to a branch.
 * Creates or updates each file. Uses the Contents API (one call per file).
 * For small numbers of objects (handful per req) this is fine.
 */
export async function pushFiles(
  org: string,
  repo: string,
  branch: string,
  files: GitHubFile[],
  commitMessage: string,
  tokenOverride?: string | null,
): Promise<void> {
  for (const file of files) {
    // Check if file exists (need its SHA to update)
    const existing = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}/contents/${file.path}?ref=${encodeURIComponent(branch)}`,
      { headers: headers({}, tokenOverride) },
    )

    const body: Record<string, any> = {
      message: commitMessage,
      content: Buffer.from(file.content, 'utf8').toString('base64'),
      branch,
    }

    if (existing.ok) {
      const data = await existing.json()
      body.sha = (data as any).sha // required for updates
    }

    const res = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}/contents/${file.path}`,
      { method: 'PUT', headers: headers({}, tokenOverride), body: JSON.stringify(body) },
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Failed to push ${file.path}: ${res.status} — ${(err as any).message ?? ''}`)
    }
  }
}

/**
 * Get the text content of a single file from a branch.
 * Returns null if the file doesn't exist.
 */
export async function getFile(
  org: string,
  repo: string,
  branch: string,
  path: string,
  tokenOverride?: string | null,
): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${org}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: headers({}, tokenOverride) },
  )
  if (!res.ok) return null
  const data = await res.json()
  const encoded = (data as any).content as string | undefined
  if (!encoded) return null
  return Buffer.from(encoded.replace(/\n/g, ''), 'base64').toString('utf8')
}

/**
 * List files in a directory on a branch.
 * Returns array of { path, name, size, sha }.
 */
export async function listFiles(
  org: string,
  repo: string,
  branch: string,
  dirPath: string = 'objects',
  tokenOverride?: string | null,
): Promise<Array<{ path: string; name: string; size: number; sha: string }>> {
  const res = await fetch(
    `${GITHUB_API}/repos/${org}/${repo}/contents/${dirPath}?ref=${encodeURIComponent(branch)}`,
    { headers: headers({}, tokenOverride) },
  )
  if (res.status === 404) return []
  if (!res.ok) return []
  const data = await res.json()
  if (!Array.isArray(data)) return []
  return (data as any[])
    .filter(f => f.type === 'file')
    .map(f => ({ path: f.path, name: f.name, size: f.size, sha: f.sha }))
}

// ── High-level workflow helpers ───────────────────────────────────────────────

export interface PushObjectsParams {
  tenantName:           string
  tenantGithubOrg?:     string | null
  partnerGithubToken?:  string | null   // decrypted partner token; falls back to env var
  requirementId:        string
  requirementTitle:     string
  objects: Array<{
    objectType: string
    objectId:   number | null
    objectName: string
    content:    string
  }>
  commitMessage?: string
}

/**
 * Full workflow: ensure repo → ensure branch → push object files.
 * Returns { org, repo, branch } for storing on the requirement record.
 *
 * Object files are stored under objects/ in the branch:
 *   objects/Codeunit_80_Sales-Post.txt
 *   objects/Table_50100_Custom-Approval-Entry.txt
 */
export async function pushObjectsToGitHub(params: PushObjectsParams): Promise<{
  org:    string
  repo:   string
  branch: string
}> {
  const tok = params.partnerGithubToken ?? null
  const { repo, owner } = await ensureRepo(params.tenantName, params.tenantGithubOrg || DEFAULT_ORG, tok)
  const branch          = branchName(params.requirementId, params.requirementTitle)

  await ensureBranch(owner, repo, branch, tok)

  const files: GitHubFile[] = params.objects.map(o => ({
    path:    `objects/${o.objectType}_${o.objectId ?? 'X'}_${o.objectName.replace(/[^a-zA-Z0-9_\-. ]/g, '_')}.txt`,
    content: o.content,
  }))

  const msg = params.commitMessage ?? `chore: fetch ${files.length} object${files.length !== 1 ? 's' : ''} for requirement ${params.requirementId.slice(0, 8)}`

  await pushFiles(owner, repo, branch, files, msg, tok)

  return { org: owner, repo, branch }
}
