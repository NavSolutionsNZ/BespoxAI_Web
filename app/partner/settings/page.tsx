'use client'

import { useState, useEffect, useRef } from 'react'
import { canPartnerUseWhiteLabel } from '@/lib/partner-plans'
import { useSession } from 'next-auth/react'

type PartnerAccount = {
  id: string
  name: string
  slug: string
  contactName: string | null
  phone: string | null
  address: string | null
  gstNumber: string | null
  billingEmail: string
  brandName: string | null
  logoUrl: string | null
  agentBrandName: string | null
  isWhiteLabel: boolean
  fromEmail: string | null
  githubOrg: string | null
  githubToken: string | null
  stripeSubscriptionId: string | null
  subscriptionStatus: string | null
  subscriptionTier: string | null
}
type UserProfile = {
  firstName: string | null
  lastName: string | null
  preferredName: string | null
  email: string
}



// ── Shared UI helpers ─────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: description ? 4 : 0 }}>
        {title}
      </div>
      {description ? (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6B7B70', marginTop: 2 }}>{description}</div>
      ) : null}
    </div>
  )
}

function Field({ label, value, hint }: { label: string; value: string | null | undefined; hint?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, color: '#8B949E', marginBottom: 4 }}>{label}</label>
      <div style={{ background: '#0D1117', border: '1px solid #21262D', borderRadius: 6, padding: '7px 10px', fontFamily: 'var(--font-body)', fontSize: 13, color: value ? '#C9D1D9' : '#4A5568' }}>
        {value || '\u2014'}
      </div>
      {hint ? <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6B7B70', marginTop: 3 }}>{hint}</div> : null}
    </div>
  )
}

function Input({ label, name, defaultValue, placeholder, hint, type = 'text' }: {
  label: string; name: string; defaultValue?: string | null; placeholder?: string; hint?: string; type?: string
}) {
  return (
    <div>
      <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, color: '#8B949E', marginBottom: 4 }}>{label}</label>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 10px', boxSizing: 'border-box' }}
      />
      {hint ? <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6B7B70', marginTop: 3 }}>{hint}</div> : null}
    </div>
  )
}

function SaveButton({ saving, label = 'Save changes' }: { saving: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={saving}
      style={{ background: saving ? '#21262D' : '#238636', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, padding: '8px 20px', cursor: saving ? 'default' : 'pointer' }}
    >
      {saving ? 'Saving...' : label}
    </button>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, padding: '24px', marginBottom: 24 }}>
      {children}
    </div>
  )
}

