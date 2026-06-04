'use client'

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import type { BrandingConfig } from '@/lib/branding'
import { DEFAULT_BRANDING } from '@/lib/branding'

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
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING)

  useEffect(() => {
    fetch('/api/branding')
      .then(r => r.ok ? r.json() : null)
      .then(b => {
        if (!b) return
        setBranding(b)
        if (b.isWhiteLabel) {
          const root = document.documentElement
          if (b.primaryColour)   root.style.setProperty('--forest', b.primaryColour)
          if (b.secondaryColour) root.style.setProperty('--jade',   b.secondaryColour)
        }
      })
      .catch(() => {})
  }, [])

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
              color: branding.isWhiteLabel && branding.primaryColour ? branding.primaryColour : '#58A6FF',
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
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 6,
                  marginBottom: 2,
                  background: active ? '#1F2937' : 'transparent',
                  color: active ? '#F0F6FC' : '#8B949E',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  textDecoration: 'none',
                  transition: 'background 0.15s, color 0.15s',
                  border: active ? '1px solid #30363D' : '1px solid transparent',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.background = '#1C2128'
                    e.currentTarget.style.color = '#C9D1D9'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = '#8B949E'
                  }
                }}
              >
                <span style={{ fontSize: 14, opacity: 0.8 }}>{item.icon}</span>
                {item.label}
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
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: branding.isWhiteLabel && branding.primaryColour ? branding.primaryColour : '#58A6FF', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {(branding.isWhiteLabel && branding.brandName ? branding.brandName : 'BespoxAI') + ' Partner'}
          </span>
          <div style={{ width: 28 }} />
        </div>

        <main style={{ flex: 1, padding: '32px 40px' }} className="partner-content">
          {children}
        </main>
      </div>

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
