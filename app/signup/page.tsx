'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { isBlockedEmailDomain, COMPANY_EMAIL_REQUIRED_MESSAGE } from '@/lib/email-domains'

const COUNTRIES = [
  { code: 'NZ', label: 'New Zealand' },
  { code: 'AU', label: 'Australia' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'ZA', label: 'South Africa' },
]

const BC_VERSIONS = [
  { value: 'BC25', label: 'Business Central 2025 (BC25)' },
  { value: 'BC24', label: 'Business Central 2024 Wave 2 (BC24)' },
  { value: 'BC23', label: 'Business Central 2024 Wave 1 (BC23)' },
  { value: 'BC22', label: 'Business Central 2023 Wave 2 (BC22)' },
  { value: 'BC21', label: 'Business Central 2023 Wave 1 (BC21)' },
  { value: 'BC20', label: 'Business Central 2022 Wave 2 (BC20)' },
  { value: 'BC19', label: 'Business Central 2022 Wave 1 (BC19)' },
  { value: 'BC18', label: 'Business Central 2021 Wave 2 (BC18)' },
  { value: 'BC17', label: 'Business Central 2021 Wave 1 (BC17)' },
  { value: 'BC16', label: 'Business Central 2020 Wave 2 (BC16)' },
  { value: 'BC15', label: 'Business Central 2020 Wave 1 (BC15)' },
  { value: 'BC14', label: 'Business Central 2019 Wave 1 (BC14)' },
]

const NAV_VERSIONS = [
  { value: 'NAV2018',   label: 'Microsoft NAV 2018' },
  { value: 'NAV2017',   label: 'Microsoft NAV 2017' },
  { value: 'NAV2016',   label: 'Microsoft NAV 2016' },
  { value: 'NAV2015',   label: 'Microsoft NAV 2015' },
  { value: 'NAV2013R2', label: 'Microsoft NAV 2013 R2' },
  { value: 'NAV2013',   label: 'Microsoft NAV 2013' },
  { value: 'NAV2009R2', label: 'Microsoft NAV 2009 R2' },
  { value: 'NAV2009',   label: 'Microsoft NAV 2009' },
]

export default function SignupPage() {
  const [form, setForm]       = useState({ companyName: '', country: 'NZ', bcVersion: 'BC25', email: '' })
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState('')

  function update(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setError('')
  }

  async function handleSubmit() {
    if (!form.companyName.trim() || !form.email.trim()) {
      setError('Company name and email are required.')
      return
    }
    if (isBlockedEmailDomain(form.email)) {
      setError(COMPANY_EMAIL_REQUIRED_MESSAGE)
      return
    }
    if (!termsAccepted) {
      setError('Please accept the Terms of Service to continue.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/signup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...form, termsAccepted }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return }
      setDone(true)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: '#f7f5f0', border: '1px solid #e0dbd4',
    borderRadius: 8, padding: '11px 14px',
    fontSize: 14, color: '#040E09',
    fontFamily: 'inherit', outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600,
    color: '#3a4a3e', marginBottom: 6, letterSpacing: '0.02em',
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'var(--font-body)' }}>

      {/* Logo — links home */}
      <a href="/index.html" style={{ marginBottom: 32, textAlign: 'center', textDecoration: 'none', display: 'block' }}>
        <span style={{ fontFamily: 'var(--font-cormorant)', fontSize: 32, fontWeight: 600, color: '#F4EFE4' }}>
          Bespox<span style={{ color: '#C8952A' }}>AI</span>
        </span>
        <p style={{ color: '#8a9a8e', fontSize: 14, marginTop: 6 }}>
          CFO Intelligence for Business Central & Microsoft NAV
        </p>
      </a>

      <div style={{ background: '#ffffff', borderRadius: 16, padding: 'clamp(24px, 5vw, 40px) clamp(20px, 5vw, 40px)', width: '100%', maxWidth: 440, boxShadow: '0 8px 40px rgba(4,14,9,0.3)' }}>

        {done ? (
          /* ── Success state ── */
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>✉️</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#040E09', marginBottom: 12 }}>
              Check your inbox
            </h2>
            <p style={{ fontSize: 14, color: '#5a6a5e', lineHeight: 1.65 }}>
              We've sent a verification email to <strong>{form.email}</strong>.
              Click the link in the email to confirm your address.
            </p>
            <p style={{ fontSize: 13, color: '#8a9a8e', marginTop: 16, lineHeight: 1.6 }}>
              Once verified, our team will review your request and send your login credentials shortly.
            </p>
            <a href="/login" style={{ display: 'inline-block', marginTop: 24, color: '#0A5C46', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              ← Back to login
            </a>
          </div>
        ) : (
          /* ── Form ── */
          <>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#040E09', marginBottom: 4 }}>
              Start your free trial
            </h1>
            <p style={{ fontSize: 13, color: '#8a9a8e', marginBottom: 28 }}>
              7 days free · No credit card required
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={labelStyle}>Company name</label>
                <input
                  style={inputStyle}
                  placeholder="Acme NZ Ltd"
                  value={form.companyName}
                  onChange={e => update('companyName', e.target.value)}
                  onFocus={e => (e.target.style.borderColor = '#0A5C46')}
                  onBlur={e => (e.target.style.borderColor = '#e0dbd4')}
                />
              </div>

              <div>
                <label style={labelStyle}>Work email</label>
                <input
                  style={inputStyle}
                  type="email"
                  placeholder="you@company.com"
                  value={form.email}
                  onChange={e => update('email', e.target.value)}
                  onFocus={e => (e.target.style.borderColor = '#0A5C46')}
                  onBlur={e => (e.target.style.borderColor = '#e0dbd4')}
                />
              </div>

              <div>
                <label style={labelStyle}>Country</label>
                <select
                  style={inputStyle}
                  value={form.country}
                  onChange={e => update('country', e.target.value)}
                >
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>BC / NAV version</label>
                <select
                  style={inputStyle}
                  value={form.bcVersion}
                  onChange={e => update('bcVersion', e.target.value)}
                >
                  <optgroup label="Business Central">
                    {BC_VERSIONS.map(v => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Microsoft NAV">
                    {NAV_VERSIONS.map(v => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#3B5249', lineHeight: 1.5, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={e => { setTermsAccepted(e.target.checked); setError('') }}
                  style={{ marginTop: 3, accentColor: '#0A5C46', width: 15, height: 15, flexShrink: 0 }}
                />
                <span>
                  I agree to the BespoxAI{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: '#0A5C46', fontWeight: 600 }}>
                    Terms of Service
                  </a>
                </span>
              </label>

              {error && (
                <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#991b1b' }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading}
                style={{
                  background: loading ? '#e0dbd4' : '#0A5C46',
                  color: loading ? '#8a9a8e' : '#fff',
                  border: 'none', borderRadius: 8,
                  padding: '13px 24px', fontSize: 15,
                  fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                  width: '100%', transition: 'background 0.15s',
                }}
              >
                {loading ? 'Sending…' : 'Request access →'}
              </button>
            </div>

            <p style={{ fontSize: 12, color: '#8a9a8e', textAlign: 'center', marginTop: 20 }}>
              Already have an account?{' '}
              <a href="/login" style={{ color: '#0A5C46', fontWeight: 600, textDecoration: 'none' }}>Sign in</a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
