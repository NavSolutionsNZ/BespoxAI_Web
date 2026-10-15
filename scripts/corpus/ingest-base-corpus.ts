/**
 * Index a corpus folder (already committed by split-and-commit-corpus.ts)
 * into BaseCorpus / BaseObject. Source stays in git; only summaries, hashes,
 * file paths and blob SHAs go to Postgres.
 *
 * Usage (from the BespoxAI_Web folder, with PRISMA_DATABASE_URL and POSTGRES_URL in .env):
 *
 *   npx tsx scripts/corpus/ingest-base-corpus.ts \
 *     --repo "C:\Dev\bespoxai-base-corpus" \
 *     --version BC14 --localisation NZ --build 14.0.29537.0 \
 *     --source-note "Rich's BC14 NZ test implementation, CRONUS New Zealand" \
 *     [--dry-run]
 *
 * Idempotent: re-running for the same version/build/localisation replaces
 * that corpus's objects. --dry-run parses and reports without touching the DB.
 */

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import {
  splitCalExport, normaliseObject, partHashes, sha256, versionListOf, dominantVersionTags,
  corpusVersionTag, tagsMatchLocalisation,
} from '../../lib/corpus/cal-structure'
import { parseObjectFile } from '../../lib/bc-object-parser'
import { parseArgs, required } from './args'

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
}

interface Row {
  objectType: string
  objectId: number
  objectName: string
  versionList: string | null
  summary: any
  normHash: string
  partHashes: any
  filePath: string
  blobSha: string
}

/**
 * Load KEY=VALUE pairs from the app's .env (the scripts run outside Next.js,
 * so nothing else loads it). Existing environment variables win.
 */
function loadDotEnv(): string | null {
  const root = path.resolve(__dirname, '..', '..')
  for (const dir of Array.from(new Set([process.cwd(), root]))) {
    const file = path.join(dir, '.env')
    if (!fs.existsSync(file)) {
      if (fs.existsSync(file + '.txt')) {
        throw new Error('Found ' + file + '.txt — Windows saved it with a .txt extension. Rename it to .env')
      }
      continue
    }
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m || process.env[m[1]] !== undefined) continue
      process.env[m[1]] = m[2].replace(/^(['"])([\s\S]*)\1$/, '$2')
    }
    return file
  }
  return null
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  const repo         = required(a, 'repo')
  const version      = required(a, 'version')
  const localisation = required(a, 'localisation').toUpperCase()
  const build        = required(a, 'build')
  const dryRun       = !!a['dry-run']
  const sourceNote   = dryRun ? String(a['source-note'] ?? '') : required(a, 'source-note')
  const product      = typeof a.product === 'string' ? a.product : (/^BC/i.test(version) ? 'BC' : 'NAV')
  const relDir       = [version, localisation, build].join('/')

  // The DB must point at exactly what is committed
  const dirty = git(repo, ['status', '--porcelain', '--', relDir])
  if (dirty) throw new Error('Uncommitted changes under ' + relDir + ' — commit them first.')
  const commit = git(repo, ['rev-parse', 'HEAD'])

  const tree = git(repo, ['ls-tree', '-r', 'HEAD', '--', relDir])
  if (!tree) throw new Error('Nothing committed under ' + relDir)

  const rows: Row[] = []
  const problems: string[] = []
  for (const line of tree.split('\n')) {
    const m = line.match(/^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/)
    if (!m) continue
    const [, blobSha, filePath] = m
    if (!/\.txt$/i.test(filePath)) continue

    const text = fs.readFileSync(path.join(repo, filePath), 'latin1')
    const blocks = splitCalExport(text)
    if (blocks.length !== 1) { problems.push(filePath + ': expected 1 object, found ' + blocks.length); continue }
    const b = blocks[0]
    const parsed = parseObjectFile(text, path.basename(filePath))[0]
    if (parsed?.parseError) problems.push(filePath + ': parser flagged an error (indexed with hashes only)')

    rows.push({
      objectType: b.objectType,
      objectId:   b.objectId,
      objectName: b.objectName,
      versionList: versionListOf(text),
      summary:    parsed?.parseError ? {} : (parsed?.summary ?? {}),
      normHash:   sha256(normaliseObject(text)),
      partHashes: partHashes(text),
      filePath,
      blobSha,
    })
  }

  const tags = dominantVersionTags(rows.map(r => r.versionList))
  const versionTag = corpusVersionTag(tags, localisation) ?? 'unknown'

  console.log('Corpus ' + relDir + ' @ ' + commit.slice(0, 10))
  console.log('  objects:      ' + rows.length)
  console.log('  W1 tag:       ' + (tags.w1 ?? '-') + (tags.cuLevel !== null ? '  (highest CU tag: ' + tags.cuLevel + ')' : ''))
  console.log('  local tag:    ' + (tags.local ?? '-') + (tags.others.length ? '  (also ' + tags.others.join(', ') + ')' : ''))
  console.log('  versionTag:   ' + versionTag)
  if (!tagsMatchLocalisation(tags, localisation)) {
    console.warn('  WARNING: --localisation ' + localisation + ' does not appear in the export\'s tags (' +
      [tags.local].concat(tags.others).filter(Boolean).join(', ') + ')')
  }
  if (problems.length) {
    console.warn('  ' + problems.length + ' problem(s):')
    for (const p of problems.slice(0, 25)) console.warn('    ' + p)
    if (problems.length > 25) console.warn('    …')
  }
  if (dryRun) { console.log('Dry run — database not touched.'); return }

  const envFile = loadDotEnv()
  console.log('  env file:     ' + (envFile ?? 'none found (using shell environment)'))
  // Loaded only for a real run, so --dry-run works without a database or generated client
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  if (!(prisma as any).baseCorpus) {
    throw new Error('The local Prisma client predates the BaseCorpus model — run "npx prisma generate" and try again.')
  }
  if (!process.env.PRISMA_DATABASE_URL) {
    throw new Error('PRISMA_DATABASE_URL is not set — put it and POSTGRES_URL (from Vercel → Settings → Environment Variables) in ' +
      path.join(path.resolve(__dirname, '..', '..'), '.env'))
  }
  try {
    const data = {
      product, versionTag, repoPath: relDir, repoCommit: commit, sourceNote,
      status: 'ingesting', objectCount: 0,
    }
    const existing = await prisma.baseCorpus.findFirst({ where: { version, build, localisation } })
    const corpus = existing
      ? await prisma.baseCorpus.update({ where: { id: existing.id }, data })
      : await prisma.baseCorpus.create({ data: { ...data, version, build, localisation } })

    await prisma.baseObject.deleteMany({ where: { corpusId: corpus.id } })
    const BATCH = 500
    for (let i = 0; i < rows.length; i += BATCH) {
      await prisma.baseObject.createMany({
        data: rows.slice(i, i + BATCH).map(r => ({ ...r, corpusId: corpus.id })),
      })
      process.stdout.write('\r  indexed ' + Math.min(i + BATCH, rows.length) + '/' + rows.length)
    }
    process.stdout.write('\n')

    await prisma.baseCorpus.update({
      where: { id: corpus.id },
      data:  { status: 'ready', objectCount: rows.length },
    })
    console.log('Ready: BaseCorpus ' + corpus.id)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error('ERROR: ' + (e?.message ?? e)); process.exit(1) })
