'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'

// ─── Data ─────────────────────────────────────────────────────────────────────

const BC_VERSIONS = [
  'Business Central 2025 (BC25)',
  'Business Central 2024 Wave 2 (BC24)',
  'Business Central 2024 Wave 1 (BC23)',
  'Business Central 2023 Wave 2 (BC22)',
  'Business Central 2023 Wave 1 (BC21)',
  'Business Central 2022 Wave 2 (BC20)',
  'Business Central 2022 Wave 1 (BC19)',
  'Business Central 2021 Wave 2 (BC18)',
  'Business Central 2021 Wave 1 (BC17)',
  'Business Central 2020 Wave 2 (BC16)',
  'Business Central 2020 Wave 1 (BC15)',
  'Business Central 2019 Wave 1 (BC14)',
  'Older / Not sure',
]
const NAV_VERSIONS = [
  'Microsoft NAV 2018',
  'Microsoft NAV 2017',
  'Microsoft NAV 2016',
  'Microsoft NAV 2015',
  'Microsoft NAV 2013 R2',
  'Microsoft NAV 2013',
  'Microsoft NAV 2009 R2',
  'Microsoft NAV 2009',
  'Older / Not sure',
]

const PERSONAS = [
  { id: 'cfo',     label: 'CFO / Finance Lead',  desc: 'Responsible for financial reporting and strategy' },
  { id: 'finance', label: 'Finance Assistant',    desc: 'Day-to-day financial data and reporting tasks'    },
  { id: 'it',      label: 'IT / System Admin',    desc: 'Setting up and managing the BC environment'      },
  { id: 'other',   label: 'Other',                desc: 'Another role within the organisation'             },
]

