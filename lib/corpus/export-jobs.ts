/**
 * lib/corpus/export-jobs.ts
 *
 * Pure rules for BCAgent full object export jobs (design §14): out-of-hours
 * checks, job tokens, licence-fetch window, chunk assembly, staleness and the
 * job → tenant-repo file mapping. No database, network or Next.js imports.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export type ExportJobStatus =
  | 'scheduled' | 'running' | 'uploaded' | 'processing' | 'complete' | 'failed' | 'stale'

export const ACTIVE_STATUSES: ExportJobStatus[] = ['scheduled', 'running', 'uploaded', 'processing']

/** Out of hours = 22:00–05:00 in the tenant's time zone (D13; free choice with a warning). */
export const OUT_OF_HOURS_START = 22
export const OUT_OF_HOURS_END   = 5

/** How long after notBefore an export may take before the job is marked stale. */
export const RUN_GRACE_MS        = 3 * 60 * 60 * 1000
/** How long upload/processing may sit without progress before the job is marked stale. */
export const PROCESSING_GRACE_MS = 30 * 60 * 1000
/** The agent may fetch the licence from this long before notBefore (clock skew). */
export const LICENCE_EARLY_MS    = 10 * 60 * 1000

export const MAX_CHUNK_BYTES = 4 * 1024 * 1024
export const MAX_CHUNKS      = 64

const COUNTRY_ZONES: Record<string, string> = {
  NZ: 'Pacific/Auckland', AU: 'Australia/Sydney', GB: 'Europe/London', UK: 'Europe/London',
  IE: 'Europe/Dublin', US: 'America/New_York', CA: 'America/Toronto', ZA: 'Africa/Johannesburg',
  SG: 'Asia/Singapore',
}

export function tenantTimeZone(tenant: { timeZone?: string | null; country?: string | null }): string {
  if (tenant.timeZone && isValidTimeZone(tenant.timeZone)) return tenant.timeZone
  return COUNTRY_ZONES[(tenant.country ?? '').toUpperCase()] ?? 'UTC'
}

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-NZ', { timeZone: tz }); return true } catch { return false }
}

/** Hour (0–23) of an instant in a time zone. */
export function hourInZone(at: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at)
  return parseInt(h, 10) % 24
}

export function isOutOfHours(at: Date, timeZone: string): boolean {
  const h = hourInZone(at, timeZone)
  return h >= OUT_OF_HOURS_START || h < OUT_OF_HOURS_END
}

// ── job tokens ────────────────────────────────────────────────────────────────

export function newJobToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashJobToken(token) }
}

export function hashJobToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function jobTokenMatches(token: string | null | undefined, storedHash: string): boolean {
  if (!token) return false
  const a = Buffer.from(hashJobToken(token), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// ── state rules ───────────────────────────────────────────────────────────────

export interface JobTiming {
  status:           string
  notBefore:        Date
  licenceFetchedAt: Date | null
  updatedAt:        Date
}

/** Why the agent may not fetch the licence now, or null if it may. One fetch per job. */
export function licenceFetchRefusal(job: JobTiming, now: Date = new Date()): string | null {
  if (job.status !== 'scheduled') return 'Job is ' + job.status + ', not scheduled.'
  if (job.licenceFetchedAt) return 'Licence was already issued for this job.'
  if (now.getTime() < job.notBefore.getTime() - LICENCE_EARLY_MS) return 'Too early — job starts at ' + job.notBefore.toISOString() + '.'
  if (now.getTime() > job.notBefore.getTime() + RUN_GRACE_MS) return 'Job window has passed.'
  return null
}

/** True when a job has stopped making progress and should be shown as stale (with Retry). */
export function isStale(job: JobTiming, now: Date = new Date()): boolean {
  const t = now.getTime()
  if (job.status === 'scheduled' || job.status === 'running') return t > job.notBefore.getTime() + RUN_GRACE_MS
  if (job.status === 'uploaded' || job.status === 'processing') return t > job.updatedAt.getTime() + PROCESSING_GRACE_MS
  return false
}

// ── chunks ────────────────────────────────────────────────────────────────────

/** Reassemble uploaded chunks; refuses gaps, duplicates or a count mismatch. */
export function assembleChunks(chunks: Array<{ seq: number; data: Buffer | Uint8Array }>, expected: number): Buffer {
  if (!Number.isInteger(expected) || expected < 1 || expected > MAX_CHUNKS) throw new Error('Invalid chunk count ' + expected + '.')
  const sorted = chunks.slice().sort((a, b) => a.seq - b.seq)
  if (sorted.length !== expected) throw new Error('Expected ' + expected + ' chunks, received ' + sorted.length + '.')
  sorted.forEach((c, i) => { if (c.seq !== i) throw new Error('Chunk ' + i + ' is missing.') })
  return Buffer.concat(sorted.map(c => Buffer.from(c.data)))
}

// ── tenant repo ───────────────────────────────────────────────────────────────

export const FULL_EXPORT_BRANCH = 'bespoxai/full-export'
export const FULL_EXPORT_PREFIX = 'objects/full/'

/** Resolve the tenant repo the way the rest of the portal does: override, then org/repo, else create. */
export function parseRepoOverride(override: string | null | undefined): { owner: string; repo: string } | null {
  const m = (override ?? '').trim().match(/^([\w.-]+)\/([\w.-]+)$/)
  return m ? { owner: m[1], repo: m[2] } : null
}
