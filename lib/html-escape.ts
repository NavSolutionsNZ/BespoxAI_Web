// lib/html-escape.ts — escape text for insertion into HTML (emails, pages).
// Customer- and partner-entered values (names, titles, reasons, notes) must
// never be interpolated into HTML raw.
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
