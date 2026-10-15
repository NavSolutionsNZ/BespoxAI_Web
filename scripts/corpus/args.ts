/** Minimal --key value / --flag argument parsing for the corpus scripts. */

export type Args = Record<string, string | true>

export function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)$/)
    if (!m) throw new Error('Unexpected argument: ' + argv[i])
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[m[1]] = true
    else { out[m[1]] = next; i++ }
  }
  return out
}

export function required(a: Args, key: string): string {
  const v = a[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error('Missing --' + key)
  return v.trim()
}
