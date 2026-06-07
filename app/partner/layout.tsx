'use client'

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useBranding } from '@/app/branding-provider'

const NAV_ITEMS = [
  { href: '/partner/dashboard', label: 'Clients',     icon: '◈' },
  { href: '/partner/team',      label: 'Team',        icon: '◎' },
  { href: '/partner/billing',   label: 'Billing',     icon: '◇' },
  { href: '/partner/settings',  label: 'Settings',    icon: '⊙' },
]

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const branding = useBranding()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
      return
    }
    const user = session?.user as any
    if (status === 'authenticated' && !user?.partnerAccountId) {
      // Not a partner user — redirect to appropriate portal
      router.push('/dashboard')
    }
  }, [status, session, router])

  useEffect(() => {
    const user = session?.user as any
    if (status === 'authenticated' && user?.mustChangePassword) {
      setShowPwModal(true)
    }
  }, [status, session])

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: '#0D1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#8B949E', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em' }}>LOADING</span>
      </div>
    )
  }

  const user = session?.user as any
  const displayName = user?.preferredName ?? user?.firstName ?? user?.email ?? ''
  const partnerRole = user?.partnerRole ?? ''
  const isAdmin = partnerRole === 'partner_admin'

  async function handleSetPassword() {
    setPwError('')
    if (newPw.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return }
    setPwSaving(true)
    try {
      const res = await fetch('/api/settings/profile/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPw, clearMustChange: true }),
      })
      const data = await res.json()
      if (!res.ok) { setPwError(data.error ?? 'Could not save password.'); return }
      setShowPwModal(false)
      setNewPw('')
      setConfirmPw('')
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0D1117' }}>

      {/* ── Mobile overlay ── */}
      {sidebarOpen ? (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 40, display: 'none',
          }}
          className="partner-overlay"
        />
      ) : null}

      {/* ── Sidebar ── */}
      <aside style={{
        width: 220,
        flexShrink: 0,
        background: '#161B22',
        borderRight: '1px solid #21262D',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 50,
        transform: sidebarOpen ? 'translateX(0)' : undefined,
      }}
        className="partner-sidebar"
      >
        {/* Logo / Brand */}
        <div style={{
          padding: '20px 20px 16px',
          borderBottom: '1px solid #21262D',
        }}>
          {branding.isWhiteLabel && branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.brandName} style={{ height: 28, objectFit: 'contain', marginBottom: 4 }} />
          ) : (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#58A6FF',
              marginBottom: 2,
            }}>
              {branding.isWhiteLabel && branding.brandName ? branding.brandName : 'BespoxAI'}
            </div>
          )}
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            color: '#8B949E',
            fontWeight: 500,
          }}>
            Partner Portal
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {NAV_ITEMS.map(item => {
            // Hide billing from non-admins; settings and team are visible to all
            if (!isAdmin && item.href === '/partner/billing') return null
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            const isExternal = (item as any).external
            return (
              <Link
                key={item.href}
                href={item.href}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                onClick={() => setSidebarOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 6,
                  marginBottom: 2,
                  background: active && !isExternal ? '#1F2937' : 'transparent',
                  color: active && !isExternal ? '#F0F6FC' : '#8B949E',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  fontWeight: active && !isExternal ? 600 : 400,
                  textDecoration: 'none',
                  transition: 'background 0.15s, color 0.15s',
                  border: active && !isExternal ? '1px solid #30363D' : '1px solid transparent',
                }}
                onMouseEnter={e => {
                  if (!active || isExternal) {
                    e.currentTarget.style.background = '#1C2128'
                    e.currentTarget.style.color = '#C9D1D9'
                  }
                }}
                onMouseLeave={e => {
                  if (!active || isExternal) {
                    e.currentTarget.style.background = active && !isExternal ? '#1F2937' : 'transparent'
                    e.currentTarget.style.color = active && !isExternal ? '#F0F6FC' : '#8B949E'
                  }
                }}
              >
                <span style={{ fontSize: 14, opacity: 0.8 }}>{item.icon}</span>
                {item.label}
                {isExternal && <span style={{ fontSize: 11, marginLeft: 'auto', opacity: 0.6 }}>↗</span>}
              </Link>
            )
          })}
        </nav>

        {/* User / sign out */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid #21262D',
        }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#C9D1D9', fontWeight: 500 }}>
              {displayName}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
              {isAdmin ? 'Admin' : 'Developer'}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            style={{
              background: 'none',
              border: '1px solid #30363D',
              borderRadius: 4,
              color: '#8B949E',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '5px 10px',
              cursor: 'pointer',
              width: '100%',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#58A6FF'
              e.currentTarget.style.color = '#58A6FF'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = '#30363D'
              e.currentTarget.style.color = '#8B949E'
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div style={{ flex: 1, marginLeft: 220, display: 'flex', flexDirection: 'column', minHeight: '100vh' }} className="partner-main">

        {/* Mobile top bar */}
        <div style={{
          display: 'none',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: '#161B22',
          borderBottom: '1px solid #21262D',
          position: 'sticky',
          top: 0,
          zIndex: 30,
        }} className="partner-topbar">
          <button
            onClick={() => setSidebarOpen(true)}
            style={{ background: 'none', border: 'none', color: '#8B949E', fontSize: 20, cursor: 'pointer', padding: 4 }}
          >
            ☰
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#58A6FF', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {(branding.isWhiteLabel && branding.brandName ? branding.brandName : 'BespoxAI') + ' Partner'}
          </span>
          <div style={{ width: 28 }} />
        </div>

        <main style={{ flex: 1, padding: '32px 40px' }} className="partner-content">
          {children}
        </main>
      </div>

      {/* ── Password change modal ── */}
      {showPwModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#161B22', border: '1px solid #30363D', borderRadius: 8, padding: '32px 40px', maxWidth: 400, width: '90%' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: '#F0F6FC', margin: '0 0 8px', fontWeight: 400 }}>Set your password</h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E', margin: '0 0 24px', lineHeight: 1.5 }}>
              You signed in with a temporary password. Please set a permanent one to continue.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8B949E', display: 'block', marginBottom: 6 }}>New Password</label>
                <input
                  type="password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="At least 8 characters"
                  style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' }}
                  onFocus={e => e.target.style.borderColor = '#58A6FF'}
                  onBlur={e => e.target.style.borderColor = '#30363D'}
                  onKeyDown={e => { if (e.key === 'Enter') handleSetPassword() }}
                />
              </div>
              <div>
                <label style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8B949E', display: 'block', marginBottom: 6 }}>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Repeat your new password"
                  style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' }}
                  onFocus={e => e.target.style.borderColor = '#58A6FF'}
                  onBlur={e => e.target.style.borderColor = '#30363D'}
                  onKeyDown={e => { if (e.key === 'Enter') handleSetPassword() }}
                />
              </div>
            </div>
            {pwError && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#F85149', margin: '0 0 16px' }}>{pwError}</p>}
            <button
              onClick={handleSetPassword}
              disabled={pwSaving}
              style={{ width: '100%', background: '#238636', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, padding: '10px', cursor: pwSaving ? 'not-allowed' : 'pointer', opacity: pwSaving ? 0.6 : 1 }}
            >
              {pwSaving ? 'Saving…' : 'Set Password & Continue →'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .partner-sidebar { transform: translateX(-100%); transition: transform 0.2s; }
          .partner-sidebar.open { transform: translateX(0); }
          .partner-overlay { display: block !important; }
          .partner-topbar { display: flex !important; }
          .partner-main { margin-left: 0 !important; }
          .partner-content { padding: 20px 16px !important; }
        }
      `}</style>
    </div>
  )
}
