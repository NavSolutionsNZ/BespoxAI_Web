/**
 * Offline upgrade-readiness delta: compare a customer C/AL export against a
 * base corpus folder, with no database and no portal. Used to validate the
 * delta engine on real data before the BCAgent pipeline (P3) exists.
 *
 * Usage (from the BespoxAI_Web folder):
 *
 *   npx tsx scripts/corpus/delta-report.ts \
 *     --repo   "C:\Dev\bespoxai-base-corpus" \
 *     --base   BC14/NZ/14.0.29537.0 \
 *     --export "C:\Exports\Customer_all.txt" \
 *     [--custom-ranges 50000-99999,14125500-14125599] \
 *     [--out "C:\Exports\Customer_delta"]
 *
 * --base may be omitted: the corpus folder is then chosen from the export's
 * version lists (same rules as the portal will use).
 *
 * Writes <out>.csv (one row per finding) and <out>.json (full deltas + summary).
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  splitCalExport, partHashes, normaliseObject, sha256, versionListOf, dominantVersionTags, corpusVersionTag,
} from '../../lib/corpus/cal-structure'
import {
  computeDeltas, objectKey, DEFAULT_CUSTOM_RANGES, type BaseIndexEntry, type IdRange,
} from '../../lib/corpus/delta'
import { selectCorpus, type CorpusCandidate } from '../../lib/corpus/version-detect'
import { parseArgs, required } from './args'

function parseRanges(s: string | undefined): IdRange[] {
  if (!s) return DEFAULT_CUSTOM_RANGES
  return s.split(',').map(r => {
    const m = r.trim().match(/^(\d+)-(\d+)$/)
    if (!m) throw new Error('Bad range "' + r + '" — use e.g. 50000-99999')
    return { from: parseInt(m[1], 10), to: parseInt(m[2], 10) }
  })
}

/** Corpus folders on disk: <repo>/<version>/<loc>/<build>/, keyed by the tag found in their objects */
function listCorpusFolders(repo: string): CorpusCandidate[] {
  const out: CorpusCandidate[] = []
  const dirs = (p: string) => fs.readdirSync(p, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name)
  for (const version of dirs(repo)) {
    for (const loc of dirs(path.join(repo, version))) {
      for (const build of dirs(path.join(repo, version, loc))) {
        const folder = path.join(repo, version, loc, build)
        const lists = fs.readdirSync(folder).filter(f => /\.txt$/i.test(f)).map(f => {
          const fd = fs.openSync(path.join(folder, f), 'r')
          const buf = Buffer.alloc(1024)
          const n = fs.readSync(fd, buf, 0, 1024, 0)
          fs.closeSync(fd)
          return versionListOf(buf.toString('latin1', 0, n))
        })
        const tag = corpusVersionTag(dominantVersionTags(lists), loc)
        if (tag) out.push({ id: [version, loc, build].join('/'), version, build, localisation: loc, versionTag: tag })
      }
    }
  }
  return out
}

function loadBase(folder: string): Map<string, BaseIndexEntry> {
  const index = new Map<string, BaseIndexEntry>()
  for (const f of fs.readdirSync(folder)) {
    if (!/\.txt$/i.test(f)) continue
    const text = fs.readFileSync(path.join(folder, f), 'latin1')
    const b = splitCalExport(text)[0]
    if (!b) continue
    index.set(objectKey(b.objectType, b.objectId), {
      objectType: b.objectType, objectId: b.objectId, objectName: b.objectName,
      versionList: versionListOf(text), normHash: sha256(normaliseObject(text)), partHashes: partHashes(text),
    })
  }
  return index
}

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  const repo   = required(a, 'repo')
  const exportFile = required(a, 'export')
  const ranges = parseRanges(typeof a['custom-ranges'] === 'string' ? a['custom-ranges'] : undefined)
  const out    = typeof a.out === 'string' ? a.out : exportFile.replace(/\.txt$/i, '') + '_delta'

  const tenantText = fs.readFileSync(exportFile, 'latin1')
  const blocks = splitCalExport(tenantText)
  if (!blocks.length) throw new Error('No C/AL objects found in ' + exportFile)
  const tenant = blocks.map(b => ({ objectType: b.objectType, objectId: b.objectId, objectName: b.objectName, text: b.text }))

  let baseRel = typeof a.base === 'string' ? a.base : ''
  if (!baseRel) {
    const match = selectCorpus(tenant.map(t => versionListOf(t.text)), listCorpusFolders(repo))
    console.log('Detected: ' + JSON.stringify(match.detected) + ' → ' + (match.corpus?.id ?? 'none') +
      ' (' + match.confidence + ') — ' + match.reason)
    if (!match.corpus) throw new Error('No suitable corpus folder; pass --base explicitly.')
    baseRel = match.corpus.id
  } else {
    const tags = dominantVersionTags(tenant.map(t => versionListOf(t.text)))
    console.log('Export tags: W1 ' + (tags.w1 ?? '-') + ', local ' + (tags.local ?? '-') +
      (tags.others.length ? ' (+' + tags.others.join(', ') + ')' : '') + ', CU ' + (tags.cuLevel ?? '-'))
  }

  const baseFolder = path.join(repo, ...baseRel.split('/'))
  if (!fs.existsSync(baseFolder)) throw new Error('Corpus folder not found: ' + baseFolder)
  console.log('Loading base ' + baseRel + ' …')
  const base = loadBase(baseFolder)
  console.log('  ' + base.size + ' base objects; ' + tenant.length + ' customer objects')

  const { deltas, summary } = computeDeltas(tenant, base, ranges)

  console.log('\nOrigin')
  for (const [k, v] of Object.entries(summary.byOrigin)) console.log('  ' + k.padEnd(22) + v)
  console.log('Effort (per object)')
  for (const [k, v] of Object.entries(summary.byEffort)) console.log('  ' + k.padEnd(22) + v)
  console.log('Modified standard objects with no added version tag: ' + summary.unattributed)
  console.log('Documentation-only changes: ' + summary.documentationOnly)
  if (summary.systemExcluded) console.log('System objects (ID ≥ 2000000000) ignored: ' + summary.systemExcluded)
  console.log('Findings')
  for (const [k, v] of Object.entries(summary.findingsByCode).sort((x, y) => y[1] - x[1])) console.log('  ' + k.padEnd(28) + v)

  const rows = [['ObjectType', 'ObjectID', 'ObjectName', 'Origin', 'ObjectEffort', 'ModTags', 'Unattributed',
    'Finding', 'Items', 'ALTarget', 'FindingEffort', 'Note'].join(',')]
  for (const d of deltas) {
    if (d.origin === 'standard_unmodified') continue
    for (const f of d.findings.length ? d.findings : [null]) {
      rows.push([
        d.objectType, d.objectId, d.objectName, d.origin, d.effort, d.modTags.join(' '), d.unattributed ? 'yes' : '',
        f?.code ?? '', f?.items.join('; ') ?? '', f?.alTarget ?? '', f?.effort ?? '', f?.note ?? '',
      ].map(csvCell).join(','))
    }
  }
  fs.writeFileSync(out + '.csv', rows.join('\r\n') + '\r\n', 'utf8')
  fs.writeFileSync(out + '.json', JSON.stringify({ base: baseRel, customRanges: ranges, summary, deltas: deltas.filter(d => d.origin !== 'standard_unmodified') }, null, 2))
  console.log('\nWrote ' + out + '.csv and ' + out + '.json')
}

try { main() } catch (e: any) { console.error('ERROR: ' + (e?.message ?? e)); process.exit(1) }
