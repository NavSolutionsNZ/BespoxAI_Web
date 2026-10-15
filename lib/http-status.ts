// lib/http-status.ts — status codes for our own API responses.

/**
 * Status for "a service we depend on failed": the BespoxAI Agent / Business
 * Central, the AI provider, Cloudflare's API, email.
 *
 * Not 502 or 504: bespoxai.com is proxied by Cloudflare, which replaces any
 * 502/504 from the origin with its own HTML error page (passing the origin's
 * body through is an Enterprise-only setting). Our JSON error message never
 * reached the browser, and the UI fell back to "Failed to load". 424 (Failed
 * Dependency) passes through untouched. tests/http-status.test.ts keeps
 * 502/504 out of app/ and lib/.
 */
export const UPSTREAM_FAILED = 424
