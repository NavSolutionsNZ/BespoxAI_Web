/**
 * lib/stripe-fees.ts
 *
 * Stripe NZ fee calculation and surcharge helpers.
 * Rates confirmed from Stripe dashboard May 2026:
 *   Domestic (NZ cards): 2.65% + NZ$0.30
 *   International cards: 3.50% + NZ$0.30
 *
 * Surcharge formula (customer absorbs fee, merchant receives full amount):
 *   chargeAmount = baseAmount / (1 - rate) + fixedFee
 *   fee = chargeAmount - baseAmount
 */

export const STRIPE_RATES = {
  domestic:      { pct: 0.0265, fixed: 0.30 },
  international: { pct: 0.035,  fixed: 0.30 },
} as const

/**
 * Calculate the surcharge amount to add so that after Stripe takes its cut,
 * you receive exactly `baseAmountNZD`.
 *
 * Returns amounts in NZD (dollars, not cents).
 */
export function calcSurcharge(baseAmountNZD: number, isInternational: boolean) {
  const rate      = isInternational ? STRIPE_RATES.international : STRIPE_RATES.domestic
  const chargeAmt = baseAmountNZD / (1 - rate.pct) + rate.fixed
  const fee       = chargeAmt - baseAmountNZD
  return {
    baseAmount:   Math.round(baseAmountNZD * 100) / 100,
    surcharge:    Math.round(fee * 100) / 100,
    totalCharged: Math.round(chargeAmt * 100) / 100,
    /** Total in cents for Stripe */
    totalCents:   Math.round(chargeAmt * 100),
    ratePct:      rate.pct,
    fixedFee:     rate.fixed,
    isInternational,
  }
}

/** Format a surcharge description for Stripe line item */
export function surchargeDescription(isInternational: boolean): string {
  const rate = isInternational ? STRIPE_RATES.international : STRIPE_RATES.domestic
  return `Card processing fee (${(rate.pct * 100).toFixed(2)}% + NZ$${rate.fixed.toFixed(2)})`
}

/** Determine if a tenant country code is international (non-NZ) */
export function isInternationalCountry(country: string | null | undefined): boolean {
  return (country ?? 'NZ').toUpperCase() !== 'NZ'
}
