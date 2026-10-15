/**
 * lib/corpus/version-detect.ts
 *
 * Pick the base corpus that matches a customer export, from the version lists
 * of its objects (design §5.3). Pure — callers pass the candidate corpora.
 */

import { dominantVersionTags } from './cal-structure'

export interface CorpusCandidate {
  id:           string
  version:      string
  build:        string
  localisation: string
  versionTag:   string        // e.g. NAVNZ14.00 or NAVW114.00
  status?:      string
}

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'

export interface CorpusMatch {
  corpus:     CorpusCandidate | null
  confidence: MatchConfidence
  detected:   { w1: string | null; local: string | null; localisation: string | null }
  reason:     string
}

/** "NAVNZ14.00" → "NZ" */
export function localisationOfTag(tag: string | null): string | null {
  const m = (tag ?? '').match(/^NAV([A-Z][A-Z0-9])\d/i)
  return m ? m[1].toUpperCase() : null
}

function compareBuild(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/**
 * Rules:
 *  - high:   a corpus with the detected local tag (e.g. NAVNZ14.00); the newest build is chosen
 *            when there is exactly one build for that tag.
 *  - medium: as high, but several builds exist for that tag — newest build chosen, build noise possible.
 *  - low:    no corpus for the localisation; fell back to the W1 corpus of the same version.
 *  - none:   nothing suitable — do not compare (classifications would be wrong).
 */
export function selectCorpus(versionLists: Array<string | null>, corpora: CorpusCandidate[]): CorpusMatch {
  const tags = dominantVersionTags(versionLists)
  const localisation = tags.local ? localisationOfTag(tags.local) : (tags.w1 ? 'W1' : null)
  const detected = { w1: tags.w1, local: tags.local, localisation }
  const ready = corpora.filter(c => !c.status || c.status === 'ready')
  const newest = (list: CorpusCandidate[]) => list.slice().sort((a, b) => compareBuild(b.build, a.build))[0]

  const wanted = tags.local ?? tags.w1
  if (!wanted) return { corpus: null, confidence: 'none', detected, reason: 'No Microsoft version tags found in the export.' }

  const exact = ready.filter(c => c.versionTag.toUpperCase() === wanted.toUpperCase())
  if (exact.length === 1) {
    return { corpus: exact[0], confidence: 'high', detected, reason: 'Exact match on ' + wanted + '.' }
  }
  if (exact.length > 1) {
    const c = newest(exact)
    return {
      corpus: c, confidence: 'medium', detected,
      reason: exact.length + ' builds exist for ' + wanted + '; using newest (' + c.build + '). Cumulative-update differences may appear as modifications.',
    }
  }

  if (tags.local && tags.w1) {
    const w1 = ready.filter(c => c.versionTag.toUpperCase() === tags.w1!.toUpperCase())
    if (w1.length) {
      const c = newest(w1)
      return {
        corpus: c, confidence: 'low', detected,
        reason: 'No ' + localisation + ' corpus for ' + tags.local + '; compared against W1 (' + c.build + '). Localisation objects will show as modified.',
      }
    }
  }

  return { corpus: null, confidence: 'none', detected, reason: 'No corpus loaded for ' + wanted + '.' }
}
