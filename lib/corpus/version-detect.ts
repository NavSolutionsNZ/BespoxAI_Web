/**
 * lib/corpus/version-detect.ts
 *
 * Pick the base corpus that matches a customer export, from the version lists
 * of its objects (design §5.3). Pure — callers pass the candidate corpora.
 *
 * Tags are compared at major-version level (NAVW114, NAVAPAC14): the minor part
 * of a tag is the cumulative update and varies from object to object.
 * A localisation can sit inside a regional family — BC14 NZ objects carry
 * NAVAPAC14 with a handful of NAVNZ14 — so the corpus label (NZ) is matched
 * against the secondary families as well.
 */

import { dominantVersionTags, parseMsTag, type VersionTags } from './cal-structure'

export interface CorpusCandidate {
  id:           string
  version:      string
  build:        string
  localisation: string        // label, e.g. NZ
  versionTag:   string        // key, e.g. NAVAPAC14 or NAVW114
  status?:      string
}

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'

export interface CorpusMatch {
  corpus:     CorpusCandidate | null
  confidence: MatchConfidence
  detected:   VersionTags & { localisation: string | null }
  reason:     string
}

/**
 * The most specific localisation the tags reveal: a country family among the
 * secondary tags (NZ under APAC) wins over the regional one.
 */
export function detectedLocalisation(tags: VersionTags): string | null {
  const country = tags.others.map(t => parseMsTag(t)?.family).find(f => !!f && f.length === 2)
  if (country) return country
  if (tags.local) return parseMsTag(tags.local)?.family ?? null
  return tags.w1 ? 'W1' : null
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

const newest = (list: CorpusCandidate[]) => list.slice().sort((a, b) => compareBuild(b.build, a.build))[0]

/**
 * Rules:
 *  - high:   one corpus with the export's tag (and localisation, when several share the tag)
 *  - medium: several builds of that corpus — newest chosen, CU differences may show as modifications;
 *            or several localisations share the tag and none matches the export
 *  - low:    no corpus for the localisation family; fell back to W1 of the same version
 *  - none:   nothing suitable — do not compare
 */
export function selectCorpus(versionLists: Array<string | null>, corpora: CorpusCandidate[]): CorpusMatch {
  const tags = dominantVersionTags(versionLists)
  const localisation = detectedLocalisation(tags)
  const detected = { ...tags, localisation }
  const ready = corpora.filter(c => !c.status || c.status === 'ready')

  const wanted = tags.local ?? tags.w1
  if (!wanted) return { corpus: null, confidence: 'none', detected, reason: 'No Microsoft version tags found in the export.' }

  let exact = ready.filter(c => c.versionTag.toUpperCase() === wanted.toUpperCase())
  if (exact.length) {
    const labels = Array.from(new Set(exact.map(c => c.localisation.toUpperCase())))
    if (labels.length > 1) {
      const sameLoc = exact.filter(c => c.localisation.toUpperCase() === localisation)
      if (sameLoc.length) exact = sameLoc
      else {
        const c = newest(exact)
        return {
          corpus: c, confidence: 'medium', detected,
          reason: 'Several localisations share ' + wanted + ' and none is ' + (localisation ?? '?') + '; using ' + c.localisation + ' ' + c.build + '.',
        }
      }
    }
    if (exact.length === 1) {
      return { corpus: exact[0], confidence: 'high', detected, reason: 'Matched ' + wanted + ' (' + exact[0].localisation + ' ' + exact[0].build + ').' }
    }
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
        reason: 'No corpus for ' + tags.local + '; compared against W1 (' + c.build + '). Localisation objects will show as modified.',
      }
    }
  }

  return { corpus: null, confidence: 'none', detected, reason: 'No corpus loaded for ' + wanted + '.' }
}
