'use client'

interface Props {
  reason: 'trial_expired' | 'token_limit_reached' | 'unknown' | string
  trialEndsAt?: string | null
}

const PLANS = [
  { name: 'Assistant', price: '$299/mo', tokens: '300,000 tokens' },
  { name: 'Manager',   price: '$499/mo', tokens: '750,000 tokens' },
  { name: 'Executive', price: '$999/mo', tokens: '3,000,000 tokens' },
]

export function UpgradePrompt({ reason, trialEndsAt }: Props) {
  const isTokenLimit = reason === 'token_limit_reached'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '96px 32px', textAlign: 'center' }}>
      <div style={{ background: '#0c1610', border: '1px solid rgba(200,149,42,0.25)', borderRadius: 16, padding: '40px', maxWidth: 480, width: '100%', boxShadow: '0 8px 40px rgba(4,14,9,0.3)' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.2)', margin: '0 auto 24px' }}>
          {isTokenLimit ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C8952A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C8952A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          )}
        </div>

        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: '#F4EFE4', marginBottom: 8 }}>
          {isTokenLimit ? 'Monthly AI limit reached' : reason === 'trial_expired' ? 'Your trial has ended' : 'Access restricted'}
        </h2>

        {reason === 'trial_expired' && trialEndsAt && (
          <p style={{ fontSize: 13, color: '#8a9a8e', marginBottom: 4 }}>
            Trial expired {new Date(trialEndsAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}

        <p style={{ fontSize: 14, color: '#8a9a8e', lineHeight: 1.6, margin: '12px 0 20px' }}>
          {isTokenLimit
            ? 'You\'ve used all your AI tokens for this month. Upgrade your plan to get more.'
            : 'Upgrade to a paid plan to continue using BespoxAI and all connected Business Central features.'}
        </p>

        {/* Plan comparison */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {PLANS.map(p => (
            <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 14px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#F4EFE4' }}>{p.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(200,149,42,0.8)' }}>✦ {p.tokens}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8a9a8e' }}>{p.price} plus GST</span>
            </div>
          ))}
        </div>

        <a
          href="/billing"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#C8952A', color: '#040E09', fontWeight: 700, fontSize: 14, padding: '12px 24px', borderRadius: 8, textDecoration: 'none', width: '100%', boxSizing: 'border-box' as const }}
        >
          View plans & upgrade
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </a>

        <p style={{ fontSize: 11, color: '#4a5a4e', marginTop: 16 }}>
          Or email <span style={{ color: '#8a9a8e' }}>auckland@bespoxai.com</span>
        </p>
      </div>
    </div>
  )
}
