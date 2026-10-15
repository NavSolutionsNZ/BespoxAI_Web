/**
 * lib/corpus/process-export-core.ts
 *
 * The deterministic part of processing a customer full export: split →
 * choose corpus → compare → files to commit. IO (database, GitHub) is
 * injected so this runs in tests and scripts unchanged.
 *
 * Performance: only objects whose normalised hash differs from the base need
 * the base's part hashes (the large JSON), so they are fetched for that subset.
 */

import { gunzipSync } from 'zlib'
import {
  splitCalExport, normaliseObject, sha256, versionListOf, objectFileName, PART_HASHES_SCHEMA,
  type PartHashes,
} from './cal-structure'
import {
  computeDeltas, objectKey, type BaseIndexEntry, type IdRange, type ObjectDelta, type DeltaSummary, type TenantObjectInput,
} from './delta'
import { selectCorpus, type CorpusCandidate, type CorpusMatch } from './version-detect'
import { FULL_EXPORT_PREFIX } from './export-jobs'

/** A base row without its part hashes. */
export interface BaseLiteRow {
  id:          string
  objectType:  string
  objectId:    number
  objectName:  string
  versionList: string | null
  normHash:    string
}

export interface ProcessIO {
  corpora:        () => Promise<CorpusCandidate[]>
  baseLite:       (corpusId: string) => Promise<BaseLiteRow[]>
  basePartHashes: (rowIds: string[]) => Promise<Map<string, PartHashes>>
}

export interface CommitFile { path: string; latin1: string }

export interface ProcessResult {
  match:   CorpusMatch
  deltas:  ObjectDelta[]          // every object, including unmodified
  summary: DeltaSummary
  files:   CommitFile[]           // objects that differ from the base
}

/** The export arrives as gzip of raw finsql bytes; decode as latin1 so bytes round-trip. */
export function decodeExport(gz: Buffer): string {
  return gunzipSync(gz).toString('latin1')
}

export function tenantObjectsFromText(text: string): TenantObjectInput[] {
  const seen = new Set<string>()
  const out: TenantObjectInput[] = []
  for (const b of splitCalExport(text)) {
    const k = objectKey(b.objectType, b.objectId)
    if (seen.has(k)) throw new Error('Export contains ' + b.objectType + ' ' + b.objectId + ' twice.')
    seen.add(k)
    out.push({ objectType: b.objectType, objectId: b.objectId, objectName: b.objectName, text: b.text })
  }
  return out
}

export async function processExportText(text: string, io: ProcessIO, customRanges: IdRange[]): Promise<ProcessResult> {
  const tenant = tenantObjectsFromText(text)
  if (!tenant.length) throw new Error('The export contained no C/AL objects.')

  const match = selectCorpus(tenant.map(t => versionListOf(t.text)), await io.corpora())
  if (!match.corpus || match.confidence === 'none') {
    throw new Error('No base corpus matches this database (' + match.reason + ')')
  }

  const lite = await io.baseLite(match.corpus.id)
  const liteByKey = new Map(lite.map(r => [objectKey(r.objectType, r.objectId), r]))

  // Which base rows need their part hashes: same object present, hash differs
  const needParts: string[] = []
  const tenantHash = new Map<string, string>()
  for (const t of tenant) {
    const k = objectKey(t.objectType, t.objectId)
    const h = sha256(normaliseObject(t.text))
    tenantHash.set(k, h)
    const b = liteByKey.get(k)
    if (b && b.normHash !== h) needParts.push(b.id)
  }
  const parts = needParts.length ? await io.basePartHashes(needParts) : new Map<string, PartHashes>()

  const baseIndex = new Map<string, BaseIndexEntry>()
  for (const [k, b] of Array.from(liteByKey.entries())) {
    const ph = parts.get(b.id)
    baseIndex.set(k, {
      objectType: b.objectType, objectId: b.objectId, objectName: b.objectName,
      versionList: b.versionList, normHash: b.normHash,
      // Unmodified objects only compare normHash, so they don't need real part hashes
      partHashes: ph ?? ({ schema: PART_HASHES_SCHEMA } as PartHashes),
    })
  }

  const { deltas, summary } = computeDeltas(tenant, baseIndex, customRanges)

  const textByKey = new Map(tenant.map(t => [objectKey(t.objectType, t.objectId), t.text]))
  const files: CommitFile[] = deltas
    .filter(d => d.origin !== 'standard_unmodified')
    .map(d => ({
      path:   FULL_EXPORT_PREFIX + objectFileName(d.objectType, d.objectId),
      latin1: textByKey.get(objectKey(d.objectType, d.objectId)) ?? '',
    }))

  return { match, deltas, summary, files }
}

/** Custom ranges stored on the tenant (JSON) → validated ranges, or the default. */
export function tenantCustomRanges(raw: unknown, fallback: IdRange[]): IdRange[] {
  if (!Array.isArray(raw)) return fallback
  const ranges = raw
    .map((r: any) => ({ from: Number(r?.from), to: Number(r?.to) }))
    .filter(r => Number.isInteger(r.from) && Number.isInteger(r.to) && r.from > 0 && r.to >= r.from)
  return ranges.length ? ranges : fallback
}
