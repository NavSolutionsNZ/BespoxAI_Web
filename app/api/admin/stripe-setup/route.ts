/**
 * POST /api/admin/stripe-setup
 * One-time route — creates all BespokAI Stripe products and prices.
 * Superadmin only. Run once after deployment, then add returned price IDs
 * to Vercel environment variables.
 */
import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/api-auth'
import { stripe } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

const PLANS = [
  {
    id: 'assistant',
    name: 'BespokAI Assistant',
    description: 'CFO Assistant + Customisations + Migration Analyser',
    monthlyAmountNZD: 29900,   // $299.00
    annualAmountNZD: 328900,   // $3,289.00 (11 months)
    envMonthly: 'STRIPE_PRICE_ASSISTANT_MONTHLY',
    envAnnual: 'STRIPE_PRICE_ASSISTANT_ANNUAL',
  },
  {
    id: 'manager',
    name: 'BespokAI Manager',
    description: 'Assistant + One Day Close (coming soon) + everything in Assistant',
    monthlyAmountNZD: 49900,   // $499.00
    annualAmountNZD: 548900,   // $5,489.00 (11 months)
    envMonthly: 'STRIPE_PRICE_MANAGER_MONTHLY',
    envAnnual: 'STRIPE_PRICE_MANAGER_ANNUAL',
  },
  {
    id: 'executive',
    name: 'BespokAI Executive',
    description: 'Everything + 10% discount on all paid services',
    monthlyAmountNZD: 99900,   // $999.00
    annualAmountNZD: 1098900,  // $10,989.00 (11 months)
    envMonthly: 'STRIPE_PRICE_EXECUTIVE_MONTHLY',
    envAnnual: 'STRIPE_PRICE_EXECUTIVE_ANNUAL',
  },
]

export async function POST(req: Request) {
  const session = await requireSuperadmin()
  if (session instanceof NextResponse) return session

  const results: Record<string, string> = {}
  const envLines: string[] = []

  for (const plan of PLANS) {
    // Create product
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { bespokaiPlanId: plan.id },
    })

    // Monthly price
    const monthly = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.monthlyAmountNZD,
      currency: 'nzd',
      recurring: { interval: 'month' },
      metadata: { bespokaiPlanId: plan.id, interval: 'month' },
    })

    // Annual price
    const annual = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.annualAmountNZD,
      currency: 'nzd',
      recurring: { interval: 'year' },
      metadata: { bespokaiPlanId: plan.id, interval: 'year' },
    })

    results[plan.envMonthly] = monthly.id
    results[plan.envAnnual] = annual.id
    envLines.push(`${plan.envMonthly}=${monthly.id}`)
    envLines.push(`${plan.envAnnual}=${annual.id}`)
  }

  return NextResponse.json({
    success: true,
    message: 'Products and prices created. Add these to Vercel environment variables:',
    envVars: results,
    envBlock: envLines.join('\n'),
  })
}
