import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { contactName, phone, version, users, urgency, notes } = body

  if (!phone || !version || !users) {
    return NextResponse.json({ error: 'Missing required fields: phone, version, users' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { email: (session.user as any).email! },
    include: { tenant: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Save to DB
  await (prisma as any).migrationEnquiry.create({
    data: {
      tenantId:    user.tenantId,
      userId:      user.id,
      contactName: contactName || user.name || null,
      phone,
      version,
      users,
      urgency:     urgency || null,
      notes:       notes   || null,
      status:      'new',
    },
  })

  const urgencyLabels: Record<string, string> = {
    exploring: 'Just exploring options',
    planning:  'Planning for next 12 months',
    urgent:    'Need to move soon',
    crisis:    'Upgrade is overdue / business critical',
  }

  const adminEmail = process.env.SUPERADMIN_EMAIL ?? process.env.EMAIL_FROM ?? 'admin@bespoxai.com'

  await sendEmail({
    to:      adminEmail,
    subject: `🏗️ Migration Analysis Request — ${user.tenant?.name ?? 'Unknown'}`,
    html: `
      <div style="font-family:sans-serif;max-width:620px;color:#040E09">
        <h2 style="color:#0A5C46;margin-bottom:4px">New Migration Analysis Request</h2>
        <p style="color:#3B5249;margin-top:0">Submitted via BespokAI dashboard</p>
        <table style="width:100%;border-collapse:collapse;margin-top:20px">
          ${[
            ['Tenant',        user.tenant?.name ?? 'Unknown'],
            ['Contact Name',  contactName || user.name || '—'],
            ['Email',         user.email],
            ['Phone',         phone],
            ['NAV/BC Version', version],
            ['Number of Users', users],
            ['Urgency',       urgencyLabels[urgency] || urgency || 'Not specified'],
            ['Notes',         notes || '—'],
          ].map(([label, value]) => `
            <tr style="border-bottom:1px solid #D6D9D4">
              <td style="padding:10px 12px;font-weight:600;color:#3B5249;width:160px">${label}</td>
              <td style="padding:10px 12px;color:#040E09">${value}</td>
            </tr>
          `).join('')}
        </table>
        <p style="margin-top:20px;font-size:13px;color:#3B5249">
          <a href="${process.env.NEXTAUTH_URL ?? 'https://app.bespoxai.com'}/admin" style="color:#0A5C46">
            View in BespokAI Admin →
          </a>
        </p>
      </div>
    `,
  })

  return NextResponse.json({ ok: true })
}
