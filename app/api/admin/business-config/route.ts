/**
 * GET  /api/admin/business-config — return current config
 * POST /api/admin/business-config — save new config
 * Superadmin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getBusinessConfig, invalidateBusinessConfigCache } from '@/lib/business-config'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

async function guard() {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin') return null
  return session
}

export async function GET() {
  const session = await guard()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(await getBusinessConfig())
}

export async function POST(req: NextRequest) {
  const session = await guard()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body      = await req.json()
  const adminEmail = (session.user as any).email ?? 'superadmin'

  const data = {
    companyName:     body.companyName     ?? 'Nav Solutions NZ',
    gstNumber:       body.gstNumber       || null,
    email:           body.email           ?? 'auckland@bespoxai.com',
    phone:           body.phone           || null,
    website:         body.website         ?? 'bespoxai.com',
    address:         body.address         || null,
    bankName:        body.bankName        || null,
    bankAccount:     body.bankAccount     || null,
    bankAccountName: body.bankAccountName || null,
    invoiceFooter:   body.invoiceFooter   ?? 'Thank you for choosing BespoxAI',
    terms1Label:     body.terms1Label     ?? 'Standard',
    terms1Text:      body.terms1Text      ?? '20% deposit on acceptance; 80% on delivery',
    terms2Label:     body.terms2Label     ?? 'Deposit + Monthly',
    terms2Text:      body.terms2Text      ?? '20% deposit on acceptance; balance due 20th of following month',
    terms3Label:     body.terms3Label     ?? 'Account',
    terms3Text:      body.terms3Text      ?? 'Full amount due 20th of the following month',
    updatedBy:       adminEmail,
  }

  await (prisma as any).businessConfig.upsert({
    where:  { id: 'default' },
    update: data,
    create: { id: 'default', ...data },
  })

  invalidateBusinessConfigCache()
  return NextResponse.json(await getBusinessConfig())
}
