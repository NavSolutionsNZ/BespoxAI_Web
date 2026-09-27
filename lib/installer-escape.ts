// lib/installer-escape.ts — make tenant/request values safe to embed in the
// generated installer (a PowerShell script wrapped in a .bat that elevates
// itself to Administrator on the customer's server).

/**
 * Value for a PowerShell single-quoted string literal: '...'.
 * Inside single quotes nothing is expanded; the only way out is a quote
 * character, which is escaped by doubling. PowerShell also treats the curly
 * quotes ‘ ’ ‚ ‛ as single quotes, so those are doubled too.
 */
export function psq(value: unknown): string {
  return String(value ?? '').replace(/['‘’‚‛]/g, m => m + m)
}

/**
 * Display text for the .bat wrapper's `title` / `echo` lines. cmd.exe gives
 * meaning to & | < > ^ % ( ) and, with delayed expansion on, !. These lines
 * are only informational, so anything outside a plain set becomes '_'.
 */
export function batText(value: unknown): string {
  return String(value ?? '').replace(/[^A-Za-z0-9 .,_\-\/@:+']/g, '_').slice(0, 100)
}
