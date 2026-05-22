'use client'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function BillingPageInner() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [interval, setInterval] = useState<'month' | 'year'>('month')
  const [loading, setLoading] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [toast, setToast]   = useState<string | null>(null)
  const [currentTier, setCurrentTier] = useState<string>('free')
  const [planName, setPlanName]       = useState<string | null>(null)
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null)
  const [prices, setPrices] = useState<Record<string, string | null>>({})

  const user = session?.user as any

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
    if (user?.role === 'superadmin') router.push('/admin')
  }, [status, user])

  useEffect(() => {
    fetch('/api/billing/status')
      .then(r => r.json())
      .then(d => {
        if (d.tier) setCurrentTier(d.tier)
        if (d.planName) setPlanName(d.planName)
        if (d.subscriptionStatus) setSubscriptionStatus(d.subscriptionStatus)
        if (d.prices) setPrices(d.prices)
        // starter prices may be null until configured
      })
      .catch(() => {})
  }, [])

  // Plan definitions with server-supplied price IDs
  const paid_plans = [
    {
      id: 'starter', name: 'Starter', monthlyNZD: 59, annualNZD: 649,
      description: 'Unlimited scoping + full feasibility output',
      tokens: '50,000',
      features: [
        'Everything in Free',
        '50,000 AI tokens per month',
        'Unlimited AI spec generation',
        'Full feasibility output with cost range',
        'Data health scanner (BC connection required)',
        'Email support',
      ],
      monthlyPriceId: prices.starter_month, annualPriceId: prices.starter_year,
    },
    {
      id: 'assistant', name: 'Assistant', monthlyNZD: 299, annualNZD: 3289,
      description: 'CFO Assistant with live BC data queries',
      tokens: '300,000',
      features: [
        'Everything in Starter',
        '300,000 AI tokens per month',
        'CFO Assistant — ask questions in plain English, get live BC answers',
        'Query history & data visualisation',
        '1 included spec review per month',
        'Priority support',
      ],
      monthlyPriceId: prices.assistant_month, annualPriceId: prices.assistant_year,
    },
    {
      id: 'manager', name: 'Manager', monthlyNZD: 499, annualNZD: 5489,
      description: 'Everything in Assistant + One Day Close',
      tokens: '750,000',
      features: [
        'Everything in Assistant',
        '750,000 AI tokens per month',
        '2 included spec reviews per month',
        'One Day Close Assistant (coming soon)',
        'Advanced reporting',
        'Priority support',
      ],
      monthlyPriceId: prices.manager_month, annualPriceId: prices.manager_year,
    },
    {
      id: 'executive', name: 'Executive', monthlyNZD: 999, annualNZD: 10989,
      description: 'Everything included + 10% off all paid services',
      tokens: '3,000,000',
      features: [
        'Everything in Manager',
        '3,000,000 AI tokens per month',
        '2 included spec reviews per month',
        '10% discount on all customisation work',
        '10% discount on Migration Analyser',
        'Dedicated support',
      ],
      monthlyPriceId: prices.executive_month, annualPriceId: prices.executive_year,
    },
  ]

  async function handleSubscribe(priceId: string | undefined, planId: string) {
    if (!priceId) { setError('Price not configured. Contact support.'); return }
    setLoading(planId)
    setError(null)
    setToast(null)
    try {
      const res = await fetch('/api/billing/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else if (data.updated) {
        const msg = data.direction === 'upgrade'
          ? '✓ Plan upgraded successfully. Changes take effect immediately.'
          : '✓ Plan downgraded. Changes will apply at your next billing date.'
        setToast(msg)
        setCurrentTier(planId)
        // Refresh billing status
        fetch('/api/billing/status').then(r => r.json()).then(d => {
          if (d.tier) setCurrentTier(d.tier)
        })
      } else if (data.alreadyOnPlan) {
        setToast('You are already on this plan.')
      } else {
        setError(data.error ?? 'Failed to update subscription')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  async function handlePortal() {
    setPortalLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/create-portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else setError(data.error ?? 'Could not open billing portal')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPortalLoading(false)
    }
  }

  const tierLabel: Record<string, string> = {
    free: 'Free', trial: 'Trial', starter: 'Starter', assistant: 'Assistant',
    manager: 'Manager', executive: 'Executive',
    paid: 'Paid', enterprise: 'Enterprise',
  }

  const hasActiveSub = subscriptionStatus === 'active' || subscriptionStatus === 'trialing'

  if (status === 'loading') return null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', fontFamily: 'var(--font-body)' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--fog)', background: 'var(--white)', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', display: 'flex', alignItems: 'center', gap: 6 }}>
          ← Back to Dashboard
        </button>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink)', fontWeight: 600 }}>
          BespokAI Billing
        </div>
        <div style={{ fontSize: 12, color: 'var(--slate)', fontFamily: 'var(--font-mono)' }}>
          Current plan: <strong style={{ color: 'var(--forest)' }}>{planName ?? tierLabel[currentTier] ?? currentTier}</strong>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 600, color: 'var(--ink)', margin: '0 0 12px' }}>
            Simple, transparent pricing
          </h1>
          <p style={{ fontSize: 15, color: 'var(--slate)', margin: '0 0 28px' }}>
            All prices in NZD, excl. GST (15%). GST is added at checkout. International customers pay in their local currency.
          </p>

          {/* Monthly / Annual toggle */}
          <div style={{ display: 'inline-flex', background: 'var(--parchment)', borderRadius: 10, padding: 4, gap: 2 }}>
            {(['month', 'year'] as const).map(i => (
              <button key={i} onClick={() => setInterval(i)} style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: interval === i ? 'var(--white)' : 'transparent',
                boxShadow: interval === i ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13,
                fontWeight: interval === i ? 600 : 400,
                color: interval === i ? 'var(--ink)' : 'var(--slate)',
                transition: 'all 0.15s',
              }}>
                {i === 'month' ? 'Monthly' : 'Annual'}
                {i === 'year' && <span style={{ marginLeft: 6, fontSize: 10, background: 'rgba(10,92,70,0.1)', color: 'var(--forest)', padding: '2px 6px', borderRadius: 6, fontFamily: 'var(--font-mono)' }}>1 month free</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Toast / Error */}
        {toast && (
          <div style={{ background: 'rgba(10,92,70,0.08)', border: '1px solid rgba(10,92,70,0.25)', color: 'var(--forest)', borderRadius: 8, padding: '10px 16px', marginBottom: 24, fontSize: 13, textAlign: 'center' }}>
            {toast}
          </div>
        )}
        {error && (
          <div style={{ background: 'rgba(226,75,74,0.08)', border: '1px solid rgba(226,75,74,0.3)', color: '#c0392b', borderRadius: 8, padding: '10px 16px', marginBottom: 24, fontSize: 13, textAlign: 'center' }}>
            {error}
          </div>
        )}

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, marginBottom: 40 }}>

          {/* Free card */}
          <div style={{ background: 'var(--white)', border: `2px solid ${currentTier === 'free' ? 'var(--forest)' : 'var(--fog)'}`, borderRadius: 16, padding: '28px 24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>Free</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>$0</div>
            <div style={{ fontSize: 12, color: 'var(--slate)', marginBottom: 20 }}>Forever free</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1 }}>
              {[
                'Unlimited feasibility checks',
                '1 free AI specification (evaluate the quality)',
                'Full development pipeline access',
                'Migration Analyser access',
              ].map(f => (
                <li key={f} style={{ fontSize: 13, color: 'var(--slate)', padding: '5px 0', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: 'var(--jade)', flexShrink: 0, marginTop: 1 }}>✓</span>{f}
                </li>
              ))}
              <li style={{ fontSize: 13, color: 'rgba(59,82,73,0.45)', padding: '5px 0', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}>○</span>Data health scanner (requires BC connection)
              </li>
            </ul>
            {currentTier === 'free' ? (
              <div style={{ textAlign: 'center', padding: '10px', borderRadius: 8, background: 'rgba(10,92,70,0.06)', color: 'var(--forest)', fontSize: 13, fontWeight: 600 }}>Current plan</div>
            ) : (
              <div style={{ textAlign: 'center', padding: '10px', borderRadius: 8, background: 'var(--parchment)', color: 'var(--slate)', fontSize: 13 }}>No subscription needed</div>
            )}
          </div>

          {/* Paid plan cards */}
          {paid_plans.map(plan => {
            const isPopular = plan.id === 'assistant'
            const isCurrent = currentTier === plan.id
            const priceId = (interval === 'month' ? plan.monthlyPriceId : plan.annualPriceId) ?? undefined
            const displayPrice = interval === 'month' ? plan.monthlyNZD : Math.round(plan.annualNZD / 12)

            return (
              <div key={plan.id} style={{
                background: isPopular ? 'var(--forest)' : 'var(--white)',
                border: `2px solid ${isCurrent ? 'var(--amber)' : isPopular ? 'var(--forest)' : 'var(--fog)'}`,
                borderRadius: 16, padding: '28px 24px',
                display: 'flex', flexDirection: 'column',
                position: 'relative',
                boxShadow: isPopular ? '0 8px 32px rgba(10,92,70,0.2)' : 'none',
              }}>
                {isPopular && (
                  <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--amber)', color: '#fff', fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '3px 12px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                    Most popular
                  </div>
                )}

                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: isPopular ? 'rgba(244,239,228,0.6)' : 'var(--slate)', marginBottom: 8 }}>{plan.name}</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 4 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, color: isPopular ? 'var(--cream)' : 'var(--ink)', lineHeight: 1 }}>${displayPrice}</div>
                  <div style={{ fontSize: 12, color: isPopular ? 'rgba(244,239,228,0.6)' : 'var(--slate)', marginBottom: 2 }}>/mo{interval === 'year' ? ' · billed annually' : ''}</div>
                  <div style={{ fontSize: 10, color: isPopular ? 'rgba(244,239,228,0.5)' : 'var(--slate)', marginBottom: 6, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>excl. GST</div>
                </div>
                <div style={{ fontSize: 12, color: isPopular ? 'rgba(244,239,228,0.5)' : 'var(--slate)', marginBottom: 12 }}>{plan.description}</div>

                {/* Token allowance badge */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: isPopular ? 'rgba(200,149,42,0.15)' : 'rgba(10,92,70,0.06)', border: `1px solid ${isPopular ? 'rgba(200,149,42,0.3)' : 'rgba(10,92,70,0.15)'}`, borderRadius: 8, padding: '5px 10px', marginBottom: 20, alignSelf: 'flex-start' }}>
                  <span style={{ fontSize: 10 }}>✦</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', color: isPopular ? 'rgba(200,149,42,0.9)' : 'var(--forest)', fontWeight: 600 }}>
                    {(plan as any).tokens} AI tokens / month
                  </span>
                </div>

                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1 }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ fontSize: 13, color: isPopular ? 'rgba(244,239,228,0.85)' : 'var(--slate)', padding: '5px 0', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ color: isPopular ? 'var(--amber)' : 'var(--jade)', flexShrink: 0, marginTop: 1 }}>✓</span>{f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <button onClick={handlePortal} disabled={portalLoading} style={{
                    width: '100%', padding: '11px', borderRadius: 10, border: `1px solid ${isPopular ? 'rgba(244,239,228,0.3)' : 'var(--fog)'}`,
                    background: 'transparent', cursor: portalLoading ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
                    color: isPopular ? 'var(--cream)' : 'var(--forest)',
                    opacity: portalLoading ? 0.6 : 1,
                  }}>
                    {portalLoading ? 'Opening…' : 'Manage subscription'}
                  </button>
                ) : (
                  <button onClick={() => handleSubscribe(priceId, plan.id)} disabled={!!loading} style={{
                    width: '100%', padding: '11px', borderRadius: 10, border: 'none',
                    background: isPopular ? 'var(--amber)' : 'var(--forest)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#fff',
                    opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s',
                  }}>
                    {loading === plan.id ? 'Redirecting…' : hasActiveSub ? 'Switch to this plan' : 'Get started'}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Manage existing subscription */}
        {hasActiveSub && (
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <button onClick={handlePortal} disabled={portalLoading} style={{ background: 'none', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 20px', cursor: portalLoading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)' }}>
              {portalLoading ? 'Opening…' : '⚙ Manage billing, invoices & cancellation'}
            </button>
          </div>
        )}

        {/* Review fee note */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 12, padding: '20px 24px', marginBottom: 32, maxWidth: 600, margin: '0 auto 32px' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--forest)', marginBottom: 8 }}>Senior Developer Review — $249 NZD excl. GST</p>
          <p style={{ fontSize: 13, color: 'var(--slate)', lineHeight: 1.65, margin: 0 }}>
            Every specification is reviewed by a senior BC developer before a quote is issued — so every quote you receive has been validated by a human, not generated directly from AI output.
            The $249 review fee applies to all plans and is <strong style={{ color: 'var(--ink)' }}>credited in full against development costs</strong> if you proceed.
            Manager and Executive plan customers receive included reviews each month.
          </p>
        </div>

        {/* FAQ note */}
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--slate)', lineHeight: 1.6 }}>
          Cancel anytime. Customisations and Migration Analyser are available on all plans as separately priced services.
          {currentTier === 'executive' && ' Executive plan customers receive a 10% discount on all paid services.'}
        </div>

      </div>
    </div>
  )
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingPageInner />
    </Suspense>
  )
}
