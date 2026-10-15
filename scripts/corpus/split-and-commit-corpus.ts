/**
 * Split a full C/AL text export into one file per object and commit it to the
 * private corpus repo (D8 — git holds source, Postgres holds the index).
 *
 * Usage (from the BespoxAI_Web folder, Git Bash or PowerShell):
 *
 *   npx tsx scripts/corpus/split-and-commit-corpus.ts \
 *     --export "C:\Exports\BC14_NZ_all.txt" \
 *     --repo   "C:\Dev\bespoxai-base-corpus" \
 *     --version BC14 --localisation NZ --build 14.0.29537.0 [--push]
 *
 * Writes <repo>/<version>/<localisation>/<build>/TAB18.TXT …, replacing any
 * files already in that folder, then commits. Files are read and written as
 * latin1 so the OEM-encoded export round-trips byte for byte.
 */

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { splitCalExport, objectFileName, isSystemObject } from '../../lib/corpus/cal-structure'
import { parseArgs, required } from './args'

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  const exportFile   = required(a, 'export')
  const repo         = required(a, 'repo')
  const version      = required(a, 'version')
  const localisation = required(a, 'localisation').toUpperCase()
  const build        = required(a, 'build')

  if (!fs.existsSync(path.join(repo, '.git'))) throw new Error('Not a git repo: ' + repo)

  const content = fs.readFileSync(exportFile, 'latin1')
  const blocks = splitCalExport(content)
  if (blocks.length === 0) throw new Error('No C/AL objects found in ' + exportFile)

  const relDir = [version, localisation, build].join('/')
  const outDir = path.join(repo, version, localisation, build)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  const seen = new Set<string>()
  const byType: Record<string, number> = {}
  let systemSkipped = 0
  for (const b of blocks) {
    if (isSystemObject(b.objectId)) { systemSkipped++; continue }   // platform objects: not part of the corpus
    const name = objectFileName(b.objectType, b.objectId)
    if (seen.has(name)) throw new Error('Duplicate object in export: ' + b.objectType + ' ' + b.objectId)
    seen.add(name)
    fs.writeFileSync(path.join(outDir, name), b.text, 'latin1')
    byType[b.objectType] = (byType[b.objectType] ?? 0) + 1
  }

  console.log('Split ' + (blocks.length - systemSkipped) + ' objects into ' + relDir +
    (systemSkipped ? ' (' + systemSkipped + ' system objects ≥ 2000000000 skipped)' : ''))
  for (const [t, n] of Object.entries(byType).sort()) console.log('  ' + t.padEnd(10) + n)

  // Keep CRLF/encoding exactly as exported
  const attrs = path.join(repo, '.gitattributes')
  if (!fs.existsSync(attrs)) fs.writeFileSync(attrs, '*.TXT -text\n*.txt -text\n')

  git(repo, ['add', '--all', '--', relDir, '.gitattributes'])
  const staged = git(repo, ['diff', '--cached', '--name-only'])
  if (!staged) {
    console.log('No changes — corpus folder already matches this export.')
  } else {
    git(repo, ['commit', '-m', 'Corpus ' + version + ' ' + localisation + ' ' + build + ': ' + blocks.length + ' objects'])
    console.log('Committed ' + git(repo, ['rev-parse', '--short', 'HEAD']))
  }
  if (a.push) {
    git(repo, ['push'])
    console.log('Pushed.')
  } else {
    console.log('Not pushed (add --push, or run git push in the corpus repo).')
  }
}

try { main() } catch (e: any) { console.error('ERROR: ' + (e?.message ?? e)); process.exit(1) }
