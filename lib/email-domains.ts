/**
 * Company-email enforcement for signup flows.
 *
 * BespoxAI is sold to Dynamics NAV / Business Central on-premises customers and
 * to partner consultancies — both have their own mail domains. Free consumer
 * providers and disposable/throwaway services are rejected at signup.
 *
 * Used by:
 *   - app/api/signup/route.ts          (customer signup)
 *   - app/api/partner-signup/route.ts  (partner signup — contact + billing email)
 *   - app/signup/page.tsx              (client-side pre-check)
 *   - app/partner-site/signup/page.tsx (client-side pre-check)
 *
 * The server-side check is the gate. The client-side calls exist only to give
 * immediate feedback without a round-trip.
 */

/** Free consumer mail providers. */
const FREE_PROVIDERS = [
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'hotmail.com', 'hotmail.co.uk', 'hotmail.co.nz', 'hotmail.com.au',
  'outlook.com', 'outlook.co.nz', 'outlook.com.au',
  'live.com', 'live.co.uk', 'live.com.au', 'msn.com',
  // Yahoo
  'yahoo.com', 'yahoo.co.nz', 'yahoo.co.uk', 'yahoo.com.au', 'ymail.com', 'rocketmail.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Other global
  'aol.com', 'protonmail.com', 'protonmail.ch', 'proton.me',
  'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru',
  'zoho.com', 'fastmail.com', 'hushmail.com', 'tutanota.com', 'inbox.com',
  // NZ consumer ISP domains
  'xtra.co.nz', 'slingshot.co.nz', 'orcon.net.nz', 'clear.net.nz',
  'ihug.co.nz', 'paradise.net.nz', 'vodafone.co.nz', 'actrix.co.nz',
  // AU consumer ISP domains
  'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'iinet.net.au',
]

/** Disposable / throwaway mail services. */
const DISPOSABLE_PROVIDERS = [
  'mailinator.com', 'yopmail.com', 'guerrillamail.com', 'guerrillamail.net',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org',
  'throwawaymail.com', 'trashmail.com', 'getnada.com', 'dispostable.com',
  'maildrop.cc', 'fakeinbox.com', 'sharklasers.com', 'spam4.me',
  'mailnesia.com', 'mytemp.email', 'moakt.com', 'emailondeck.com',
  'mohmal.com', 'burnermail.io', 'tempr.email', 'discard.email',
]

export const BLOCKED_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  ...FREE_PROVIDERS,
  ...DISPOSABLE_PROVIDERS,
])

/** Message shown to the user when a blocked address is submitted. */
export const COMPANY_EMAIL_REQUIRED_MESSAGE =
  'Please sign up with your company email address — free and personal email providers are not accepted.'

/** Basic RFC-pragmatic email shape check. */
export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/** Extract the lower-cased domain from an email address, or null if unparseable. */
export function emailDomain(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf('@')
  if (at === -1 || at === email.trim().length - 1) return null
  return email.trim().toLowerCase().slice(at + 1)
}

/**
 * True if the address belongs to a free consumer or disposable mail provider.
 * Unparseable input returns false — format validation is a separate concern.
 */
export function isBlockedEmailDomain(email: string): boolean {
  const domain = emailDomain(email)
  if (!domain) return false
  return BLOCKED_EMAIL_DOMAINS.has(domain)
}
