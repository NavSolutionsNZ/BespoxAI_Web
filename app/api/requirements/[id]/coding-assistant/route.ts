/**
 * POST /api/requirements/[id]/coding-assistant
 *
 * Streaming AI coding assistant for in_development requirements.
 * Loads the full C/AL source from the requirement's GitHub branch and injects
 * it into the system prompt so the AI can read, modify, and write real NAV code.
 *
 * Accepts { message, history }
 * history = [{ role: 'user'|'assistant', content: string }]
 *
 * Superadmin and developer roles only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import { getAiConfig }               from '@/lib/ai-config'
import { logAiUsage }                from '@/lib/ai-usage'
import { buildTenantContext }        from '@/lib/tenant-context'
import { listFiles, getFile, resolvePartnerToken } from '@/lib/github'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120   // C/AL context can be large; give plenty of time

// ── GitHub owner helper ───────────────────────────────────────────────────────

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

// ── Load C/AL source from GitHub ─────────────────────────────────────────────

interface CalObject {
  filename: string
  content:  string
}

async function loadObjectsFromGitHub(
  owner:         string,
  repo:          string,
  branch:        string,
  tokenOverride?: string | null,
): Promise<CalObject[]> {
  const fileList = await listFiles(owner, repo, branch, 'objects', tokenOverride)
  if (!fileList.length) return []

  const results: CalObject[] = []
  for (const f of fileList) {
    const content = await getFile(owner, repo, branch, f.path, tokenOverride)
    if (content) results.push({ filename: f.name, content })
  }
  return results
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  const role    = (session?.user as any)?.role
  if (!session?.user || !['superadmin', 'developer'].includes(role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const cfg = await getAiConfig()

  const apiKey = cfg.provider === 'anthropic'
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY

  if (!apiKey)
    return NextResponse.json({ error: `No API key for provider "${cfg.provider}"` }, { status: 503 })

  const { message, history = [] } = await req.json()
  if (!message?.trim())
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  const requirement = await (prisma as any).requirement.findUnique({
    where:   { id: params.id },
    include: { tenant: { include: { partnerAccount: { select: { githubToken: true } } } }, user: { select: { name: true, email: true } } },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!requirement.githubBranch || !requirement.tenant?.githubRepo)
    return NextResponse.json({ error: 'No GitHub branch linked to this requirement. Fetch and save objects first.' }, { status: 400 })

  // Load C/AL objects from GitHub
  let objects: CalObject[] = []
  let loadError = ''
  try {
    const partnerToken = await resolvePartnerToken(requirement.tenant?.partnerAccount?.githubToken)
    const owner = await getGitHubOwner(partnerToken)
    objects = await loadObjectsFromGitHub(owner, requirement.tenant.githubRepo, requirement.githubBranch, partnerToken)
  } catch (e: any) {
    loadError = e.message ?? 'Unknown error loading objects from GitHub'
    console.error('[coding-assistant] GitHub load error:', loadError)
  }

  // Build per-tenant context
  const tenantCtx = await buildTenantContext(requirement.tenantId)

  const bcVersion  = requirement.tenant?.navVersion ?? 'unknown'
  const tenantName = requirement.tenant?.name        ?? 'Unknown Tenant'

  // ── System prompt ─────────────────────────────────────────────────────────

  const calSourceSection = objects.length > 0
    ? `\n\n## C/AL OBJECTS ON THIS BRANCH (${objects.length} file${objects.length !== 1 ? 's' : ''})\n\n` +
      objects.map(o => `### ${o.filename}\n\`\`\`cal\n${o.content}\n\`\`\``).join('\n\n')
    : loadError
      ? `\n\n## C/AL OBJECTS\nCould not load objects from GitHub: ${loadError}`
      : `\n\n## C/AL OBJECTS\nNo objects have been fetched to GitHub for this requirement yet. Ask the developer to fetch and save objects first.`

  const systemPrompt =
`You are a senior Microsoft Dynamics 365 Business Central / NAV C/AL developer at BespoxAI.
You are working directly on the code for a live customisation project.

CUSTOMER: ${tenantName}
BC VERSION: ${bcVersion}
REQUIREMENT: ${requirement.title}
BRANCH: ${requirement.githubBranch}

${tenantCtx}

REQUIREMENT DESCRIPTION:
${requirement.description ?? ''}

${calSourceSection}

## YOUR ROLE
You are the coding assistant for this requirement. You help write, modify, and review C/AL code.

GUIDELINES:
- You have full access to the C/AL source above — read it carefully before answering.
- When writing or modifying C/AL objects, always output the COMPLETE modified object — never partial snippets — so it can be committed directly to GitHub.
- Start every C/AL object block with the standard NAV header line: OBJECT <Type> <ID> <Name>
- Follow the coding patterns already present in the existing objects.
- Be explicit about which object you are modifying and what changed.
- If you are creating a new object, choose an ID in a sensible range and document why.
- When asked to explain code, be thorough but focused — reference specific procedures and fields by name.
- Flag any risks, dependencies on other objects, or potential breaking changes clearly.
- This is BC ${bcVersion} — use C/AL syntax appropriate for this version. Do NOT use AL extension syntax unless specifically asked.`

  // ── Messages ──────────────────────────────────────────────────────────────

  const messages = [
    ...history.map((h: { role: string; content: string }) => ({
      role:    h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content,
    })),
    { role: 'user', content: message },
  ]

  // ── Anthropic streaming ───────────────────────────────────────────────────

  if (cfg.provider === 'anthropic') {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       cfg.model,
        max_tokens:  Math.max(cfg.maxTokens, 4000),
        temperature: cfg.temperature,
        stream:      true,
        system:      systemPrompt,
        messages,
      }),
    })

    if (!upstream.ok) {
      const err = await upstream.text()
      console.error(`[coding-assistant] Anthropic error ${upstream.status} — ${err}`)
      return NextResponse.json({ error: `Anthropic error: ${upstream.status}` }, { status: 502 })
    }

    let inputTokens  = 0
    let outputTokens = 0
    let sseBuffer    = ''
    const tenantId   = requirement.tenantId
    const reqId      = params.id
    const model      = cfg.model

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk)
        sseBuffer += new TextDecoder().decode(chunk)
        const lines = sseBuffer.split('\n')
        sseBuffer   = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'message_start')
              inputTokens  = data.message?.usage?.input_tokens  ?? inputTokens
            if (data.type === 'message_delta')
              outputTokens = data.usage?.output_tokens ?? outputTokens
          } catch { /* skip */ }
        }
      },
      async flush() {
        await logAiUsage({ tenantId, requirementId: reqId, feature: 'coding_assistant', model, inputTokens, outputTokens })
      },
    })

    return new Response(upstream.body!.pipeThrough(transform), {
      headers: {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-AI-Provider': 'anthropic',
        'X-Objects-Loaded': String(objects.length),
      },
    })
  }

  // ── OpenAI streaming ──────────────────────────────────────────────────────

  const OpenAI = (await import('openai')).default
  const openai  = new OpenAI({ apiKey })

  const stream = await openai.chat.completions.create({
    model:       cfg.model,
    max_tokens:  Math.max(cfg.maxTokens, 4000),
    temperature: cfg.temperature,
    stream:      true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages as any,
    ],
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      let inputTokens = 0, outputTokens = 0
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? ''
        if (text) {
          const event = { type: 'content_block_delta', delta: { type: 'text_delta', text } }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        if (chunk.usage) {
          inputTokens  = chunk.usage.prompt_tokens     ?? 0
          outputTokens = chunk.usage.completion_tokens ?? 0
        }
      }
      controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n\n'))
      controller.close()
      await logAiUsage({ tenantId: requirement.tenantId, requirementId: params.id, feature: 'coding_assistant', model: cfg.model, inputTokens, outputTokens })
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-AI-Provider': 'openai',
      'X-Objects-Loaded': String(objects.length),
    },
  })
}