function grid(cols: number): React.CSSProperties {
  return { display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PartnerSettings() {
  const { data: session } = useSession()
  const user = session?.user as any
  const isAdmin = user?.partnerRole === 'partner_admin'

  const [account, setAccount] = useState<PartnerAccount | null>(null)
  const [loading, setLoading] = useState(true)

  // Per-section saving + feedback
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [sectionMsg, setSectionMsg] = useState<Record<string, string>>({})

  // Change password state
  const currentPwRef  = useRef<HTMLInputElement>(null)
  const newPwRef      = useRef<HTMLInputElement>(null)
  const confirmPwRef  = useRef<HTMLInputElement>(null)
  const [pwMsg, setPwMsg] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [enableWhiteLabel, setEnableWhiteLabel] = useState(false)
  
  // Load initial data
  useEffect(() => {
    Promise.all([
      fetch('/api/partner/account').then(r => r.ok ? r.json() : null),
      fetch('/api/partner/profile').then(r => r.ok ? r.json() : null),
    ]).then(([accData, profData]) => {
      if (accData) {
        setAccount(accData)
        setEnableWhiteLabel(accData.isWhiteLabel)
      }
      if (profData?.profile) setProfile(profData.profile)
    }).finally(() => setLoading(false))
  }, [])

  // Sync local state when account updates after save
  useEffect(() => {
    if (account) {
      setEnableWhiteLabel(account.isWhiteLabel)
    }
  }, [account?.isWhiteLabel])

  function feedback(section: string, msg: string) {
    setSectionMsg(prev => ({ ...prev, [section]: msg }))
    setTimeout(() => setSectionMsg(prev => ({ ...prev, [section]: '' })), 4000)
  }

  async function saveSection(section: string, body: Record<string, unknown>) {
    setSavingSection(section)
    try {
      const res = await fetch('/api/partner/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { feedback(section, data.error ?? 'Save failed'); return }
      setAccount(prev => prev ? { ...prev, ...data } : data)
      feedback(section, 'Saved')
    } catch { feedback(section, 'Network error') }
    finally { setSavingSection(null) }
  }

  async function saveProfile(body: Record<string, unknown>) {
    setSavingSection('profile')
    try {
      const res = await fetch('/api/partner/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { feedback('profile', data.error ?? 'Save failed'); return }
      setProfile(data.profile)
      feedback('profile', 'Saved')
    } catch { feedback('profile', 'Network error') }
    finally { setSavingSection(null) }
  }

  function handleSection(section: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const body: Record<string, unknown> = {}
    fd.forEach((v, k) => { body[k] = v })
    saveSection(section, body)
  }

  async function handleWhiteLabelToggle(enabled: boolean) {
    if (!enabled || canPartnerUseWhiteLabel(account?.subscriptionTier)) {
      // Can toggle freely or disabling white-label
      return
    }
    // Trying to enable white-label but not on branded plan -> trigger checkout
    setCheckoutLoading(true)
    try {
      const priceId = process.env.NEXT_PUBLIC_STRIPE_PARTNER_PRICE_BRANDED_MONTHLY
      if (!priceId) {
        console.error('Partner branded price ID not configured')
        return
      }
      const res = await fetch('/api/partner/billing/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else if (data.updated || data.alreadyOnPlan) {
        // Already has subscription or updated successfully
        // Proceed with local state update
      } else {
        console.error('Checkout creation failed:', data)
      }
    } catch (err) {
      console.error('Checkout error:', err)
    } finally {
      setCheckoutLoading(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    const current = currentPwRef.current?.value ?? ''
    const next    = newPwRef.current?.value ?? ''
    const confirm = confirmPwRef.current?.value ?? ''
    if (!next) { setPwMsg('New password is required'); return }
    if (next !== confirm) { setPwMsg('Passwords do not match'); return }
    setPwSaving(true)
    setPwMsg('')
    try {
      const res = await fetch('/api/settings/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const data = await res.json()
      if (!res.ok) { setPwMsg(data.error ?? 'Failed'); return }
      setPwMsg('Password updated')
      if (currentPwRef.current)  currentPwRef.current.value  = ''
      if (newPwRef.current)      newPwRef.current.value      = ''
      if (confirmPwRef.current)  confirmPwRef.current.value  = ''
    } catch { setPwMsg('Network error') }
    finally { setPwSaving(false) }
  }

  if (loading) {
    return <div style={{ padding: 40, color: '#8B949E', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading...</div>
  }

  if (!account) {
    return <div style={{ padding: 40, color: '#F85149', fontFamily: 'var(--font-body)', fontSize: 14 }}>Could not load account.</div>
  }

  const msgStyle = (msg: string): React.CSSProperties => ({
    fontFamily: 'var(--font-body)',
    fontSize: 12,
    color: msg === 'Saved' ? '#3FB950' : '#F85149',
    marginTop: 12,
  })

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: '#F0F6FC', fontWeight: 400, margin: 0, marginBottom: 4 }}>
          Settings
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E', margin: 0 }}>
          {account.name}
          {!isAdmin ? ' \u2014 view only' : ''}
        </p>
      </div>

      {/* ── User Details ── */}
      <Card>
        <SectionHeader title="User Details" description="Your personal profile information." />
        {profile ? (
          <form onSubmit={e => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            const body: Record<string, unknown> = {}
            fd.forEach((v, k) => { body[k] = (v as string)?.trim() || null })
            saveProfile(body)
          }}>
            <div style={{ ...grid(2), marginBottom: 16 }}>
              <Input label="First name" name="firstName" defaultValue={profile.firstName} placeholder="Jane" />
              <Input label="Last name" name="lastName" defaultValue={profile.lastName} placeholder="Smith" />
            </div>
            <div style={{ ...grid(2), marginBottom: 16 }}>
              <Input label="Preferred name" name="preferredName" defaultValue={profile.preferredName} placeholder="How you'd like to be addressed" />
              <Field label="Email" value={profile.email} hint="Contact support to change your email address." />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <SaveButton saving={savingSection === 'profile'} />
              {sectionMsg.profile ? <span style={msgStyle(sectionMsg.profile)}>{sectionMsg.profile}</span> : null}
            </div>
          </form>
        ) : (
          <div style={{ color: '#8B949E', fontFamily: 'var(--font-body)', fontSize: 13 }}>Could not load profile.</div>
        )}
      </Card>

      {/* ── Company Information ── */}
      <Card>
        <SectionHeader title="Company Information" description="Contact details and billing information for your partner account." />
        {isAdmin ? (
          <form onSubmit={e => handleSection('company', e)}>
            <div style={{ ...grid(2), marginBottom: 16 }}>
              <Field label="Company name" value={account.name} hint="Managed by BespoxAI — contact support to update." />
              <Input label="Contact name" name="contactName" defaultValue={account.contactName} placeholder="Jane Smith" />
            </div>
            <div style={{ ...grid(2), marginBottom: 16 }}>
              <Input label="Phone" name="phone" defaultValue={account.phone} placeholder="+64 9 000 0000" />
              <Input label="Billing email" name="billingEmail" defaultValue={account.billingEmail} placeholder="billing@company.com" type="email" />
            </div>
            <div style={{ marginBottom: 16 }}>
              <Input label="Address" name="address" defaultValue={account.address} placeholder="123 Example St, Auckland" />
            </div>
            <div style={{ ...grid(2), marginBottom: 20 }}>
              <Input label="GST number" name="gstNumber" defaultValue={account.gstNumber} placeholder="123-456-789" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <SaveButton saving={savingSection === 'company'} />
              {sectionMsg.company ? <span style={msgStyle(sectionMsg.company)}>{sectionMsg.company}</span> : null}
            </div>
          </form>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Company name" value={account.name} />
            <Field label="Contact name" value={account.contactName} />
            <Field label="Phone" value={account.phone} />
            <Field label="Billing email" value={account.billingEmail} />
            <Field label="Address" value={account.address} />
            <Field label="GST number" value={account.gstNumber} />
          </div>
        )}
      </Card>

      {/* ── Branding ── */}
      <Card>
        <SectionHeader title="Branding" description="Customise how your portal appears to clients." />
        {isAdmin ? (
          <form onSubmit={e => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            const body: Record<string, unknown> = {}
            fd.forEach((v, k) => { body[k] = v })
            const enableWhiteLabel = fd.get('isWhiteLabel') === 'true'
            body.isWhiteLabel = enableWhiteLabel
            // If enabling white-label but not on branded plan, trigger checkout instead
            if (enableWhiteLabel && !account.isWhiteLabel && !canPartnerUseWhiteLabel(account?.subscriptionTier)) {
              handleWhiteLabelToggle(true)
              return
            }
            saveSection('branding', body)
          }}>
            {/* White-label enable/disable toggle at top */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: isAdmin ? 'pointer' : 'default' }}>
                <input
                  type="checkbox"
                  name="isWhiteLabel"
                  defaultChecked={account.isWhiteLabel}
                  onChange={e => setEnableWhiteLabel(e.target.checked)}
                  value="true"
                  disabled={checkoutLoading}
                  style={{ width: 14, height: 14, accentColor: '#0A5C46', cursor: checkoutLoading ? 'not-allowed' : 'pointer' }}
                />
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#C9D1D9' }}>
                  Enable white-label mode
                </span>
              </label>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6B7B70', marginTop: 4, marginLeft: 24 }}>
                {canPartnerUseWhiteLabel(account?.subscriptionTier)
                  ? 'When enabled, client-facing emails and portal elements use your brand name instead of BespoxAI.'
                  : 'Upgrade to unlock white-label branding and custom email sender'}
              </div>
            </div>

            {/* Branding fields — disabled unless white-label is enabled */}
            <fieldset style={{ border: 'none', padding: 0, margin: 0, opacity: enableWhiteLabel ? 1 : 0.5, pointerEvents: enableWhiteLabel ? 'auto' : 'none' }}>
              <div style={{ ...grid(2), marginBottom: 16 }}>
                <Input label="Brand name" name="brandName" defaultValue={account.brandName} placeholder="Acme ERP Solutions" hint="Shown to clients in place of BespoxAI." />
                <Input label="Agent brand name" name="agentBrandName" defaultValue={account.agentBrandName} placeholder="AcmeAgent" hint="Replaces 'BespoxAI' in agent paths and service names." />
              </div>
              <div style={{ marginBottom: 16 }}>
                <Input label="Logo URL" name="logoUrl" defaultValue={account.logoUrl} placeholder="https://cdn.example.com/logo.png" />
              </div>
              <div style={{ marginBottom: 20 }}>
                <Input
                  label="From email address"
                  name="fromEmail"
                  defaultValue={account.fromEmail}
                  placeholder="support@yourcompany.com"
                  type="email"
                  hint="Client-facing emails will show this as the sender."
                />
              </div>
              <div style={{ background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 6, padding: '10px 14px', marginBottom: 20, fontFamily: 'var(--font-body)', fontSize: 12, color: '#C8952A' }}>
                Note: emails are currently sent via BespoxAI SMTP infrastructure. For the From address to display correctly and avoid spam filters, your domain will need SPF/DKIM records pointing to our sending servers. Contact BespoxAI support to configure this.
              </div>
            </fieldset>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <SaveButton saving={savingSection === 'branding'} label={checkoutLoading ? 'Redirecting...' : 'Save changes'} />
              {sectionMsg.branding ? <span style={msgStyle(sectionMsg.branding)}>{sectionMsg.branding}</span> : null}
            </div>
          </form>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Brand name" value={account.brandName} />
            <Field label="Agent brand name" value={account.agentBrandName} />
            <Field label="Logo URL" value={account.logoUrl} />
            <Field label="From email" value={account.fromEmail} />
            <Field label="White-label mode" value={account.isWhiteLabel ? 'Enabled' : 'Disabled'} />
          </div>
        )}
      </Card>


      {/* ── GitHub ── */}
      <Card>
        <SectionHeader title="GitHub" description="Customer C/AL object repositories will be created under this organisation." />
        {isAdmin ? (
          <form onSubmit={e => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            const body: Record<string, unknown> = { githubOrg: fd.get('githubOrg') }
            const tok = fd.get('githubToken') as string
            if (tok && tok !== '••••••••') body.githubToken = tok
            saveSection('github', body)
          }}>
            <div style={{ ...grid(2), marginBottom: 20 }}>
              <Input
                label="GitHub organisation"
                name="githubOrg"
                defaultValue={account.githubOrg}
                placeholder="your-github-org"
                hint="Leave blank to use the BespoxAI default organisation."
              />
              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, color: '#8B949E', marginBottom: 4 }}>
                  GitHub token
                </label>
                <input
                  name="githubToken"
                  type="password"
                  defaultValue={account.githubToken ?? ''}
                  placeholder={account.githubToken ? '••••••••' : 'ghp_...'}
                  autoComplete="new-password"
                  style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 10px', boxSizing: 'border-box' }}
                />
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6B7B70', marginTop: 3 }}>
                  Classic PAT with repo scope. Leave unchanged to keep existing token.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <SaveButton saving={savingSection === 'github'} />
              {sectionMsg.github ? <span style={msgStyle(sectionMsg.github)}>{sectionMsg.github}</span> : null}
            </div>
          </form>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="GitHub organisation" value={account.githubOrg} />
            <Field label="GitHub token" value={account.githubToken ? '••••••••' : null} hint="Stored encrypted." />
          </div>
        )}
      </Card>

      {/* ── Change Password ── */}
      <Card>
        <SectionHeader title="Change Password" />
        <form onSubmit={handleChangePassword}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div>
              <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, color: '#8B949E', marginBottom: 4 }}>Current password</label>
              <input
                ref={currentPwRef}
                type="password"
                autoComplete="current-password"
                style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 10px', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, color: '#8B949E', marginBottom: 4 }}>New password</label>
              <input
                ref={newPwRef}
                type="password"
                autoComplete="new-password"
                style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 10px', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, color: '#8B949E', marginBottom: 4 }}>Confirm password</label>
              <input
                ref={confirmPwRef}
                type="password"
                autoComplete="new-password"
                style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 10px', boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <SaveButton saving={pwSaving} label="Update password" />
            {pwMsg ? <span style={msgStyle(pwMsg)}>{pwMsg}</span> : null}
          </div>
        </form>
      </Card>
    </div>
  )
}
