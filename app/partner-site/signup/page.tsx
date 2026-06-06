'use client'

import { useState } from 'react'
import Link from 'next/link'
import AgreementScroll from '@/components/AgreementScroll'

const inp: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: '#F4EFE4',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  boxSizing: 'border-box' as const,
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
  color: 'rgba(244,239,228,0.5)',
  display: 'block',
  marginBottom: 6,
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(244,239,228,0.35)', margin: '5px 0 0' }}>{hint}</p> : null}
    </div>
  )
}

function SectionHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 12, marginBottom: 24 }}>
      <h2 style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, color: '#F4EFE4', margin: 0 }}>{title}</h2>
      {sub ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(244,239,228,0.45)', margin: '4px 0 0' }}>{sub}</p> : null}
    </div>
  )
}

export default function PartnerSignupPage() {
  const [form, setForm] = useState({
    companyName: '', contactName: '', email: '', phone: '', address: '',
    gstNumber: '', billingEmail: '',
    paymentMode: 'bespoxai_collected',
    bankAccount: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [showAgreement, setShowAgreement] = useState(false)
  const [agreementAcceptedAt, setAgreementAcceptedAt] = useState<string | null>(null)

  function set(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
    if (key === 'companyName' && !form.billingEmail) {
      // Keep billing email in sync with contact email until user edits it
    }
  }

  async function handleSubmit() {
    setError('')
    if (!form.companyName || !form.contactName || !form.email || !form.phone || !form.address) {
      setError('Please complete all required fields.')
      return
    }
    if (form.paymentMode === 'bespoxai_collected' && !form.bankAccount) {
      setError('Please provide a bank account number for revenue share payouts.')
      return
    }

    // Show agreement modal instead of submitting immediately
    setShowAgreement(true)
  }

  async function handleAcceptAgreement() {
    setSubmitting(true)
    setError('')
    const acceptedAt = new Date().toISOString()
    setAgreementAcceptedAt(acceptedAt)
    
    const res = await fetch('/api/partner-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        billingEmail: form.billingEmail || form.email,
        acceptedAgreementAt: acceptedAt,
      }),
    })
    setSubmitting(false)

    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Something went wrong. Please try again.')
      setShowAgreement(false)
      return
    }

    setShowAgreement(false)
    setDone(true)
  }

  function handleDeclineAgreement() {
    setShowAgreement(false)
  }

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#040E09', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 20 }}>✉</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 400, color: '#F4EFE4', margin: '0 0 16px' }}>Check your inbox</h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'rgba(244,239,228,0.6)', lineHeight: 1.7, marginBottom: 8 }}>
            We have sent a verification link to <strong style={{ color: '#F4EFE4' }}>{form.email}</strong>.
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'rgba(244,239,228,0.45)', lineHeight: 1.7 }}>
            Once verified, the BespoxAI team will review your application and be in touch shortly.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#040E09', color: '#F4EFE4', fontFamily: 'var(--font-body)' }}>

      {/* Agreement modal */}
      {showAgreement && (
        <AgreementScroll
          onAccept={handleAcceptAgreement}
          onDecline={handleDeclineAgreement}
          isSubmitting={submitting}
        />
      )}

      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 48px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Link href="/" style={{ fontFamily: 'var(--font-mono)', fontSize: 14, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#F4EFE4', textDecoration: 'none' }}>
          Bespox<span style={{ color: '#C8952A' }}>AI</span>
          <span style={{ marginLeft: 12, fontSize: 10, color: 'rgba(244,239,228,0.4)' }}>PARTNERS</span>
        </Link>
        <Link href="/login" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(244,239,228,0.5)', textDecoration: 'none', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Sign in
        </Link>
      </nav>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '60px 24px 80px' }}>
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, color: '#F4EFE4', margin: '0 0 10px' }}>Apply to become a partner</h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'rgba(244,239,228,0.5)', margin: 0, lineHeight: 1.6 }}>
            Complete the form below. Once you verify your email, the BespoxAI team will review your application and activate your account.
          </p>
        </div>

        {/* Company */}
        <SectionHeading title="Company details" />

        <Field label="Company name *">
          <input style={inp} value={form.companyName} onChange={e => set('companyName', e.target.value)} placeholder="Acme Consulting Ltd" />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Phone *">
            <input style={inp} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+64 9 123 4567" />
          </Field>
          <Field label="GST number" hint="NZ format: 123-456-789">
            <input style={inp} value={form.gstNumber} onChange={e => set('gstNumber', e.target.value)} placeholder="123-456-789" />
          </Field>
        </div>

        <Field label="Physical address *">
          <textarea
            style={{ ...inp, minHeight: 72, resize: 'vertical' as const }}
            value={form.address}
            onChange={e => set('address', e.target.value)}
            placeholder={'123 Business Street\nAuckland 1010\nNew Zealand'}
          />
        </Field>

        {/* Contact */}
        <SectionHeading title="Primary contact" sub="This person will be the first partner admin." />

        <Field label="Full name *">
          <input style={inp} value={form.contactName} onChange={e => set('contactName', e.target.value)} placeholder="Jane Smith" />
        </Field>

        <Field label="Email address *" hint="Used to log in to the partner portal.">
          <input style={inp} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@acmeconsulting.co.nz" />
        </Field>

        <Field label="Billing email" hint="Leave blank to use the same email as above.">
          <input style={inp} type="email" value={form.billingEmail} onChange={e => set('billingEmail', e.target.value)} placeholder="accounts@acmeconsulting.co.nz" />
        </Field>

        {/* Billing */}
        <SectionHeading title="Payment arrangement" sub="How would you like client pipeline payments to be handled?" />

        <Field label="Payment mode *">
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
            {[
              ['bespoxai_collected', 'BespoxAI collects from clients', 'We handle Stripe payments. Your revenue share is paid to you monthly on invoice.'],
              ['partner_collected', 'I collect from clients directly', 'You invoice your clients yourself. BespoxAI invoices you for our share of each completed job.'],
            ].map(([val, label, desc]) => (
              <label key={val} style={{
                display: 'flex', gap: 14, alignItems: 'flex-start',
                background: form.paymentMode === val ? 'rgba(10,92,70,0.15)' : 'rgba(255,255,255,0.03)',
                border: '1px solid ' + (form.paymentMode === val ? 'rgba(10,92,70,0.4)' : 'rgba(255,255,255,0.08)'),
                borderRadius: 8, padding: '14px 16px', cursor: 'pointer',
              }}>
                <input type="radio" name="paymentMode" value={val} checked={form.paymentMode === val} onChange={() => set('paymentMode', val)} style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: '#F4EFE4', marginBottom: 3 }}>{label}</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(244,239,228,0.5)', lineHeight: 1.5 }}>{desc}</div>
                </div>
              </label>
            ))}
          </div>
        </Field>

        {form.paymentMode === 'bespoxai_collected' ? (
          <Field label="Bank account (NZ) *" hint="For revenue share payouts from BespoxAI. You will invoice us before payment is released.">
            <input style={inp} value={form.bankAccount} onChange={e => set('bankAccount', e.target.value)} placeholder="12-3456-7890123-00" />
          </Field>
        ) : null}

        {error ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#E24B4A', margin: '0 0 20px', background: 'rgba(226,75,74,0.08)', border: '1px solid rgba(226,75,74,0.2)', borderRadius: 6, padding: '10px 14px' }}>
            {error}
          </p>
        ) : null}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: '100%',
            padding: '13px 24px',
            borderRadius: 8,
            border: 'none',
            background: submitting ? 'rgba(10,92,70,0.5)' : '#0A5C46',
            color: '#F4EFE4',
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
            letterSpacing: '0.02em',
          }}
        >
          {submitting ? 'Submitting...' : 'Submit application'}
        </button>


      </div>
    </div>
  )
}
