// Partner plans — prices come from environment variables
// Keep pricing centralized and easy to update

export type PartnerPlanId = 'unbranded' | 'branded'

export interface PartnerPlan {
  id: PartnerPlanId
  name: string
  description: string
  allowsWhiteLabel: boolean
  monthlyPriceId: string | undefined
  annualPriceId: string | undefined
}

export const PARTNER_PLANS: PartnerPlan[] = [
  {
    id: 'unbranded',
    name: 'Partner',
    description: 'Basic partner program access',
    allowsWhiteLabel: false,
    monthlyPriceId: process.env.STRIPE_PARTNER_PRICE_UNBRANDED_MONTHLY,
    annualPriceId: process.env.STRIPE_PARTNER_PRICE_UNBRANDED_ANNUAL,
  },
  {
    id: 'branded',
    name: 'Partner Plus',
    description: 'Includes white-label branding',
    allowsWhiteLabel: true,
    monthlyPriceId: process.env.STRIPE_PARTNER_PRICE_BRANDED_MONTHLY,
    annualPriceId: process.env.STRIPE_PARTNER_PRICE_BRANDED_ANNUAL,
  },
]

export function getPartnerPlan(id: PartnerPlanId): PartnerPlan {
  return PARTNER_PLANS.find(p => p.id === id) ?? PARTNER_PLANS[0]
}

export function getPartnerPlanByPriceId(priceId: string): PartnerPlan | undefined {
  return PARTNER_PLANS.find(
    p => p.monthlyPriceId === priceId || p.annualPriceId === priceId
  )
}

export function canPartnerUseWhiteLabel(tier: string | null | undefined): boolean {
  if (!tier) return false
  const plan = getPartnerPlan(tier as PartnerPlanId)
  return plan.allowsWhiteLabel
}
