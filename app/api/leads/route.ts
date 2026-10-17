// POST /api/leads — public intake form on the marketing site
// (homepage contact section and /nav-end-of-support).
//
// Stores the enquiry in "Lead" and emails a notification. Either one
// succeeding counts as received: a DB hiccup still gets the email out, and a
// mail failure still leaves the row for follow-up.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/html-escape'
import { isHoneypotTripped, validateLead, type LeadInput } from '@/lib/leads'
import { RATE_LIMITS, clientIp, hitAndCheck, tooManyMessage } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const NOTIFY_TO = process.env.LEAD_NOTIFY_EMAIL ?? 'Admin@bespoxai.com'

function notificationHtml(lead: LeadInput): string {
  const row = (label: string, value: string | null) =>
    '<tr><td style="padding:6px 12px 6px 0;color:#8a9a8e;vertical-align:top">' + label +
    '</td><td style="padding:6px 0;color:#1a2a1e">' + (value ? escapeHtml(value) : '&mdash;') + '</td></tr>'
  return (
    '<div style="font-family:sans-serif;max-width:560px;color:#1a2a1e">' +
    '<h2 style="margin:0 0 16px;font-size:18px">New enquiry from bespoxai.com</h2>' +
    '<table style="font-size:14px;border-collapse:collapse">' +
    row('Name', lead.name) +
    row('Email', lead.email) +
    row('Company', lead.company) +
    row('Version', lead.navVersion) +
    row('Challenge', lead.challenge) +
    row('Page', lead.source) +
    '</table>' +
    (lead.message
      ? '<p style="margin:16px 0 4px;color:#8a9a8e;font-size:13px">Message</p>' +
        '<p style="margin:0;white-space:pre-wrap;font-size:14px;line-height:1.6">' + escapeHtml(lead.message) + '</p>'
      : '') +
    '</div>'
  )
}

export async function POST(req: NextRequest) {
  if (await hitAndCheck('lead:ip:' + clientIp(req.headers), RATE_LIMITS.leadIp))
    return NextResponse.json({ error: tooManyMessage(RATE_LIMITS.leadIp.windowSec) }, { status: 429 })

  const body = await req.json().catch(() => ({}))

  // Bots fill the hidden field: pretend success, store nothing.
  if (isHoneypotTripped(body)) return NextResponse.json({ ok: true })

  const result = validateLead(body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  const lead = result.lead

  let saved = false
  try {
    await prisma.lead.create({ data: lead })
    saved = true
  } catch (e: any) {
    console.error('[leads] insert failed', e?.message)
  }

  let emailed = false
  try {
    await sendEmail({
      to: NOTIFY_TO,
      subject: 'New enquiry: ' + (lead.company || lead.name) + (lead.navVersion ? ' (' + lead.navVersion + ')' : ''),
      html: notificationHtml(lead),
    })
    emailed = true
  } catch {
    // sendEmail already logs the failure
  }

  if (!saved && !emailed) {
    return NextResponse.json(
      { error: 'Sorry, we couldn’t send that just now. Please email Admin@bespoxai.com instead.' },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}