const STEPS = [
  { label: 'Your role',    desc: 'Who you are'         },
  { label: 'Your system',  desc: 'BC or NAV version'   },
  { label: 'Your goals',   desc: 'What you want to do' },
  { label: 'Connection',   desc: 'Connect your system' },
  { label: 'All done',     desc: 'Ready to go'         },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractFirstName(name: string | null | undefined) {
  if (!name) return ''
  return name.split(' ')[0]
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Label({ children, optional }: { children: string; optional?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--slate)' }}>{children}</div>
      {optional && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '0.06em' }}>optional</span>}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)',
  background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8,
  padding: '9px 12px', outline: 'none', boxSizing: 'border-box',
}
const primaryBtn: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
  padding: '11px 28px', background: 'var(--forest)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
}
const backBtn: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--slate)',
  background: 'none', border: 'none', cursor: 'pointer', padding: '11px 0',
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { data: session, status, update } = useSession()
  const router = useRouter()

  const [step,    setStep]    = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Step 0 — password change
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving,  setPwSaving]  = useState(false)

  // Prefill state
  const [prefillSource,    setPrefillSource]    = useState<'signup' | 'saved' | null>(null)
  const [tenantName,       setTenantName]       = useState('')
  const [userDisplayName,  setUserDisplayName]  = useState('')

  // Step 1
  const [persona,       setPersona]       = useState('')
  const [firstName,     setFirstName]     = useState('')
  const [lastName,      setLastName]      = useState('')
  const [preferredName, setPreferredName] = useState('')

  // Step 2
  const [navProduct, setNavProduct] = useState('')
  const [navVersion, setNavVersion] = useState('')
  const [lastCU,     setLastCU]     = useState('')

  // Step 3
  const [wantsToConnect, setWantsToConnect] = useState<boolean | null>(null)

  // Step 4
  const [bcPort,    setBcPort]    = useState('8048')
  const [agentPort, setAgentPort] = useState('9099')

  const [bcInstance,        setBcInstance]        = useState('')
  const [bcCompany,         setBcCompany]         = useState('')
  const [navDatabaseServer, setNavDatabaseServer] = useState('localhost')
  const [navDatabaseName,   setNavDatabaseName]   = useState('')
  const [navServerInstance, setNavServerInstance] = useState('')

  const user = session?.user as any

  // Redirect guards
  useEffect(() => {
    if (status === 'loading') return
    if (!session) { router.replace('/login'); return }
    if (user?.onboardingDone) { router.replace('/dashboard'); return }
    if (user?.mustChangePassword) setStep(0)
  }, [status, session, user?.onboardingDone, user?.mustChangePassword])

  // Fetch prefill data
  useEffect(() => {
    if (!session) return
    fetch('/api/onboarding')
      .then(r => r.json())
      .then(data => {
        setTenantName(data.tenant?.name ?? '')
        setUserDisplayName(data.user?.name ?? '')
        if (data.user?.persona) setPersona(data.user.persona)
        if (data.user?.firstName)     setFirstName(data.user.firstName)
        if (data.user?.lastName)      setLastName(data.user.lastName)
        if (data.user?.preferredName) setPreferredName(data.user.preferredName)
        const p = data.prefill
        if (p?.navProduct) setNavProduct(p.navProduct)
        if (p?.navVersion) setNavVersion(p.navVersion)
        if (p?.lastCU)     setLastCU(p.lastCU)
        if (p?.bcPort)            setBcPort(String(p.bcPort))
        if (p?.agentPort)         setAgentPort(String(p.agentPort))
        if (p?.bcInstance)        setBcInstance(p.bcInstance)
        if (p?.bcCompany)         setBcCompany(p.bcCompany)
        if (p?.navDatabaseServer) setNavDatabaseServer(p.navDatabaseServer)
        if (p?.navDatabaseName)   setNavDatabaseName(p.navDatabaseName)
        if (p?.navServerInstance) setNavServerInstance(p.navServerInstance)
        // Track where the version came from for contextual copy
        if (data.signupBcVersion && !data.prefill?.navProduct) setPrefillSource(null)
        else if (data.signupBcVersion) setPrefillSource('signup')
        else if (p?.navProduct)        setPrefillSource('saved')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [session])

  if (status === 'loading' || loading || !session || user?.onboardingDone) return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.3)' }}>Loading…</span>
    </div>
  )

  // ── Step helpers ────────────────────────────────────────────────────────────

  function sidebarState(n: number): 'done' | 'active' | 'upcoming' {
    return n < step ? 'done' : n === step ? 'active' : 'upcoming'
  }

  async function handleSetPassword() {
    setError('')
    if (newPw.length < 8)   { setError('Password must be at least 8 characters.'); return }
    if (newPw !== confirmPw) { setError('Passwords do not match.'); return }
    setPwSaving(true)
    try {
      const res = await fetch('/api/settings/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPw, clearMustChange: true }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not save password.'); return }
      await update()
      setStep(1)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPwSaving(false)
    }
  }

  function handleNext() {
    setError('')
    if (step === 1 && !persona)     { setError('Please select your role to continue.'); return }
    if (step === 2 && !navProduct)  { setError('Please select your product to continue.'); return }
    if (step === 3 && wantsToConnect === false) { setStep(5); return }
    setStep(s => s + 1)
  }

  function handleBack() {
    setError('')
    if (step === 5 && wantsToConnect === false) { setStep(3); return }
    setStep(s => s - 1)
  }

  async function finish() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona, firstName, lastName, preferredName, navProduct, navVersion, lastCU,
          bcPort: parseInt(bcPort, 10) || 8048, agentPort: parseInt(agentPort, 10) || 9099, wantsToConnect,
          bcInstance, bcCompany, navDatabaseServer, navDatabaseName, navServerInstance }),
      })
      if (!res.ok) throw new Error()
      await update()
      router.replace('/dashboard')
    } catch { setError('Something went wrong — please try again.'); setSaving(false) }
  }

  const totalSteps    = wantsToConnect === false ? 4 : 5
  const versionOpts   = navProduct === 'BC' ? BC_VERSIONS : navProduct === 'NAV' ? NAV_VERSIONS : []
  const isSaaS        = navProduct === 'BC' && /2022|2023|2024/.test(navVersion)
  const fname         = extractFirstName(userDisplayName)
  const stepLabel     = (n: number) => `Step ${n} of ${totalSteps}`

  // ── Sidebar ─────────────────────────────────────────────────────────────────

  const Sidebar = () => (
    <aside style={{ width: 260, flexShrink: 0, background: 'var(--ink)', display: 'flex', flexDirection: 'column', padding: '40px 28px', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ marginBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 22, color: 'var(--cream)', letterSpacing: '-0.3px' }}>Bespox</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 17, color: 'var(--amber)', letterSpacing: '0.04em', marginLeft: 3 }}>AI</span>
        </div>
        {tenantName && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.3)', marginTop: 6 }}>{tenantName}</div>}
      </div>
      <nav style={{ flex: 1 }}>
        {STEPS.map((s, i) => {
          const n = i + 1
          if (n === 4 && wantsToConnect === false) return null
          const state = sidebarState(n)
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 6, position: 'relative' }}>
              {i < STEPS.length - 1 && !(n === 3 && wantsToConnect === false) && (
                <div style={{ position: 'absolute', left: 14, top: 30, width: 1, height: 28, background: state === 'done' ? 'rgba(26,146,114,0.3)' : 'rgba(255,255,255,0.05)' }} />
              )}
              <div style={{ width: 28, height: 28, borderRadius: '50%', border: `1px solid ${state === 'done' ? 'var(--jade)' : state === 'active' ? 'var(--forest)' : 'rgba(214,217,212,0.15)'}`, background: state === 'done' ? 'rgba(26,146,114,0.2)' : state === 'active' ? 'rgba(10,92,70,0.4)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 500, color: state === 'done' ? 'var(--jade)' : state === 'active' ? 'var(--cream)' : 'rgba(214,217,212,0.25)', fontFamily: 'var(--font-mono)', zIndex: 1 }}>
                {state === 'done' ? '✓' : n}
              </div>
              <div style={{ paddingTop: 4 }}>
                <div style={{ fontSize: 13, fontWeight: state === 'active' ? 600 : 400, color: state === 'active' ? 'var(--cream)' : 'rgba(214,217,212,0.35)' }}>{s.label}</div>
                <div style={{ fontSize: 11, color: state === 'active' ? 'rgba(214,217,212,0.5)' : 'rgba(214,217,212,0.2)', marginTop: 1 }}>{s.desc}</div>
              </div>
            </div>
          )
        })}
      </nav>
      <button onClick={() => signOut({ callbackUrl: '/login' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(214,217,212,0.25)', fontFamily: 'var(--font-body)', fontSize: 12, textAlign: 'left', padding: 0, transition: 'color 0.15s' }} onMouseEnter={e => (e.currentTarget.style.color = 'rgba(214,217,212,0.55)')} onMouseLeave={e => (e.currentTarget.style.color = 'rgba(214,217,212,0.25)')}>↪ Sign out</button>
    </aside>
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'var(--font-body)' }}>
      {!isMobile && <Sidebar />}
      <main style={{ flex: 1, overflowY: 'auto', background: '#ffffff', display: 'flex', flexDirection: 'column' }}>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--fog)', flexShrink: 0 }}>
          <div style={{ height: '100%', background: 'var(--forest)', width: (step / totalSteps * 100) + '%', transition: 'width 0.4s ease' }} />
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '32px 20px' : '48px 32px' }}>
          <div style={{ width: '100%', maxWidth: 520 }}>

            {/* ── Step 0: Change temporary password ── */}
            {step === 0 && (
              <div>
                <div style={eyebrow}>Account Security</div>
                <h1 style={heading}>Set your password.</h1>
                <p style={subtext}>
                  You signed in with a temporary password. Please set a permanent one before continuing.
                </p>
                {error ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#A32D2D', marginBottom: 16 }}>{error}</p> : null}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  <div>
                    <label style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', display: 'block', marginBottom: 6 }}>New Password</label>
                    <input
                      type="password"
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      placeholder="At least 8 characters"
                      style={{ width: '100%', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '11px 14px', outline: 'none', boxSizing: 'border-box' as const }}
                    />
                  </div>
                  <div>
                    <label style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', display: 'block', marginBottom: 6 }}>Confirm Password</label>
                    <input
                      type="password"
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="Repeat your new password"
                      style={{ width: '100%', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '11px 14px', outline: 'none', boxSizing: 'border-box' as const }}
                      onKeyDown={e => { if (e.key === 'Enter') handleSetPassword() }}
                    />
                  </div>
                </div>
                <button
                  onClick={handleSetPassword}
                  disabled={pwSaving}
                  style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: 'var(--forest)', color: 'var(--cream)', fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, cursor: pwSaving ? 'not-allowed' : 'pointer', opacity: pwSaving ? 0.7 : 1 }}
                >
                  {pwSaving ? 'Saving…' : 'Set Password & Continue →'}
                </button>
              </div>
            )}

            {/* ── Step 1: Role ── */}
            {step === 1 && (
              <div>
                <div style={eyebrow}>{stepLabel(1)}</div>
                <h1 style={heading}>
                  Welcome.<br />
                  Let's get you set up.
                </h1>
                <p style={subtext}>
                  {tenantName ? `We've set up your workspace for ${tenantName}. ` : ''}
                  Tell us a bit about yourself so we can tailor the experience.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <Label>First name</Label>
                    <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jane"
                      style={inputStyle}
                      onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                      onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
                  </div>
                  <div>
                    <Label>Last name</Label>
                    <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Smith"
                      style={inputStyle}
                      onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                      onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
                  </div>
                </div>
                <div style={{ marginBottom: 24 }}>
                  <Label optional>Preferred name</Label>
                  <input type="text" value={preferredName} onChange={e => setPreferredName(e.target.value)} placeholder="e.g. Jay (leave blank to use first name)"
                    style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
                  {PERSONAS.map(p => {
                    const active = persona === p.id
                    return (
                      <button key={p.id} onClick={() => setPersona(p.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', border: `1.5px solid ${active ? 'var(--forest)' : 'var(--fog)'}`, borderRadius: 10, background: active ? 'rgba(10,92,70,0.06)' : 'var(--white)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                        <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${active ? 'var(--forest)' : 'var(--fog)'}`, background: active ? 'var(--forest)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {active && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{p.label}</div>
                          <div style={{ fontSize: 12, color: 'var(--slate)', marginTop: 2 }}>{p.desc}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
                {error && <p style={errStyle}>{error}</p>}
                <button onClick={handleNext} style={primaryBtn}>Continue →</button>
              </div>
            )}

            {/* ── Step 2: System ── */}
            {step === 2 && (
              <div>
                <div style={eyebrow}>{stepLabel(2)}</div>
                <h1 style={heading}>Your system</h1>
                <p style={subtext}>
                  {prefillSource === 'signup'
                    ? `We've pre-filled this from your signup — just confirm or update if anything has changed.`
                    : prefillSource === 'saved'
                    ? `We have your system details on file — confirm or update below.`
                    : `Tell us which version of Business Central or NAV you're running.`}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 32 }}>
                  {/* Product */}
                  <div>
                    <Label>Product</Label>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {(['BC', 'NAV', 'unsure'] as const).map(p => {
                        const labels = { BC: 'Business Central', NAV: 'Microsoft NAV', unsure: 'Not sure' }
                        const active = navProduct === p
                        return (
                          <button key={p} onClick={() => { setNavProduct(p); setNavVersion('') }}
                            style={{ flex: 1, padding: '10px 12px', border: `1.5px solid ${active ? 'var(--forest)' : 'var(--fog)'}`, borderRadius: 8, background: active ? 'rgba(10,92,70,0.06)' : 'var(--white)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: active ? 600 : 400, color: active ? 'var(--forest)' : 'var(--slate)', transition: 'all 0.15s' }}>
                            {labels[p]}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Version */}
                  {navProduct && navProduct !== 'unsure' && (
                    <div>
                      <Label>Version</Label>
                      <select value={navVersion} onChange={e => setNavVersion(e.target.value)}
                        style={{ ...inputStyle, cursor: 'pointer', color: navVersion ? 'var(--ink)' : 'var(--slate)', appearance: 'none' }}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        onBlur={e  => (e.target.style.borderColor = 'var(--fog)')}>
                        <option value="">Select version…</option>
                        {versionOpts.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                      {prefillSource && navVersion && (
                        <p style={{ fontSize: 11, color: 'var(--jade)', marginTop: 5 }}>
                          ✓ {prefillSource === 'signup' ? 'Pre-filled from your signup request' : 'Previously saved'}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Last CU */}
                  <div>
                    <Label optional>Last cumulative update (CU)</Label>
                    <input type="text" value={lastCU} placeholder="e.g. CU3, CU14, Update 23…"
                      onChange={e => setLastCU(e.target.value)} style={inputStyle}
                      onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                      onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
                    <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 6, lineHeight: 1.5 }}>
                      Found in BC/NAV under Help → About. Leave blank if unsure — you can update this later.
                    </p>
                  </div>
                </div>

                {error && <p style={errStyle}>{error}</p>}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button onClick={handleBack} style={backBtn}>← Back</button>
                  <button onClick={handleNext} style={primaryBtn}>Continue →</button>
                </div>
              </div>
            )}

            {/* ── Step 3: Connection intent ── */}
            {step === 3 && (
              <div>
                <div style={eyebrow}>{stepLabel(3)}</div>
                <h1 style={heading}>Connect your system</h1>
                <p style={subtext}>
                  Would you like to connect your {navProduct === 'BC' ? 'Business Central' : navProduct === 'NAV' ? 'NAV' : 'BC/NAV'} system now, or explore first and connect later?
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
                  {[
                    { value: true,  icon: '⚡', title: 'Connect now', desc: "We'll save your port settings. Your IT team downloads and runs the pre-configured installer from Settings." },
                    { value: false, icon: '○',  title: 'Set up later', desc: 'Explore the platform first. Connect any time from Settings → BC Installer.' },
                  ].map(opt => {
                    const active = wantsToConnect === opt.value
                    return (
                      <button key={String(opt.value)} onClick={() => setWantsToConnect(opt.value)}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '16px 18px', border: `1.5px solid ${active ? 'var(--forest)' : 'var(--fog)'}`, borderRadius: 10, background: active ? 'rgba(10,92,70,0.06)' : 'var(--white)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                        <div style={{ fontSize: 20, lineHeight: 1, marginTop: 2 }}>{opt.icon}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{opt.title}</div>
                          <div style={{ fontSize: 12, color: 'var(--slate)', marginTop: 4, lineHeight: 1.5 }}>{opt.desc}</div>
                        </div>
                        <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${active ? 'var(--forest)' : 'var(--fog)'}`, background: active ? 'var(--forest)' : 'transparent', flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {active && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button onClick={handleBack} style={backBtn}>← Back</button>
                  <button onClick={handleNext} disabled={wantsToConnect === null}
                    style={{ ...primaryBtn, opacity: wantsToConnect === null ? 0.4 : 1, cursor: wantsToConnect === null ? 'default' : 'pointer' }}>
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 4: Connection details (conditional) ── */}
            {step === 4 && wantsToConnect && (
              <div>
                <div style={eyebrow}>{stepLabel(4)}</div>
                <h1 style={heading}>BC Connection</h1>
                <p style={subtext}>
                  These details are saved and pre-filled into the installer your IT team downloads from Settings. The installer will connect your server directly to BespoxAI.
                </p>

                {isSaaS ? (
                  <div style={{ background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 24 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 4 }}>BC SaaS detected</div>
                    <p style={{ fontSize: 12, color: 'var(--slate)', lineHeight: 1.55 }}>Your version may support direct API / OAuth — our team will confirm the best approach. Enter on-prem details below if applicable.</p>
                  </div>
                ) : null}

                <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div>
                      <Label>BC Instance</Label>
                      <input type="text" value={bcInstance} placeholder={navProduct === 'NAV' ? 'e.g. DynamicsNAV110' : 'e.g. BC'} onChange={e => setBcInstance(e.target.value)} style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
                      <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 5 }}>Your BC or NAV server instance name.</p>
                    </div>
                    <div>
                      <Label>BC Company</Label>
                      <input type="text" value={bcCompany} placeholder="e.g. CRONUS International Ltd." onChange={e => setBcCompany(e.target.value)} style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
                      <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 5 }}>Company name as it appears in the OData URL.</p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div>
                      <Label>NAV Database Server</Label>
                      <input type="text" value={navDatabaseServer} placeholder="localhost" onChange={e => setNavDatabaseServer(e.target.value)} style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
                      <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 5 }}>SQL Server hosting the NAV/BC database.</p>
                    </div>
                    <div>
                      <Label>NAV Database Name</Label>
                      <input type="text" value={navDatabaseName} placeholder="e.g. Dynamics NAV 2017" onChange={e => setNavDatabaseName(e.target.value)} style={{ ...inputStyle, borderColor: navDatabaseName ? 'var(--fog)' : 'rgba(200,149,42,0.4)' }}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        onBlur={e  => (e.target.style.borderColor = navDatabaseName ? 'var(--fog)' : 'rgba(200,149,42,0.4)')} />
                      <p style={{ fontSize: 11, color: navDatabaseName ? 'var(--slate)' : 'var(--gold)', marginTop: 5 }}>Required for C/AL object export. Find in SQL Server Management Studio.</p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, paddingTop: 16, borderTop: '1px solid var(--fog)' }}>
                    <div>
                      <Label optional>NAV Server Instance</Label>
                      <input type="text" value={navServerInstance} placeholder="e.g. DynamicsNAV110" onChange={e => setNavServerInstance(e.target.value)} style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
                    </div>
                    <div>
                      <Label>BC OData Port</Label>
                      <input type="number" value={bcPort} onChange={e => setBcPort(e.target.value)} style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
                      <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 5 }}>Default: 8048</p>
                    </div>
                    <div>
                      <Label>Agent Port</Label>
                      <input type="number" value={agentPort} onChange={e => setAgentPort(e.target.value)} style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
                      <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 5 }}>Default: 9099</p>
                    </div>
                  </div>
                </div>

                {error && <p style={errStyle}>{error}</p>}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button onClick={handleBack} style={backBtn}>← Back</button>
                  <button onClick={handleNext} style={primaryBtn}>Continue →</button>
                </div>
              </div>
            )}

            {/* ── Step 5: Done ── */}
            {step === 5 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(26,146,114,0.12)', border: '2px solid var(--jade)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 28px', fontSize: 26 }}>✓</div>
                <h1 style={{ ...heading, textAlign: 'center' }}>
                  {fname ? `${fname}, you're all set.` : "You're all set."}
                </h1>
                <p style={{ ...subtext, textAlign: 'center', maxWidth: 400, margin: '0 auto 24px' }}>
                  {wantsToConnect
                    ? 'Your BC connection details are saved. Your IT team can now download and run the pre-configured installer.'
                    : 'You can connect your system any time from Settings → BC Installer.'}
                </p>
                {wantsToConnect ? (
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
                    <a href="/settings?tab=installer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--forest)', color: '#fff', borderRadius: 10, padding: '12px 24px', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                      Open BC Installer →
                    </a>
                  </div>
                ) : null}

                {/* Summary */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 36, textAlign: 'left' }}>
                  {([
                    ['Name', (preferredName || firstName) ? (preferredName || firstName) + ' ' + lastName : '—'],
                    ['Role',       PERSONAS.find(p => p.id === persona)?.label ?? persona],
                    ['Company',    tenantName || '—'],
                    ['Product',    navProduct === 'BC' ? 'Business Central' : navProduct === 'NAV' ? 'Microsoft NAV' : '—'],
                    ['Version',    navVersion || '—'],
                    ['Last CU',    lastCU     || '—'],
                    ['BC Instance',   bcInstance || '—'],
                    ['Database',      navDatabaseName || '—'],
                    ['Connection',    wantsToConnect ? 'Installer ready' : 'Set up later'],
                  ] as [string,string][]).map(([k, v]) => (
                    <div key={k} style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '12px 16px' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>{k}</div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{v}</div>
                    </div>
                  ))}
                </div>

                {error && <p style={errStyle}>{error}</p>}
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  <button onClick={handleBack} style={backBtn}>← Back</button>
                  <button onClick={finish} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>
                    {saving ? 'Setting up…' : 'Go to dashboard →'}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const eyebrow: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'var(--forest)', marginBottom: 10,
}
const heading: React.CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 38, fontWeight: 400,
  color: 'var(--ink)', marginBottom: 8, lineHeight: 1.1,
}
const subtext: React.CSSProperties = {
  fontSize: 14, color: 'var(--slate)', lineHeight: 1.65, marginBottom: 32, fontWeight: 300,
}
const errStyle: React.CSSProperties = {
  fontSize: 12, color: '#A32D2D', marginBottom: 16,
}
