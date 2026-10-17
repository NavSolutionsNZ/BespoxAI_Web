// lib/leads.ts — validation for the public marketing-site intake form.
//
// The form itself is rendered by public/lead-form.js, which carries its own
// copy of the option lists (it is plain browser JS served from /public, so it
// cannot import this file). Keep the two lists in step: anything the form
// offers that is not listed here is stored as 'Other'.

import { isValidEmailFormat, isBlockedEmailDomain } from './email-domains'

export const LEAD_VERSIONS = [
  'Navision 4.0 / 5.0 (Classic)',
  'NAV 2009 / 2009 R2',
  'NAV 2013 / 2013 R2',
  'NAV 2015',
  'NAV 2016',
  'NAV 2017',
  'NAV 2018',
  'Business Central 13 / 14 (on-premises)',
  'Business Central 15+ (on-premises)',
  'Not sure',
] as const

export const LEAD_CHALLENGES = [
  'Finance reporting and month-end',
  'Getting answers out of NAV without IT',
  'NAV end of support / staying on NAV',
  'Planning an upgrade to Business Central',
  'Customisation needed or broken',
  'Our partner no longer supports our NAV',
  'Something else',
] as const

export const LEAD_SOURCES = ['homepage', 'nav-end-of-support'] as const

export const LEAD_EMAIL_MESSAGE =
  'Please use your work email address — free and personal email providers are not accepted.'

export type LeadInput = {
  name: string
  email: string
  company: string | null
  navVersion: string | null
  challenge: string | null
  message: string | null
  source: string
}

export type LeadValidation =
  | { ok: true; lead: LeadInput }
  | { ok: false; error: string }

const MAX = { name: 120, email: 254, company: 160, message: 2000 }

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function pick(value: unknown, allowed: readonly string[], fallback: string | null): string | null {
  const v = clean(value, 200)
  if (!v) return null
  return allowed.includes(v) ? v : fallback
}

/** True when the honeypot field was filled in (bots fill every input). */
export function isHoneypotTripped(body: any): boolean {
  return clean(body?.website, 200) !== ''
}

export function validateLead(body: any): LeadValidation {
  const name = clean(body?.name, MAX.name)
  const email = clean(body?.email, MAX.email).toLowerCase()

  if (!name) return { ok: false, error: 'Please tell us your name.' }
  if (!email || !isValidEmailFormat(email)) return { ok: false, error: 'Please enter a valid email address.' }
  if (isBlockedEmailDomain(email)) return { ok: false, error: LEAD_EMAIL_MESSAGE }

  return {
    ok: true,
    lead: {
      name,
      email,
      company: clean(body?.company, MAX.company) || null,
      navVersion: pick(body?.navVersion, LEAD_VERSIONS, 'Other'),
      challenge: pick(body?.challenge, LEAD_CHALLENGES, 'Other'),
      message: clean(body?.message, MAX.message) || null,
      source: pick(body?.source, LEAD_SOURCES, 'homepage') ?? 'homepage',
    },
  }
}
