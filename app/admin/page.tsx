'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import SuperAdminDashboard from '@/components/SuperAdminDashboard'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tenant {
  id: string; name: string; tunnelSubdomain: string
  bcInstance: string; bcCompany: string; active: boolean
  tunnelId: string | null
  rdpPassword: string | null
  tier?: string; trialEndsAt?: string | null
  createdAt: string
  _count: { users: number; queryLogs: number }
}

interface User {
  id: string; email: string; name: string; role: string; active: boolean
  tenantId: string; createdAt: string
  tenant: { name: string; active: boolean }
  _count: { queryLogs: number }
}

interface Stats {
  totalQueries: number; todayQueries: number
  tenants: any[]; topEntities: { entity: string; _count: { entity: number } }[]
}

type Tab = 'overview' | 'tenants' | 'users' | 'entities' | 'signups' | 'requirements' | 'settings' | 'business' | 'business'

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminPageInner />
    </Suspense>
  )
}

function AdminPageInner() {
  const { data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = session?.user as any

  // Tab is tracked in the URL (?tab=xxx) so the browser back button works
  const tabParam = (searchParams.get('tab') as Tab | null) ?? 'overview'
  const [tab, setTabState] = useState<Tab>(tabParam)
  const [autoSelectReqId, setAutoSelectReqId] = useState<string|null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (mobile) setSidebarOpen(false)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  function setTab(id: Tab) {
    setTabState(id)
    if (isMobile) setSidebarOpen(false)
    router.push('/admin?tab=' + id)
  }

  // Sync state when URL changes (back/forward navigation)
  useEffect(() => {
    const t = (searchParams.get('tab') as Tab | null) ?? 'overview'
    setTabState(t)
  }, [searchParams])

  // Load JSZip for client-side NAV object zip handling
  useEffect(() => {
    if (!(window as any).JSZip) {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
      document.head.appendChild(s)
    }
  }, [])
  const [signups, setSignups]   = useState<any[]>([])
  const [signupsLoaded, setSignupsLoaded] = useState(false)
  const [signupsError, setSignupsError]   = useState<string | null>(null)
  const [activating, setActivating] = useState<string | null>(null)
  const [tenants, setTenants]   = useState<Tenant[]>([])
  const [users, setUsers]       = useState<User[]>([])
  const [stats, setStats]       = useState<Stats | null>(null)
  const [loading, setLoading]   = useState(true)

  // New tenant form
  const [showNewTenant, setShowNewTenant]         = useState(false)
  const [tenantForm, setTenantForm]               = useState({ name: '', tunnelSubdomain: '', bcInstance: 'BC', bcCompany: 'CRONUS International Ltd.', customerEmail: '', customerName: '' })
  const [newTenantResult, setNewTenantResult]     = useState<{ apiKey: string; name: string; tenantId?: string; provisioned?: boolean; customerEmail?: string; tempPassword?: string } | null>(null)
  const [provisionMode, setProvisionMode]         = useState(true)   // true = auto-provision, false = manual
  const [provisionSteps, setProvisionSteps]       = useState<string[]>([])
  const [rdpLoading, setRdpLoading]               = useState<string | null>(null)  // tenantId currently provisioning
  const [rdpError, setRdpError]                   = useState<Record<string, string>>({})

  // New user form
  const [showNewUser, setShowNewUser]             = useState(false)
  const [userForm, setUserForm]                   = useState({ email: '', name: '', role: 'user', tenantId: '' })
  const [newUserResult, setNewUserResult]         = useState<{ email: string; tempPassword: string } | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // Entity discovery state
  const [discoverTenantId, setDiscoverTenantId]   = useState('')
  const [discovering, setDiscovering]             = useState(false)
  const [discoveryResult, setDiscoveryResult]     = useState<any>(null)
  const [togglingEntity, setTogglingEntity]       = useState('')
  const [userAction, setUserAction]               = useState('')  // userId being actioned
  const [resetResult, setResetResult]             = useState<{ email: string; tempPassword: string } | null>(null)
  const [confirmDelete, setConfirmDelete]         = useState<string | null>(null)

  // Installer download form
  const [installerTenantId, setInstallerTenantId] = useState<string | null>(null)
  const [installerForm, setInstallerForm]         = useState({ bcUsername: '', bcPassword: '', bcPort: '8048', agentPort: '9099' })
  const [installerLoading, setInstallerLoading]   = useState(false)
  const [installerError, setInstallerError]       = useState('')

  useEffect(() => {
    if (user && user.role !== 'superadmin') router.push('/dashboard')
  }, [user, router])

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/tenants').then(r => r.json()),
      fetch('/api/admin/users').then(r => r.json()),
      fetch('/api/admin/stats').then(r => r.json()),
    ]).then(([t, u, s]) => {
      setTenants(t.tenants ?? [])
      setUsers(u.users ?? [])
      setStats(s)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (tab === 'signups' && !signupsLoaded) { loadSignups() }
  }, [tab, signupsLoaded])

  function loadSignups() {
    setSignupsError(null)
    setSignupsLoaded(false)
    fetch('/api/admin/signups')
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          throw new Error(d.error ?? 'HTTP ' + r.status)
        }
        return r.json()
      })
      .then(data => {
        setSignups(data.signups ?? [])
        setSignupsLoaded(true)
      })
      .catch(e => {
        setSignupsError(e.message)
        setSignupsLoaded(true)
      })
  }

  async function toggleTenant(id: string, active: boolean) {
    await fetch(`/api/admin/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    })
    setTenants(prev => prev.map(t => t.id === id ? { ...t, active: !active } : t))
  }

  async function setTenantTier(id: string, tier: string) {
    await fetch(`/api/admin/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    })
    setTenants(prev => prev.map(t => t.id === id ? {
      ...t, tier,
      trialEndsAt: (tier === 'paid' || tier === 'enterprise') ? null : t.trialEndsAt
    } : t))
  }

  async function setTenantTerms(id: string, paymentTermsKey: string) {
    await fetch(`/api/admin/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentTermsKey }),
    })
    setTenants(prev => prev.map(t => t.id === id ? { ...t, paymentTermsKey } as any : t))
  }

  async function downloadInstaller(tenantId: string) {
    setInstallerLoading(true); setInstallerError('')
    try {
      const res = await fetch(`/api/admin/installer/${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bcUsername: installerForm.bcUsername,
          bcPassword: installerForm.bcPassword,
          bcPort:     parseInt(installerForm.bcPort) || 8048,
          agentPort:  parseInt(installerForm.agentPort) || 9099,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setInstallerError(err.error ?? 'Failed to generate installer')
        setInstallerLoading(false)
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const cd   = res.headers.get('Content-Disposition') ?? ''
      const name = cd.match(/filename="([^"]+)"/)?.[1] ?? 'Install-BespoxAI.bat'
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setInstallerTenantId(null)
      setInstallerForm({ bcUsername: '', bcPassword: '', bcPort: '8048', agentPort: '9099' })
    } catch (e: any) { setInstallerError(e.message) }
    setInstallerLoading(false)
  }

  async function toggleUserActive(userId: string, active: boolean) {
    setUserAction(userId)
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    })
    if (res.ok) setUsers(prev => prev.map(u => u.id === userId ? { ...u, active: !active } : u))
    setUserAction('')
  }

  async function toggleUserRole(userId: string, currentRole: string) {
    const cycle: Record<string, string> = { user: 'tenant_admin', tenant_admin: 'developer', developer: 'user' }
    const newRole = cycle[currentRole] ?? 'user'
    setUserAction(userId)
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    if (res.ok) setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
    setUserAction('')
  }

  async function resetUserPassword(userId: string, email: string) {
    setUserAction(userId)
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetPassword: true }),
    })
    const data = await res.json()
    if (res.ok) setResetResult({ email, tempPassword: data.tempPassword })
    setUserAction('')
  }

  async function deleteUser(userId: string) {
    setUserAction(userId)
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setUsers(prev => prev.filter(u => u.id !== userId))
      setConfirmDelete(null)
    } else {
      setError(data.error ?? 'Delete failed — the user may have linked records.')
    }
    setUserAction('')
  }

  async function discoverEntities(tenantId: string) {
    setDiscovering(true); setDiscoveryResult(null); setDiscoverTenantId(tenantId)
    const res  = await fetch(`/api/admin/discover/${tenantId}`)
    const data = await res.json()
    setDiscoveryResult(data)
    setDiscovering(false)
  }

  async function toggleEntity(tenantId: string, entity: string, enabled: boolean) {
    setTogglingEntity(entity)
    await fetch(`/api/admin/entities/${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity, enabled }),
    })
    if (discoveryResult) {
      setDiscoveryResult((prev: any) => ({
        ...prev,
        available: prev.available.map((e: any) =>
          e.name === entity ? { ...e, enabled } : e
        ),
      }))
    }
    setTogglingEntity('')
  }

  async function createTenant() {
    setSaving(true); setError(''); setProvisionSteps([])
    const endpoint = provisionMode ? '/api/admin/provision' : '/api/admin/tenants'
    const res  = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tenantForm),
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.steps) setProvisionSteps(data.steps)
      setError(data.error); setSaving(false); return
    }
    if (data.steps) setProvisionSteps(data.steps)
    setTenants(prev => [...prev, { ...data.tenant, _count: { users: 0, queryLogs: 0 } }])
    setNewTenantResult({ apiKey: data.apiKey, name: data.tenant.name, tenantId: data.tenant.id, provisioned: provisionMode, customerEmail: data.customerEmail, tempPassword: data.tempPassword })
    setTenantForm({ name: '', tunnelSubdomain: '', bcInstance: 'BC', bcCompany: 'CRONUS International Ltd.', customerEmail: '', customerName: '' })
    setShowNewTenant(false)
    setSaving(false)
  }

  async function provisionRdp(tenantId: string) {
    setRdpLoading(tenantId); setRdpError(e => ({ ...e, [tenantId]: '' }))
    try {
      const res  = await fetch('/api/admin/provision-rdp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const data = await res.json()
      if (!res.ok) setRdpError(e => ({ ...e, [tenantId]: data.error || 'Provision failed' }))
    } catch (err: any) {
      setRdpError(e => ({ ...e, [tenantId]: err.message || 'Network error' }))
    } finally {
      setRdpLoading(null)
    }
  }

  async function createUser() {
    setSaving(true); setError('')
    const res  = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userForm),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setSaving(false); return }
    const tenant = tenants.find(t => t.id === userForm.tenantId)
    setUsers(prev => [...prev, { ...data.user, active: true, tenant: { name: tenant?.name ?? '', active: true }, _count: { queryLogs: 0 } }])
    setNewUserResult({ email: data.user.email, tempPassword: data.tempPassword })
    setUserForm({ email: '', name: '', role: 'user', tenantId: '' })
    setShowNewUser(false)
    setSaving(false)
  }

  const initials = (user?.name ?? 'A').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--slate)', letterSpacing: '0.1em' }}>
      LOADING…
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'var(--font-body)' }}>

      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 199 }} />
      )}

      {/* Sidebar */}
      <aside style={{ width: sidebarOpen ? 220 : 0, flexShrink: 0, background: 'var(--ink)', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.04)', overflow: 'hidden', transition: 'width 0.2s ease', position: isMobile ? 'fixed' : 'relative', top: 0, left: 0, height: '100vh', zIndex: isMobile ? 200 : 'auto' as any }}>
        <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 22, color: 'var(--cream)', letterSpacing: '-0.3px' }}>Bespox</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 17, color: 'var(--amber)', letterSpacing: '0.04em', marginLeft: 3 }}>AI</span>
          </div>
          <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(200,149,42,0.7)' }}>
            Admin Portal
          </div>
        </div>

        <nav style={{ flex: 1, padding: '12px 10px' }}>
          {([['overview', 'Overview'], ['tenants', 'Tenants'], ['users', 'Users'], ['entities', 'Entities'], ['signups', 'Signups'], ['requirements', 'Customisations'], ['settings', '⚙ AI Setup'], ['business', '🏢 Business']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 8, marginBottom: 2, border: 'none',
              background: tab === id ? 'rgba(200,149,42,0.15)' : 'transparent',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
              onMouseEnter={e => { if (tab !== id) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={e => { if (tab !== id) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: tab === id ? 600 : 400, color: tab === id ? 'var(--amber)' : 'rgba(214,217,212,0.7)', textAlign: 'left' }}>
                {label}
              </span>
              {id === 'tenants' && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(214,217,212,0.3)' }}>{tenants.length}</span>}
              {id === 'users'   && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(214,217,212,0.3)' }}>{users.length}</span>}
            </button>
          ))}

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={() => router.push('/dashboard')} style={{
              width: '100%', padding: '9px 10px', borderRadius: 8, border: 'none',
              background: 'transparent', cursor: 'pointer', textAlign: 'left',
              fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(214,217,212,0.5)',
              transition: 'color 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(214,217,212,0.8)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(214,217,212,0.5)')}
            >
              ← CFO Assistant
            </button>
          </div>
        </nav>

        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, var(--amber), #8B6914)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: 'var(--ink)', flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--cream)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(user as any)?.preferredName || (user as any)?.firstName || user?.name}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--amber)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{user?.role === 'superadmin' ? 'Super Admin' : user?.role === 'tenant_admin' ? 'Admin' : 'User'}</div>
          </div>
          <button onClick={() => signOut({ callbackUrl: '/login' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(214,217,212,0.3)', fontSize: 14, padding: 4 }}>⎋</button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#ffffff' }}>
        <header style={{ padding: isMobile ? '0 14px' : '0 32px', height: 60, flexShrink: 0, background: 'var(--white)', borderBottom: '1px solid var(--fog)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setSidebarOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate)', fontSize: 16, padding: 4 }}>☰</button>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: isMobile ? 16 : 20, color: 'var(--ink)' }}>
              {tab === 'overview' ? 'Overview' : tab === 'tenants' ? 'Tenants' : tab === 'users' ? 'Users' : tab === 'signups' ? 'Signup Requests' : tab === 'requirements' ? 'Customisation Requests' : tab === 'settings' ? 'AI Setup' : tab === 'business' ? 'Business Settings' : 'Entities'}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {tab === 'tenants' && (
              <button onClick={() => { setShowNewTenant(true); setError('') }} style={btnStyle}>
                + New Tenant
              </button>
            )}
            {tab === 'users' && (
              <button onClick={() => { setShowNewUser(true); setError('') }} style={btnStyle}>
                + Invite User
              </button>
            )}
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>

          {/* ── Temp credential banners ──────────────────────────────────── */}
          {newTenantResult && (
            <div style={{ background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                  {newTenantResult.provisioned ? '🎉 Tenant provisioned — tunnel + DNS configured automatically' : `Tenant "${newTenantResult.name}" created`}
                </span>
                <button onClick={() => setNewTenantResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate)', fontSize: 16 }}>✕</button>
              </div>
              {provisionSteps.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {provisionSteps.map((s, i) => <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--forest)', marginBottom: 3 }}>{s}</div>)}
                </div>
              )}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>
                {newTenantResult.provisioned ? 'Pre-configured installer — ready to send to customer IT:' : 'BCAgent API Key — copy now, not shown again:'}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {newTenantResult.provisioned ? (
                  <button
                    onClick={() => { setInstallerTenantId(newTenantResult!.tenantId!); setInstallerError('') }}
                    style={btnStyle}
                  >
                    ↓ Download Installer (.bat)
                  </button>
                ) : (
                  <>
                    <code style={{ flex: 1, background: 'var(--parchment)', padding: '8px 12px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)', wordBreak: 'break-all' }}>{newTenantResult.apiKey}</code>
                    <button onClick={() => navigator.clipboard.writeText(newTenantResult!.apiKey)} style={{ ...btnStyle, flexShrink: 0, fontSize: 12 }}>Copy</button>
                  </>
                )}
              </div>
              {newTenantResult.provisioned && newTenantResult.tempPassword ? (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(200,149,42,0.2)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 6 }}>
                    {'Customer login — share securely:'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--slate)', minWidth: 60 }}>Email</span>
                      <code style={{ flex: 1, background: 'var(--parchment)', padding: '6px 10px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)' }}>{newTenantResult.customerEmail}</code>
                      <button onClick={() => navigator.clipboard.writeText(newTenantResult!.customerEmail!)} style={{ ...btnStyle, flexShrink: 0, fontSize: 11 }}>Copy</button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--slate)', minWidth: 60 }}>Password</span>
                      <code style={{ flex: 1, background: 'var(--parchment)', padding: '6px 10px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)' }}>{newTenantResult.tempPassword}</code>
                      <button onClick={() => navigator.clipboard.writeText(newTenantResult!.tempPassword!)} style={{ ...btnStyle, flexShrink: 0, fontSize: 11 }}>Copy</button>
                    </div>
                  </div>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', margin: '8px 0 0' }}>Customer will be prompted to set a new password on first login.</p>
                </div>
              ) : null}
            </div>
          )}
          {newUserResult && (
            <CredentialBanner
              title={`User ${newUserResult.email} invited`}
              label="Temporary password — share with the user:"
              value={newUserResult.tempPassword}
              onDismiss={() => setNewUserResult(null)}
            />
          )}

          {/* ── Overview tab ─────────────────────────────────────────────── */}
          {tab === 'overview' && (
<SuperAdminDashboard onNavigate={(t, reqId) => { setTab(t as any); if (reqId) setAutoSelectReqId(reqId) }} />
          )}
          {/* ── Tenants tab ───────────────────────────────────────────────── */}
          {tab === 'tenants' && (
            <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
              {showNewTenant && (
                <FormCard title={provisionMode ? 'Provision new tenant' : 'Add tenant manually'} onCancel={() => setShowNewTenant(false)} onSave={createTenant} saving={saving} error={error}>
                  {/* Mode toggle */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                    {[['auto', 'Auto-provision (recommended)', true], ['manual', 'Manual (I have a tunnel)', false]].map(([key, label, val]) => (
                      <button key={key as string} onClick={() => setProvisionMode(val as boolean)} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${provisionMode === val ? 'var(--forest)' : 'var(--fog)'}`, background: provisionMode === val ? 'rgba(26,146,114,0.08)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12, color: provisionMode === val ? 'var(--forest)' : 'var(--slate)' }}>
                        {label as string}
                      </button>
                    ))}
                  </div>
                  {provisionMode && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', margin: '0 0 4px' }}>Creates the Cloudflare tunnel, DNS record, and pre-configured installer automatically.</p>}

                  <FormRow label="Tenant name"><input style={inputStyle} value={tenantForm.name} onChange={e => setTenantForm(f => ({ ...f, name: e.target.value }))} placeholder="Acme Motors" /></FormRow>
                  <FormRow label="Tunnel subdomain"><input style={inputStyle} value={tenantForm.tunnelSubdomain} onChange={e => setTenantForm(f => ({ ...f, tunnelSubdomain: e.target.value }))} placeholder="acmemotors" /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', marginTop: 4, display: 'block' }}>→ {tenantForm.tunnelSubdomain || 'subdomain'}-agent.bespoxai.com</span></FormRow>
                  <FormRow label="Customer email"><input style={inputStyle} type="email" value={tenantForm.customerEmail} onChange={e => setTenantForm(f => ({ ...f, customerEmail: e.target.value }))} placeholder="admin@acmemotors.co.nz" /></FormRow>
                  <FormRow label="Customer name"><input style={inputStyle} value={tenantForm.customerName} onChange={e => setTenantForm(f => ({ ...f, customerName: e.target.value }))} placeholder="Jane Smith" /></FormRow>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <FormRow label="BC instance" style={{ flex: 1 }}><input style={inputStyle} value={tenantForm.bcInstance} onChange={e => setTenantForm(f => ({ ...f, bcInstance: e.target.value }))} /></FormRow>
                    <FormRow label="BC company" style={{ flex: 1 }}><input style={inputStyle} value={tenantForm.bcCompany} onChange={e => setTenantForm(f => ({ ...f, bcCompany: e.target.value }))} /></FormRow>
                  </div>
                </FormCard>
              )}

              <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--fog)' }}>
                      {['Tenant', 'Subdomain', 'BC Instance', 'Users', 'Queries', 'Status', 'Tier', 'Terms', ''].map(h => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map(t => (
                      <tr key={t.id} style={{ borderBottom: '1px solid var(--fog)', opacity: t.active ? 1 : 0.5 }}>
                        <td style={tdStyle}><span style={{ fontWeight: 500 }}>{t.name}</span></td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{t.tunnelSubdomain}</td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{t.bcInstance}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{t._count.users}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{t._count.queryLogs}</td>
                        <td style={tdStyle}><ConnectedPill connected={!!t.tunnelId} /></td>
                        <td style={tdStyle}>
                          <select
                            value={(t as any).tier ?? 'trial'}
                            onChange={e => setTenantTier(t.id, e.target.value)}
                            style={{ background: 'var(--cream)', color: 'var(--ink)', border: '1px solid var(--fog)', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
                          >
                            <option value="trial">Trial</option>
                            <option value="paid">Paid</option>
                            <option value="enterprise">Enterprise</option>
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <select
                            value={(t as any).paymentTermsKey ?? 'terms1'}
                            onChange={e => setTenantTerms(t.id, e.target.value)}
                            style={{ background: 'var(--cream)', color: 'var(--ink)', border: '1px solid var(--fog)', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
                          >
                            <option value="terms1">T1 · Standard</option>
                            <option value="terms2">T2 · Deposit + Monthly</option>
                            <option value="terms3">T3 · Account (no deposit)</option>
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <button onClick={() => toggleTenant(t.id, t.active)} style={{ ...ghostBtn, color: t.active ? '#A32D2D' : 'var(--forest)' }}>
                            {t.active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => provisionRdp(t.id)}
                            disabled={rdpLoading === t.id || !t.tunnelId}
                            title={!t.tunnelId ? 'No tunnel — provision main tunnel first' : 'Provision RDP tunnel ingress + DNS'}
                            style={{ ...ghostBtn, color: 'var(--slate)', marginLeft: 8, opacity: (!t.tunnelId || rdpLoading === t.id) ? 0.4 : 1 }}
                          >
                            {rdpLoading === t.id ? '⟳' : 'RDP'}{' — '}{t.name}
                          </button>
                          {t.rdpPassword ? (
                            <button
                              onClick={() => navigator.clipboard.writeText(t.rdpPassword!)}
                              title="Copy RDP password"
                              style={{ ...ghostBtn, color: 'var(--slate)', marginLeft: 4, fontSize: 12 }}
                            >⧉</button>
                          ) : null}
                          {rdpError[t.id] ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A32D2D', marginLeft: 6 }}>✗</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Users tab ─────────────────────────────────────────────────── */}
          {tab === 'users' && (
            <div>
              {showNewUser && (
                <FormCard title="Invite user" onCancel={() => setShowNewUser(false)} onSave={createUser} saving={saving} error={error}>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <FormRow label="Email" style={{ flex: 1 }}><input style={inputStyle} type="email" value={userForm.email} onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))} placeholder="user@company.com" /></FormRow>
                    <FormRow label="Name" style={{ flex: 1 }}><input style={inputStyle} value={userForm.name} onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" /></FormRow>
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <FormRow label="Tenant" style={{ flex: 2 }}>
                      <select style={inputStyle} value={userForm.tenantId} onChange={e => setUserForm(f => ({ ...f, tenantId: e.target.value }))}>
                        <option value="">Select tenant…</option>
                        {tenants.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </FormRow>
                    <FormRow label="Role" style={{ flex: 1 }}>
                      <select style={inputStyle} value={userForm.role} onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))}>
                        <option value="user">User</option>
                        <option value="tenant_admin">Tenant Admin</option>
                        <option value="developer">Developer</option>
                      </select>
                    </FormRow>
                  </div>
                </FormCard>
              )}

              <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--fog)' }}>
                      {['User', 'Email', 'Tenant', 'Role', 'Joined', 'Status', 'Actions'].map(h => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--fog)' }}>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}><span style={{ fontWeight: 500 }}>{u.name || '—'}</span></td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{u.email}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{u.tenant.name}</td>
                        <td style={tdStyle}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 6, background: u.role === 'superadmin' ? 'rgba(200,149,42,0.12)' : u.role === 'tenant_admin' ? 'rgba(26,146,114,0.08)' : u.role === 'developer' ? 'rgba(59,82,163,0.08)' : 'rgba(59,82,73,0.08)', color: u.role === 'superadmin' ? 'var(--amber)' : u.role === 'tenant_admin' ? 'var(--forest)' : u.role === 'developer' ? '#3B52A3' : 'var(--slate)', border: `1px solid ${u.role === 'superadmin' ? 'rgba(200,149,42,0.3)' : u.role === 'tenant_admin' ? 'rgba(26,146,114,0.2)' : u.role === 'developer' ? 'rgba(59,82,163,0.2)' : 'rgba(59,82,73,0.2)'}` }}>
                            {u.role === 'superadmin' ? 'Super Admin' : u.role === 'tenant_admin' ? 'Admin' : u.role === 'developer' ? 'Developer' : 'User'}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', whiteSpace: 'nowrap' }}>
                          {new Date(u.createdAt).toLocaleDateString([], { dateStyle: 'short' })}
                        </td>
                        <td style={tdStyle}><StatusPill active={u.active} /></td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
                            {u.role === 'superadmin' ? (
                              <span style={{ fontSize: 10, color: 'var(--slate)', fontStyle: 'italic', whiteSpace: 'nowrap' }}>🔒 protected</span>
                            ) : (
                              <>
                                <button
                                  disabled={userAction === u.id}
                                  onClick={() => toggleUserRole(u.id, u.role)}
                                  style={{ ...ghostBtn, color: u.role === 'tenant_admin' ? 'var(--slate)' : u.role === 'developer' ? 'var(--slate)' : 'var(--forest)', fontSize: 10, whiteSpace: 'nowrap' }}
                                  title={u.role === 'tenant_admin' ? 'Make Developer' : u.role === 'developer' ? 'Make User' : 'Make Admin'}
                                >
                                  {userAction === u.id ? '…' : u.role === 'tenant_admin' ? '→ Dev' : u.role === 'developer' ? '→ User' : '↑ Admin'}
                                </button>
                                <button
                                  disabled={userAction === u.id}
                                  onClick={() => toggleUserActive(u.id, u.active)}
                                  style={{ ...ghostBtn, color: u.active ? '#A32D2D' : 'var(--forest)', fontSize: 10, whiteSpace: 'nowrap' }}
                                >
                                  {userAction === u.id ? '…' : u.active ? 'Disable' : 'Enable'}
                                </button>
                                <button
                                  disabled={userAction === u.id}
                                  onClick={() => resetUserPassword(u.id, u.email)}
                                  style={{ ...ghostBtn, color: 'var(--slate)', fontSize: 10, whiteSpace: 'nowrap' }}
                                >
                                  Reset pw
                                </button>
                                <button
                                  disabled={userAction === u.id}
                                  onClick={() => { setError(''); setConfirmDelete(u.id) }}
                                  style={{ ...ghostBtn, color: '#A32D2D', fontSize: 10, whiteSpace: 'nowrap' }}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        {/* ── Signups tab ───────────────────────────────────────────────── */}
          {tab === 'signups' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontFamily: 'var(--font-cormorant)', fontSize: 22, margin: 0 }}>Signup Requests</h3>
              <button
                onClick={() => loadSignups()}
                style={{ background: 'transparent', border: '1px solid var(--fog)', borderRadius: 6, padding: '6px 14px', fontSize: 12, color: 'var(--slate)', cursor: 'pointer' }}
              >
                ↻ Refresh
              </button>
            </div>
            {signupsError ? (
              <div style={{ background: '#fff0f0', border: '1px solid #fcc', borderRadius: 8, padding: 16, color: '#A32D2D', fontSize: 13 }}>
                ⚠ Failed to load signups: <strong>{signupsError}</strong>
                <button onClick={() => setSignupsLoaded(false)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#A32D2D', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}>Retry</button>
              </div>
            ) : signups.length === 0 ? (
              <p style={{ color: 'var(--slate)', fontSize: 14 }}>No signup requests yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--fog)' }}>
                    {['Company', 'Email', 'Country', 'BC Version', 'Submitted', 'Verified', 'Status', ''].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--slate)', fontWeight: 600, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {signups.map((s: any) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--fog)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{s.companyName}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--slate)' }}>{s.email}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--slate)' }}>{s.country}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--slate)' }}>{s.bcVersion}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--slate)' }}>{new Date(s.createdAt).toLocaleDateString('en-NZ')}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {s.verifiedAt
                          ? <span style={{ color: 'var(--forest)', fontWeight: 600 }}>✓ Verified</span>
                          : <span style={{ color: 'var(--slate)' }}>Pending</span>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {s.activatedAt
                          ? <span style={{ color: 'var(--forest)', fontSize: 12 }}>✅ Activated</span>
                          : s.verifiedAt
                            ? <span style={{ color: '#C8952A', fontSize: 12, fontWeight: 600 }}>Ready to activate</span>
                            : <span style={{ color: 'var(--slate)', fontSize: 12 }}>Awaiting verification</span>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {!s.verifiedAt && !s.activatedAt && (
                            <button
                              onClick={async () => {
                                setActivating(s.id)
                                const res = await fetch(`/api/admin/signups/${s.id}/verify`, { method: 'POST' })
                                const data = await res.json()
                                if (res.ok) {
                                  setSignups(prev => prev.map(x => x.id === s.id ? { ...x, verifiedAt: new Date().toISOString() } : x))
                                } else {
                                  alert(data.error ?? 'Force verify failed')
                                }
                                setActivating(null)
                              }}
                              disabled={activating === s.id}
                              style={{ background: 'transparent', color: '#C8952A', border: '1px solid rgba(200,149,42,0.5)', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                            >
                              {activating === s.id ? '…' : '✓ Force Verify'}
                            </button>
                          )}
                          {s.verifiedAt && !s.activatedAt && (
                            <button
                              onClick={async () => {
                                setActivating(s.id)
                                const res = await fetch(`/api/admin/signups/${s.id}/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
                                const data = await res.json()
                                if (res.ok) {
                                  setSignups(prev => prev.map(x => x.id === s.id ? { ...x, activatedAt: new Date().toISOString() } : x))
                                } else {
                                  alert(data.error ?? 'Activation failed')
                                }
                                setActivating(null)
                              }}
                              disabled={activating === s.id}
                              style={{ background: '#0A5C46', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                            >
                              {activating === s.id ? 'Activating…' : 'Activate →'}
                            </button>
                          )}
                          {!s.activatedAt && (
                            <button
                              onClick={async () => {
                                if (!confirm('Delete signup request for ' + s.email + '? This cannot be undone.')) return
                                try {
                                  const res = await fetch('/api/admin/signups/' + s.id, { method: 'DELETE' })
                                  if (res.ok) {
                                    setSignups(prev => prev.filter(x => x.id !== s.id))
                                  } else {
                                    const data = await res.json().catch(() => ({}))
                                    alert(data.error ?? 'Delete failed — HTTP ' + res.status)
                                  }
                                } catch (e: any) {
                                  alert('Delete failed: ' + e.message)
                                }
                              }}
                              style={{ background: 'transparent', color: '#A32D2D', border: '1px solid rgba(163,45,45,0.3)', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Requirements tab ──────────────────────────────────────────────── */}
        {tab === 'requirements' && (
          <AdminRequirementsTab autoSelectReqId={autoSelectReqId} onAutoSelectDone={() => setAutoSelectReqId(null)} />
        )}

        {/* ── AI Setup tab ──────────────────────────────────────────────────── */}
        {tab === 'settings' && (
          <AISettingsTab />
        )}

        {/* ── Business Settings tab ─────────────────────────────────────────── */}
        {tab === 'business' && (
          <BusinessSettingsTab />
        )}

        {tab === 'entities' && (
            <div>
              {/* Tenant selector */}
              <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>Select tenant to scan</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <select style={{ ...inputStyle, flex: 1 }} value={discoverTenantId} onChange={e => setDiscoverTenantId(e.target.value)}>
                    <option value="">Choose a tenant…</option>
                    {tenants.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button onClick={() => discoverTenantId && discoverEntities(discoverTenantId)} disabled={!discoverTenantId || discovering} style={{ ...btnStyle, flexShrink: 0, opacity: (!discoverTenantId || discovering) ? 0.6 : 1 }}>
                    {discovering ? 'Scanning…' : 'Scan BC'}
                  </button>
                </div>
                {discoveryResult?.fetchError && (
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#A32D2D', marginTop: 10 }}>⚠ Could not reach BCAgent: {discoveryResult.fetchError}</p>
                )}
              </div>

              {discoveryResult && !discoveryResult.fetchError && (
                <>
                  {/* Summary */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Available in BC', value: discoveryResult.available?.length ?? 0, color: 'var(--forest)' },
                      { label: 'Missing from BC', value: discoveryResult.missing?.length ?? 0, color: 'var(--amber)' },
                      { label: 'Uncatalogued', value: discoveryResult.uncatalogued?.length ?? 0, color: 'var(--slate)' },
                      { label: 'Total in BC', value: discoveryResult.totalInBC ?? 0, color: 'var(--ink)' },
                    ].map((s, i) => (
                      <div key={i} style={{ flex: '1 1 120px', background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '12px 16px' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 300, color: s.color }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Available entities — toggleable */}
                  {discoveryResult.available?.length > 0 && (
                    <>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 10 }}>Available in this BC — toggle to enable/disable for AI planner</div>
                      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead><tr style={{ borderBottom: '1px solid var(--fog)' }}>
                            {['Entity', 'Description', 'Enabled'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {discoveryResult.available.map((e: any) => (
                              <tr key={e.name} style={{ borderBottom: '1px solid var(--fog)', opacity: e.enabled ? 1 : 0.55 }}>
                                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500 }}>{e.name}</td>
                                <td style={{ ...tdStyle, fontSize: 12, color: 'var(--slate)', maxWidth: 360 }}>{e.description.split('—')[0].trim()}</td>
                                <td style={tdStyle}>
                                  <button
                                    disabled={togglingEntity === e.name}
                                    onClick={() => toggleEntity(discoverTenantId, e.name, !e.enabled)}
                                    style={{ ...ghostBtn, color: e.enabled ? 'var(--forest)' : 'var(--slate)', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                                  >
                                    {togglingEntity === e.name ? '…' : e.enabled ? '● On' : '○ Off'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {/* Uncatalogued entities */}
                  {discoveryResult.uncatalogued?.length > 0 && (
                    <>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 10 }}>Published in BC but not yet in BespoxAI catalogue</div>
                      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead><tr style={{ borderBottom: '1px solid var(--fog)' }}>
                            {['Entity name', 'Status'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {discoveryResult.uncatalogued.map((e: any) => (
                              <tr key={e.name} style={{ borderBottom: '1px solid var(--fog)' }}>
                                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{e.name}</td>
                                <td style={{ ...tdStyle, fontSize: 12, color: 'var(--slate)' }}>Use /api/bc-test?entity={e.name} to inspect fields</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {/* Missing entities */}
                  {discoveryResult.missing?.length > 0 && (
                    <>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 10 }}>In BespoxAI catalogue but not published in this BC</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {discoveryResult.missing.map((e: any) => (
                          <span key={e.name} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '4px 10px', borderRadius: 6, background: 'rgba(163,45,45,0.06)', border: '1px solid rgba(163,45,45,0.15)', color: '#A32D2D' }}>{e.name}</span>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

        </div>
      </div>
      {/* Reset password result */}
      {resetResult && (
        <CredentialBanner
          title={`Password reset for ${resetResult.email}`}
          label="New temporary password — share with the user:"
          value={resetResult.tempPassword}
          onDismiss={() => setResetResult(null)}
        />
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,14,9,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--white)', borderRadius: 16, padding: '28px 32px', width: 400, boxShadow: '0 8px 40px rgba(4,14,9,0.2)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500, color: 'var(--ink)', margin: '0 0 12px' }}>Delete user?</h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', marginBottom: 24, lineHeight: 1.6 }}>
              This will permanently delete the user and all their query history. This cannot be undone.
            </p>
            {error && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#A32D2D', background: 'rgba(163,45,45,0.06)', border: '1px solid rgba(163,45,45,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 16 }}>
                {error}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => deleteUser(confirmDelete)} style={{ background: '#A32D2D', color: 'var(--white)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500 }}>
                Delete permanently
              </button>
              <button onClick={() => setConfirmDelete(null)} style={{ background: 'var(--fog)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Installer download modal */}
      {installerTenantId && (
        <InstallerModal
          tenantName={tenants.find(t => t.id === installerTenantId)?.name ?? newTenantResult?.name ?? ''}
          loading={installerLoading}
          error={installerError}
          form={installerForm}
          onChange={setInstallerForm}
          onDownload={() => downloadInstaller(installerTenantId)}
          onClose={() => setInstallerTenantId(null)}
        />
      )}
    </div>
  )
}

// ─── Installer modal ──────────────────────────────────────────────────────────

function InstallerModal({ tenantName, loading, error, form, onChange, onDownload, onClose }: {
  tenantName: string; loading: boolean; error: string
  form: { bcUsername: string; bcPassword: string; bcPort: string; agentPort: string }
  onChange: (f: any) => void; onDownload: () => void; onClose: () => void
}) {
  const iStyle: React.CSSProperties = { width: '100%', background: 'var(--cream)', border: '1px solid var(--fog)', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }
  const lStyle: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', display: 'block', marginBottom: 6 }
  const bStyle: React.CSSProperties = { background: 'var(--forest)', color: 'var(--white)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500 }
  const canDownload = !!form.bcUsername && !loading
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,14,9,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--white)', borderRadius: 16, padding: '28px 32px', width: 480, maxWidth: '90vw', boxShadow: '0 8px 40px rgba(4,14,9,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>Generate installer</h2>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', marginTop: 4 }}>{tenantName}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate)', fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', margin: '12px 0 20px', lineHeight: 1.6 }}>
          Enter the customer's BC credentials. These will be pre-filled in the installer — send the .bat file securely.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label style={lStyle}>BC Username (DOMAIN\user)</label><input style={iStyle} value={form.bcUsername} onChange={e => onChange({ ...form, bcUsername: e.target.value })} placeholder="CONTOSO\svc_bc" /></div>
          <div><label style={lStyle}>BC Password</label><input style={iStyle} type="password" value={form.bcPassword} onChange={e => onChange({ ...form, bcPassword: e.target.value })} placeholder="Password" /></div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1 }}><label style={lStyle}>BC OData Port</label><input style={iStyle} value={form.bcPort} onChange={e => onChange({ ...form, bcPort: e.target.value })} /></div>
            <div style={{ flex: 1 }}><label style={lStyle}>Agent Port</label><input style={iStyle} value={form.agentPort} onChange={e => onChange({ ...form, agentPort: e.target.value })} /></div>
          </div>
        </div>
        {error && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#A32D2D', marginTop: 12 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button onClick={onDownload} disabled={!canDownload} style={{ ...bStyle, opacity: canDownload ? 1 : 0.6, cursor: canDownload ? 'pointer' : 'not-allowed' }}>
            {loading ? 'Generating…' : '↓ Download Installer (.bat)'}
          </button>
          <button onClick={onClose} style={{ ...bStyle, background: 'var(--fog)', color: 'var(--ink)' }}>Cancel</button>
        </div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', marginTop: 12, lineHeight: 1.6 }}>
          The .bat auto-elevates to Administrator. IT double-clicks it — no PowerShell knowledge needed.
        </p>
      </div>
    </div>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const btnStyle = {
  background: 'var(--forest)', color: 'var(--white)', border: 'none',
  borderRadius: 8, padding: '8px 16px', cursor: 'pointer',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500,
}

const ghostBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
  padding: '4px 8px',
}

const thStyle: React.CSSProperties = {
  padding: '10px 16px', textAlign: 'left',
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'var(--slate)',
  background: 'var(--parchment)', fontWeight: 400,
}

const tdStyle: React.CSSProperties = {
  padding: '12px 16px', color: 'var(--ink)',
  borderBottom: '1px solid var(--fog)',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--cream)', border: '1px solid var(--fog)',
  borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: 'var(--font-body)',
  color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ active }: { active: boolean }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em',
      textTransform: 'uppercase', padding: '2px 8px', borderRadius: 8,
      background: active ? 'rgba(26,146,114,0.08)' : 'rgba(163,45,45,0.06)',
      color: active ? 'var(--forest)' : '#A32D2D',
      border: '1px solid ' + (active ? 'rgba(26,146,114,0.2)' : 'rgba(163,45,45,0.2)'),
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function ConnectedPill({ connected }: { connected: boolean }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em',
      textTransform: 'uppercase', padding: '2px 8px', borderRadius: 8,
      background: connected ? 'rgba(26,146,114,0.08)' : 'rgba(163,45,45,0.06)',
      color: connected ? 'var(--forest)' : '#A32D2D',
      border: '1px solid ' + (connected ? 'rgba(26,146,114,0.2)' : 'rgba(163,45,45,0.2)'),
    }}>
      {connected ? 'Connected' : 'Not Connected'}
    </span>
  )
}

function SectionHead({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 12, ...style }}>
      {children}
    </div>
  )
}

function FormRow({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <label style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)' }}>{label}</label>
      {children}
    </div>
  )
}

function FormCard({ title, children, onCancel, onSave, saving, error }: { title: string; children: React.ReactNode; onCancel: () => void; onSave: () => void; saving: boolean; error: string }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500, color: 'var(--ink)', marginBottom: 16 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
      {error && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#A32D2D', marginTop: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={onSave} disabled={saving} style={{ ...btnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Create'}</button>
        <button onClick={onCancel} style={{ ...btnStyle, background: 'var(--fog)', color: 'var(--ink)' }}>Cancel</button>
      </div>
    </div>
  )
}

function CredentialBanner({ title, label, value, onDismiss }: { title: string; label: string; value: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{title}</span>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate)', fontSize: 16, lineHeight: 1 }}>✕</button>
      </div>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>{label}</p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <code style={{ flex: 1, background: 'var(--parchment)', padding: '8px 12px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)', wordBreak: 'break-all' }}>{value}</code>
        <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          style={{ ...btnStyle, flexShrink: 0, fontSize: 12 }}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

// ─── Markdown helpers for AI response bubbles ────────────────────────────────

function mdInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} style={{ fontWeight: 600, color: 'rgba(244,239,228,1)' }}>{part.slice(2, -2)}</strong>
      : part
  )
}

function mdInlineLight(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} style={{ fontWeight: 600, color: 'var(--ink)' }}>{part.slice(2, -2)}</strong>
      : part
  )
}

function renderMdLight(text: string): React.ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (/^#{1,2} /.test(line))
      return <p key={i} style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)', margin: '10px 0 2px', lineHeight: 1.3 }}>{mdInlineLight(line.replace(/^#+ /, ''))}</p>
    if (/^### /.test(line))
      return <p key={i} style={{ fontWeight: 600, fontSize: 11, color: 'var(--ink)', margin: '8px 0 2px', lineHeight: 1.3 }}>{mdInlineLight(line.slice(4))}</p>
    if (line === '---')
      return <hr key={i} style={{ border: 'none', borderTop: '1px solid var(--fog)', margin: '8px 0' }} />
    if (/^[-–] /.test(line))
      return <div key={i} style={{ display: 'flex', gap: 6, margin: '2px 0', alignItems: 'flex-start', paddingLeft: 20 }}><span style={{ color: 'var(--forest)', flexShrink: 0, marginTop: 1 }}>–</span><span style={{ lineHeight: 1.6, color: 'var(--ink)' }}>{mdInlineLight(line.replace(/^[-–] /, ''))}</span></div>
    if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)/)?.[1]
      return <div key={i} style={{ display: 'flex', gap: 8, margin: '4px 0 1px', alignItems: 'baseline' }}><span style={{ color: 'var(--forest)', flexShrink: 0, minWidth: 16, fontWeight: 600, textAlign: 'right' as const }}>{num}.</span><span style={{ lineHeight: 1.5, color: 'var(--ink)', fontWeight: 600 }}>{mdInlineLight(line.replace(/^\d+\.\s/, ''))}</span></div>
    }
    if (line === '') return <div key={i} style={{ height: 4 }} />
    return <p key={i} style={{ margin: '2px 0', lineHeight: 1.7, color: 'var(--ink)' }}>{mdInlineLight(line)}</p>
  })
}

function renderMd(text: string): React.ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (/^#{1,2} /.test(line))
      return <p key={i} style={{ fontWeight: 700, fontSize: 13, color: 'rgba(244,239,228,0.98)', margin: '12px 0 3px', lineHeight: 1.3 }}>{mdInline(line.replace(/^#+\s/, ''))}</p>
    if (/^### /.test(line))
      return <p key={i} style={{ fontWeight: 600, fontSize: 12, color: 'rgba(244,239,228,0.92)', margin: '8px 0 2px', lineHeight: 1.3 }}>{mdInline(line.slice(4))}</p>
    if (line === '---' || line === '––––')
      return <hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.12)', margin: '10px 0' }} />
    if (/^[-–] /.test(line))
      return <div key={i} style={{ display: 'flex', gap: 6, margin: '2px 0', alignItems: 'flex-start' }}><span style={{ color: 'rgba(200,149,42,0.7)', flexShrink: 0, marginTop: 1 }}>–</span><span style={{ lineHeight: 1.6 }}>{mdInline(line.replace(/^[-–] /, ''))}</span></div>
    if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)/)?.[1]
      return <div key={i} style={{ display: 'flex', gap: 6, margin: '2px 0', alignItems: 'flex-start' }}><span style={{ color: 'rgba(200,149,42,0.7)', flexShrink: 0, minWidth: 18, marginTop: 1 }}>{num}.</span><span style={{ lineHeight: 1.6 }}>{mdInline(line.replace(/^\d+\.\s/, ''))}</span></div>
    }
    if (line === '') return <div key={i} style={{ height: 5 }} />
    return <p key={i} style={{ margin: '2px 0', lineHeight: 1.7 }}>{mdInline(line)}</p>
  })
}

// ─── Admin Requirements Tab ────────────────────────────────────────────────────

const STATUS_PIPELINE_ADMIN = ['draft','submitted','needs_clarification','in_review','quoted','quote_rejected','deposit_required','deposit_paid','in_development','in_uat','uat_confirmed','uat_rejected','complete_pending_payment','fully_paid','rejected']
const STATUS_COLOR_ADMIN: Record<string, { bg: string; border: string; text: string }> = {
  draft:                    { bg: 'rgba(59,82,73,0.06)',   border: 'rgba(59,82,73,0.15)',   text: '#3B5249' },
  submitted:                { bg: 'rgba(200,149,42,0.08)', border: 'rgba(200,149,42,0.25)', text: '#C8952A' },
  needs_clarification:      { bg: 'rgba(200,60,60,0.1)',   border: 'rgba(200,60,60,0.35)',  text: '#A32D2D' },
  in_review:                { bg: 'rgba(200,149,42,0.12)', border: 'rgba(200,149,42,0.35)', text: '#9A6A00' },
  quoted:                   { bg: 'rgba(10,92,70,0.08)',   border: 'rgba(10,92,70,0.2)',    text: '#0A5C46' },
  quote_rejected:           { bg: 'rgba(163,45,45,0.14)', border: 'rgba(163,45,45,0.45)',  text: '#8B1A1A' },
  deposit_required:         { bg: 'rgba(200,149,42,0.12)', border: 'rgba(200,149,42,0.4)', text: '#7A5200' },
  deposit_paid:             { bg: 'rgba(26,146,114,0.1)',  border: 'rgba(26,146,114,0.3)', text: '#0F6E56' },
  in_development:           { bg: 'rgba(14,110,86,0.1)',   border: 'rgba(14,110,86,0.25)', text: '#0A5C46' },
  in_uat:                   { bg: 'rgba(200,149,42,0.12)', border: 'rgba(200,149,42,0.4)', text: '#7A5200' },
  uat_confirmed:            { bg: 'rgba(26,146,114,0.12)', border: 'rgba(26,146,114,0.35)',text: '#0A5240' },
  uat_rejected:             { bg: 'rgba(163,45,45,0.14)', border: 'rgba(163,45,45,0.45)',  text: '#8B1A1A' },
  complete_pending_payment: { bg: 'rgba(200,149,42,0.1)',  border: 'rgba(200,149,42,0.3)', text: '#7A5200' },
  fully_paid:               { bg: 'rgba(26,146,114,0.12)', border: 'rgba(26,146,114,0.35)',text: '#0A5240' },
  rejected:                 { bg: 'rgba(163,45,45,0.14)', border: 'rgba(163,45,45,0.45)',  text: '#8B1A1A' },
}
const PRIORITY_LABEL: Record<string, string> = { nice_to_have: 'Nice to have', important: 'Important', critical: 'Critical' }
const PRIORITY_COLOR: Record<string, string> = { nice_to_have: '#3B5249', important: '#C8952A', critical: '#A32D2D' }

interface AdminReq {
  id: string; tenantId: string; userId: string; title: string; description: string
  bcArea: string; priority: string; aiSpec: string | null; status: string
  quote: string | null; quoteApprovedAt: string | null; consultantNote: string | null
  adminQuestions: string | null; customerAnswers: string | null; adminQALog: string | null
  quoteRejectedAt: string | null; quoteRejectionReason: string | null
  devPlan: string | null
  // Deployment & UAT
  testDeployedAt:       string | null
  testDeploySnapshotId: string | null
  uatApprovedAt:        string | null
  uatApprovedById:      string | null
  uatRejectedAt:        string | null
  uatRejectionReason:   string | null
  uatRejectionAnalysis: any | null
  // Production deployment
  prodApprovalSentAt:   string | null
  prodGoLiveDoc:        string | null
  prodApprovedAt:       string | null
  prodApprovedById:     string | null
  prodDeployedAt:       string | null
  prodDeploySnapshotId: string | null
  deploymentNotes:      string | null
  // Pipeline timestamps
  submittedAt:              string | null
  inReviewAt:               string | null
  quotedAt:                 string | null
  depositRequiredAt:        string | null
  inDevelopmentAt:          string | null
  completePendingPaymentAt: string | null
  assignedDeveloper:    { id: string; name: string | null; email: string } | null
  githubBranch:         string | null
  parentId:             string | null
  addenda:              { id: string; title: string; status: string; quote: string | null; createdAt: string; parentId: string }[]
  createdAt: string; updatedAt: string
  user: { name: string | null; email: string }
  tenant: { name: string }
}

// ─── Deploy to Test Panel ──────────────────────────────────────────────────────

interface DeployPanelProps {
  selected:        AdminReq
  syncLoading:     boolean
  syncResult:      string
  syncErr:         string
  writeLoading:    boolean
  writeSnapshotId: string | null
  writeErr:        string
  deployLoading:   boolean
  deployResults:   any[] | null
  deployDebug:     boolean
  deployErr:       string
  onSync:          () => void
  onWrite:         () => void
  onDeploy:        () => void
  onManualDeploy:  () => void
}

function DeployToTestPanel(props: DeployPanelProps) {
  const { selected, syncLoading, syncResult, syncErr,
          writeLoading, writeSnapshotId, writeErr,
          deployLoading, deployResults, deployDebug, deployErr,
          onSync, onWrite, onDeploy, onManualDeploy } = props
  const [manualMode,    setManualMode]    = useState(false)
  const [manualLoading, setManualLoading] = useState(false)
  const [manualErr,     setManualErr]     = useState<string|null>(null)

  async function handleManualDeployTest() {
    if (!confirm('Confirm manual deployment to test? This will advance the requirement to In UAT and record a deployment note.')) return
    setManualLoading(true); setManualErr(null)
    try {
      const res = await fetch('/api/requirements/' + selected.id + '/manual-deploy-test', { method: 'POST' })
      if (!res.ok) { const e = await res.json(); setManualErr(e.error ?? 'Failed'); return }
      setManualMode(false)
      onManualDeploy()
    } catch (e: any) {
      setManualErr(e.message ?? 'Network error')
    } finally {
      setManualLoading(false)
    }
  }

  const base: React.CSSProperties = {
    fontFamily: 'var(--font-body)', fontSize: 12, padding: '7px 14px',
    borderRadius: 6, cursor: 'pointer', border: '1px solid var(--fog)',
    background: 'var(--white)', color: 'var(--ink)',
  }

  const deployedDate = selected.testDeployedAt
    ? new Date(selected.testDeployedAt).toLocaleDateString('en-NZ') : ''
  const approvedDate = selected.uatApprovedAt
    ? new Date(selected.uatApprovedAt).toLocaleDateString('en-NZ') : ''

  const scriptLines = [
    '# Run on the customer server (PowerShell):',
    'Import-NAVApplicationObject -DatabaseServer localhost \\',
    '  -DatabaseName "TEST_DB_NAME" \\',
    '  -Path "C:\\BespoxAI\\Deployments\\' + selected.id + '\\' + (writeSnapshotId ?? 'SNAPSHOT') + '\\*.txt" \\',
    '  -ImportAction Overwrite -SynchronizeSchemaChanges Force',
    'Compile-NAVApplicationObject -DatabaseServer localhost \\',
    '  -DatabaseName "TEST_DB_NAME" -SynchronizeSchemaChanges Force',
  ]

  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 8, padding: '12px 14px' }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 10 }}>
        Deploy to Test Environment
      </p>

      {selected.uatApprovedAt
        ? <div style={{ background: 'rgba(10,92,70,0.06)', border: '1px solid rgba(10,92,70,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#0A5C46', margin: 0 }}>
              UAT approved — {approvedDate}
            </p>
          </div>
        : null}

      {(selected.uatRejectedAt && !selected.testDeployedAt)
        ? <div style={{ background: 'rgba(163,45,45,0.06)', border: '1px solid rgba(163,45,45,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A32D2D', marginBottom: 4 }}>
              UAT rejected — new deployment cycle required
            </p>
            {selected.uatRejectionReason
              ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', margin: 0 }}>
                  Reason: {selected.uatRejectionReason}
                </p>
              : null}
          </div>
        : null}

      {(selected.testDeployedAt && !selected.uatApprovedAt)
        ? <div style={{ background: 'rgba(200,149,42,0.06)', border: '1px solid rgba(200,149,42,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#9A6A00', margin: 0 }}>
              Deployed to test {deployedDate} — awaiting UAT sign-off
            </p>
          </div>
        : null}

      {/* ── Sync from GitHub ─────────────────────────────────────── */}
      <div style={{ background: 'rgba(26,146,114,0.04)', border: '1px solid rgba(26,146,114,0.15)', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>
          Sync from GitHub
        </p>
        {selected.githubBranch
          ? <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', marginBottom: 8 }}>
              {'Branch: ' + selected.githubBranch}
            </p>
          : <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#A32D2D', marginBottom: 8 }}>
              No GitHub branch — fetch objects from BCAgent first
            </p>}
        <button
          onClick={onSync}
          disabled={syncLoading || !selected.githubBranch}
          style={{ ...base, background: selected.githubBranch ? 'var(--ink)' : 'var(--fog)', color: selected.githubBranch ? 'var(--cream)' : 'var(--slate)', border: 'none', fontSize: 11 }}
        >
          {syncLoading ? 'Syncing…' : 'Pull latest from GitHub → DB'}
        </button>
        {syncResult
          ? <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#0A5C46', marginTop: 6, marginBottom: 0 }}>{syncResult}</p>
          : null}
        {syncErr
          ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#A32D2D', marginTop: 6, marginBottom: 0 }}>{syncErr}</p>
          : null}
      </div>

      {/* Manual deployment toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingTop: 4 }}>
        <input
          type="checkbox"
          id={'manual-test-' + selected.id}
          checked={manualMode}
          onChange={e => { setManualMode(e.target.checked); setManualErr(null) }}
          style={{ cursor: 'pointer' }}
        />
        <label htmlFor={'manual-test-' + selected.id} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', cursor: 'pointer' }}>
          Mark as manually deployed
        </label>
      </div>

      {manualMode ? (
        <div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginBottom: 10 }}>
            Steps 1 &amp; 2 will be skipped. The deployment will be recorded as a manual deployment note.
          </p>
          <button
            onClick={handleManualDeployTest}
            disabled={manualLoading}
            style={{ ...base, background: '#0A5C46', color: '#fff', border: 'none' }}
          >
            {manualLoading ? 'Confirming\u2026' : 'Confirm Manual Deployment'}
          </button>
          {manualErr ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#A32D2D', marginTop: 6 }}>{manualErr}</p> : null}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', minWidth: 60 }}>Step 1</span>
            <button
              onClick={onWrite}
              disabled={writeLoading}
              style={{ ...base, background: writeSnapshotId ? 'var(--fog)' : 'var(--ink)', color: writeSnapshotId ? 'var(--slate)' : 'var(--cream)', border: 'none' }}
            >
              {writeLoading ? 'Writing\u2026' : writeSnapshotId ? 'Files written \u2014 re-write' : 'Write files to server'}
            </button>
            {writeSnapshotId
              ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#0A5C46' }}>
                  {writeSnapshotId}
                </span>
              : null}
          </div>
          {writeErr
            ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#A32D2D', margin: '0 0 8px' }}>{writeErr}</p>
            : null}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', minWidth: 60 }}>Step 2</span>
            <button
              onClick={onDeploy}
              disabled={!writeSnapshotId || deployLoading}
              style={{ ...base, background: writeSnapshotId ? '#0A5C46' : 'var(--fog)', color: 'var(--cream)', border: 'none' }}
            >
              {deployLoading ? 'Deploying\u2026' : 'Deploy + Compile to Test'}
            </button>
            {writeSnapshotId
              ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#0A5C46' }}>{writeSnapshotId}</span>
              : null}
          </div>
          {deployErr
            ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#A32D2D', margin: '8px 0 0' }}>{deployErr}</p>
            : null}

          {deployResults
            ? <div style={{ marginTop: 10, border: '1px solid var(--fog)', borderRadius: 6, overflow: 'hidden' }}>
                {deployDebug
                  ? <div style={{ background: '#FAEEDA', borderBottom: '1px solid #EF9F27', padding: '4px 10px' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#633806' }}>
                        DEBUG \u2014 simulated results only
                      </span>
                    </div>
                  : null}
                {deployResults.map((r: any, i: number) => (
                  <div
                    key={i}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: (r.imported && r.compiled) ? 'rgba(10,92,70,0.03)' : 'rgba(163,45,45,0.03)' }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, flex: 1 }}>{r.filename}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: r.imported ? '#0A5C46' : '#A32D2D' }}>
                      imp {r.imported ? 'ok' : 'fail'}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: r.compiled ? '#0A5C46' : '#A32D2D' }}>
                      cmp {r.compiled ? 'ok' : 'fail'}
                    </span>
                  </div>
                ))}
              </div>
            : null}

          {deployErr && deployErr.includes('timeout')
            ? <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)' }}>
                  Manual deployment instructions
                </summary>
                <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 9, background: 'var(--parchment)', padding: '8px 10px', borderRadius: 6, marginTop: 6, whiteSpace: 'pre-wrap' }}>
                  {scriptLines.join('\n')}
                </pre>
              </details>
            : null}
        </div>
      )}

      {selected.deploymentNotes ? (
        <div style={{ marginTop: 10, background: 'rgba(10,92,70,0.04)', border: '1px solid rgba(10,92,70,0.15)', borderRadius: 6, padding: '8px 12px' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>
            Deployment Notes
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink)', margin: 0, whiteSpace: 'pre-wrap' }}>
            {selected.deploymentNotes}
          </p>
        </div>
      ) : null}
    </div>
  )
}

// ─── Deploy to Production Panel ────────────────────────────────────────────────

interface ProdDeployPanelProps {
  selected:          AdminReq
  onSentApproval:    (goLiveDoc: string, sentAt: string) => void
  onDeployed:        (snapshotId: string, deployedAt: string) => void
  onManualDeployed:  (deployedAt: string) => void
}

function DeployToProductionPanel({ selected, onSentApproval, onDeployed, onManualDeployed }: ProdDeployPanelProps) {
  const [sendingDoc,    setSendingDoc]    = useState(false)
  const [sendErr,       setSendErr]       = useState<string|null>(null)
  const [deploying,     setDeploying]     = useState(false)
  const [deployResults, setDeployResults] = useState<any[]|null>(null)
  const [deployErr,     setDeployErr]     = useState<string|null>(null)
  const [confirmDeploy, setConfirmDeploy] = useState(false)
  const [manualMode,    setManualMode]    = useState(false)
  const [manualLoading, setManualLoading] = useState(false)
  const [manualErr,     setManualErr]     = useState<string|null>(null)

  async function handleManualDeployProd() {
    if (!confirm('Confirm manual deployment to production? This will be recorded as a manual deployment note and the customer will be notified.')) return
    setManualLoading(true); setManualErr(null)
    try {
      const res = await fetch('/api/requirements/' + selected.id + '/manual-deploy-prod', { method: 'POST' })
      if (!res.ok) { const e = await res.json(); setManualErr(e.error ?? 'Failed'); return }
      const d = await res.json()
      setManualMode(false)
      onManualDeployed(d.deployedAt)
    } catch (e: any) {
      setManualErr(e.message ?? 'Network error')
    } finally {
      setManualLoading(false)
    }
  }


  const base: { [k: string]: any } = {
    fontFamily: 'var(--font-body)', fontSize: 12, padding: '7px 14px',
    borderRadius: 6, cursor: 'pointer', border: '1px solid var(--fog)',
    background: 'var(--white)', color: 'var(--ink)',
  }

  const uatDate     = selected.uatApprovedAt       ? new Date(selected.uatApprovedAt).toLocaleDateString('en-NZ')       : ''
  const sentDate    = selected.prodApprovalSentAt   ? new Date(selected.prodApprovalSentAt).toLocaleDateString('en-NZ')  : ''
  const approveDate = selected.prodApprovedAt       ? new Date(selected.prodApprovedAt).toLocaleDateString('en-NZ')      : ''
  const deployDate  = selected.prodDeployedAt       ? new Date(selected.prodDeployedAt).toLocaleDateString('en-NZ')      : ''

  async function handleSendApproval() {
    setSendingDoc(true); setSendErr(null)
    try {
      const res = await fetch('/api/requirements/' + selected.id + '/prod-approval', { method: 'POST' })
      if (!res.ok) { const e = await res.json(); setSendErr(e.error ?? 'Failed'); return }
      const d = await res.json()
      onSentApproval(d.goLiveDoc, d.sentAt)
    } catch (e: any) {
      setSendErr(e.message ?? 'Network error')
    } finally {
      setSendingDoc(false)
    }
  }

  async function handleDeploy() {
    if (!selected.testDeploySnapshotId) { setDeployErr('No test snapshot ID — deploy to test first'); return }
    setDeploying(true); setDeployErr(null); setConfirmDeploy(false)
    try {
      const res = await fetch('/api/requirements/' + selected.id + '/objects/deploy-prod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: selected.testDeploySnapshotId }),
      })
      const d = await res.json()
      if (!res.ok) { setDeployErr(d.error ?? 'Failed'); return }
      setDeployResults(d.results ?? [])
      if (d.success) onDeployed(d.snapshotId, d.deployedAt)
    } catch (e: any) {
      setDeployErr(e.message ?? 'Network error')
    } finally {
      setDeploying(false)
    }
  }

  return (
    <div style={{ background: 'var(--white)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 8, padding: '12px 14px', marginTop: 12 }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9A6A00', marginBottom: 10 }}>
        Production Deployment
      </p>

      {selected.prodDeployedAt ? (
        <div style={{ background: 'rgba(10,92,70,0.06)', border: '1px solid rgba(10,92,70,0.25)', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#0A5C46', margin: 0 }}>
            {'Deployed to production \u2014 ' + deployDate + ' (snapshot: ' + (selected.prodDeploySnapshotId ?? '') + ')'}
          </p>
        </div>
      ) : null}

      {(selected.uatApprovedAt && !selected.prodDeployedAt) ? (
        <div style={{ background: 'rgba(10,92,70,0.04)', border: '1px solid rgba(10,92,70,0.15)', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#0A5C46', margin: 0 }}>
            {'UAT approved ' + uatDate + ' \u2014 ready for go-live'}
          </p>
        </div>
      ) : null}

      {!selected.prodDeployedAt ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', minWidth: 60 }}>Step 1</span>
            <button
              onClick={handleSendApproval}
              disabled={sendingDoc}
              style={{ ...base, background: selected.prodApprovalSentAt ? 'var(--fog)' : '#C8952A', color: selected.prodApprovalSentAt ? 'var(--slate)' : '#fff', border: 'none' }}
            >
              {sendingDoc ? 'Generating\u2026' : selected.prodApprovalSentAt ? ('Go-live doc sent ' + sentDate + ' \u2014 resend') : 'Generate & Send Go-Live Doc'}
            </button>
          </div>
          {sendErr ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#A32D2D', margin: '0 0 8px 68px' }}>{sendErr}</p> : null}

          {selected.prodApprovalSentAt ? (
            <div style={{ marginLeft: 68, marginBottom: 10 }}>
              {selected.prodApprovedAt ? (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#0A5C46', margin: 0 }}>
                  {'\u2713 Customer approved ' + approveDate}
                </p>
              ) : (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#9A6A00', margin: 0 }}>
                  Awaiting customer approval…
                </p>
              )}
            </div>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', minWidth: 60 }}>Step 2</span>
            {manualMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', margin: 0 }}>
                  BCAgent will be skipped. The deployment will be recorded as a manual deployment note and the customer will be notified.
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleManualDeployProd}
                    disabled={manualLoading || !selected.prodApprovedAt}
                    style={{ ...base, background: selected.prodApprovedAt ? '#0A5C46' : 'var(--fog)', color: selected.prodApprovedAt ? '#fff' : 'var(--slate)', border: 'none' }}
                  >
                    {manualLoading ? 'Confirming\u2026' : 'Confirm Manual Deployment'}
                  </button>
                  <button onClick={() => { setManualMode(false); setManualErr(null) }} style={{ ...base }}>Cancel</button>
                </div>
                {manualErr ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#A32D2D', margin: 0 }}>{manualErr}</p> : null}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                {confirmDeploy ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={handleDeploy}
                      disabled={deploying}
                      style={{ ...base, background: '#A32D2D', color: '#fff', border: 'none', fontWeight: 600 }}
                    >
                      {deploying ? 'Deploying\u2026' : '\u26a0 DEPLOY TO PRODUCTION'}
                    </button>
                    <button onClick={() => setConfirmDeploy(false)} style={{ ...base }}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      onClick={() => setConfirmDeploy(true)}
                      disabled={!selected.prodApprovedAt || deploying}
                      style={{ ...base, background: selected.prodApprovedAt ? '#0A5C46' : 'var(--fog)', color: selected.prodApprovedAt ? '#fff' : 'var(--slate)', border: 'none' }}
                    >
                      Deploy to Production
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        id={'manual-prod-' + selected.id}
                        checked={manualMode}
                        onChange={e => { setManualMode(e.target.checked); setManualErr(null) }}
                        style={{ cursor: 'pointer' }}
                      />
                      <label htmlFor={'manual-prod-' + selected.id} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', cursor: 'pointer' }}>
                        Mark as manually deployed
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {!selected.prodApprovedAt && !manualMode ? (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', margin: '4px 0 0 68px' }}>
              Waiting for customer to approve go-live doc
            </p>
          ) : null}
          {deployErr ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#A32D2D', margin: '8px 0 0' }}>{deployErr}</p> : null}

          {deployResults ? (
            <div style={{ marginTop: 10, border: '1px solid var(--fog)', borderRadius: 6, overflow: 'hidden' }}>
              {deployResults.map((r: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderBottom: i < deployResults.length - 1 ? '1px solid var(--fog)' : 'none', background: r.error ? 'rgba(163,45,45,0.04)' : 'var(--white)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: r.error ? '#A32D2D' : '#0A5C46', minWidth: 12 }}>{r.error ? '\u2715' : '\u2713'}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.filename}</span>
                  {r.error ? <span style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: '#A32D2D' }}>{r.error}</span> : null}
                </div>
              ))}
            </div>
          ) : null}

          {selected.deploymentNotes ? (
            <div style={{ marginTop: 10, background: 'rgba(10,92,70,0.04)', border: '1px solid rgba(10,92,70,0.15)', borderRadius: 6, padding: '8px 12px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>
                Deployment Notes
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink)', margin: 0, whiteSpace: 'pre-wrap' }}>
                {selected.deploymentNotes}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

// ─── Admin Requirements Tab ────────────────────────────────────────────────────

function AdminRequirementsTab({ autoSelectReqId, onAutoSelectDone }: { autoSelectReqId?: string|null; onAutoSelectDone?: () => void }) {
  const { data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const adminName  = (session?.user as any)?.name  ?? 'Admin'
  const adminEmail = (session?.user as any)?.email ?? ''
  const [reqs, setReqs]           = useState<AdminReq[]>([])
  const [collapsedAdminCards, setCollapsedAdmin] = useState<Record<string,boolean>>({})
  function toggleAdminCard(id: string) { setCollapsedAdmin(prev => ({ ...prev, [id]: !prev[id] })) }
  function adminCardToggle(id: string) {
    const col = !!collapsedAdminCards[id]
    return (
      <button
        onClick={() => toggleAdminCard(id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--slate)', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center' }}
        title={col ? 'Expand' : 'Collapse'}
      >
        {col ? '▾' : '▴'}
      </button>
    )
  }
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [selected, setSelected]   = useState<AdminReq | null>(null)
  const [filterStatus, setFilter] = useState('all')
  const [actionLoading, setAL]    = useState(false)
  const [quoteAmt, setQuoteAmt]   = useState('')
  const [quoteNote, setQuoteNote] = useState('')
  const [showQF, setShowQF]       = useState(false)

  // AI dev-notes panel — conversation history + streaming
  const [showAiPanel, setShowAiPanel]     = useState(false)
  const [devQuestion, setDevQuestion]     = useState('')
  const [devHistory, setDevHistory]       = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [devStreaming, setDevStreaming]    = useState(false)
  const [devDocName, setDevDocName]       = useState('')
  const [devDocContent, setDevDocContent] = useState('')
  const [showSB, setShowSB]       = useState(false)
  const [sendBackText, setSBT]    = useState('')
  const [genSpec, setGenSpec]     = useState(false)
  const [specErr, setSpecErr]     = useState('')
  const [genPlan, setGenPlan]     = useState(false)
  const [planErr, setPlanErr]     = useState('')
  const [devPlanData, setDevPlanData] = useState<Record<string, any> | null>(null)
  const [showObjectEditor, setShowObjectEditor] = useState(false)
  const [editableObjects, setEditableObjects]   = useState<string[]>([])
  const [newObjectText, setNewObjectText]       = useState('')
  // BC Objects fetch panel
  const [fetchingObjs, setFetchingObjs]         = useState(false)
  const [fetchObjErr, setFetchObjErr]           = useState('')
  const [splitObjects, setSplitObjects]         = useState<any[]>([])   // client-side split results
  const [savingObjs, setSavingObjs]             = useState(false)
  const [savedObjCount, setSavedObjCount]       = useState(0)
  // Deployment workflow
  const [syncLoading, setSyncLoading]           = useState(false)
  const [syncResult, setSyncResult]             = useState('')
  const [syncErr, setSyncErr]                   = useState('')
  const [writeLoading, setWriteLoading]         = useState(false)
  const [writeSnapshotId, setWriteSnapshotId]   = useState<string|null>(null)
  const [writeErr, setWriteErr]                 = useState('')
  const [deployLoading, setDeployLoading]       = useState(false)
  const [deployResults, setDeployResults]       = useState<any[]|null>(null)
  const [deployDebug, setDeployDebug]           = useState(false)
  const [deployErr, setDeployErr]               = useState('')
  const [developers, setDevelopers]             = useState<{id:string;name:string|null;email:string}[]>([])

  // ── Coding Assistant state ──────────────────────────────────────────────────
  const [showCodingPanel, setShowCodingPanel]   = useState(false)
  const [codingHistory, setCodingHistory]       = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [codingMessage, setCodingMessage]       = useState('')
  const [codingStreaming, setCodingStreaming]    = useState(false)
  const [codingCommitting, setCodingCommitting] = useState<number|null>(null)   // index of msg being committed
  const [codingCommitErr, setCodingCommitErr]   = useState('')

  // Navigate to a requirement — updates URL so back button works
  function selectReq(req: AdminReq | null) {
    setSelected(req)
    // Pre-populate writeSnapshotId so Step 2 is available without re-writing
    setWriteSnapshotId(req?.testDeploySnapshotId ?? null)
    setSyncResult('')
    setSyncErr('')
    setWriteErr('')
    setDeployResults(null)
    setDeployErr('')
    const url = req ? '/admin?tab=requirements&req=' + req.id : '/admin?tab=requirements'
    router.push(url, { scroll: false })
  }

  async function load() {
    setLoading(true)
    try {
      const [reqRes, usersRes] = await Promise.all([
        fetch('/api/admin/requirements'),
        fetch('/api/admin/users'),
      ])
      const data = await reqRes.json()
      if (!reqRes.ok) throw new Error(data.error)
      // Merge addenda into flat list so they appear in requirements tab and get action buttons
      const addenda = (data.allAddenda ?? []).map((a: any) => ({ ...a, addenda: [], assignedDeveloper: null, devPlan: null, testDeployedAt: null, testDeploySnapshotId: null, uatApprovedAt: null, uatApprovedById: null, uatRejectedAt: null, uatRejectionReason: null, uatRejectionAnalysis: null, githubBranch: null, prodApprovalSentAt: null, prodGoLiveDoc: null, prodApprovedAt: null, prodApprovedById: null, prodDeployedAt: null, prodDeploySnapshotId: null, deploymentNotes: null, submittedAt: null, inReviewAt: null, quotedAt: null, depositRequiredAt: null, inDevelopmentAt: null, completePendingPaymentAt: null }))
      setReqs([...data.requirements, ...addenda])
      if (usersRes.ok) {
        const ud = await usersRes.json()
        setDevelopers((ud.users ?? []).filter((u: any) => u.role === 'developer'))
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  useState(() => { load() })

  // Auto-select a requirement when navigated from overview attention card
  useEffect(() => {
    if (autoSelectReqId && reqs.length > 0) {
      const target = reqs.find(r => r.id === autoSelectReqId)
      if (target) { selectReq(target); onAutoSelectDone?.() }
    }
  }, [autoSelectReqId, reqs])

  // Sync selected requirement from URL (handles back/forward navigation)
  useEffect(() => {
    const reqId = searchParams.get('req')
    if (!reqId) { setSelected(null); return }
    if (reqs.length > 0) {
      const target = reqs.find(r => r.id === reqId)
      if (target) {
        setSelected(target)
        setWriteSnapshotId(prev => prev ?? target.testDeploySnapshotId ?? null)
      }
    }
  }, [searchParams, reqs])

  async function patch(id: string, body: object) {
    setAL(true)
    const res  = await fetch(`/api/requirements/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error); setAL(false); return }
    const updated = data.requirement
    setReqs(prev => prev.map(r => r.id === id ? updated : r))
    setSelected(updated)
    setAL(false)
    setShowQF(false); setShowSB(false)
    // Refresh editableObjects from updated spec
    try {
      const s = updated.aiSpec ? JSON.parse(updated.aiSpec) : null
      setEditableObjects(s?.bcObjects ?? [])
    } catch { /* keep existing */ }
    // Parse saved dev plan if available
    try { setDevPlanData(updated.devPlan ? JSON.parse(updated.devPlan) : null) } catch { setDevPlanData(null) }
    return updated
  }

  async function generateSpec(id: string) {
    setGenSpec(true); setSpecErr('')
    const res  = await fetch(`/api/requirements/${id}/ai-spec`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) { setSpecErr(data.error); setGenSpec(false); return }
    const updated = data.requirement
    setReqs(prev => prev.map(r => r.id === id ? updated : r))
    setSelected(updated)
    setGenSpec(false)
  }

  async function generateDevPlan(id: string) {
    setGenPlan(true); setPlanErr('')
    try {
      const res  = await fetch(`/api/requirements/${id}/dev-plan`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDevPlanData(data.devPlan)
      // Update the stored devPlan in reqs list
      setReqs(prev => prev.map(r => r.id === id ? { ...r, devPlan: JSON.stringify(data.devPlan) } : r))
      setSelected(prev => prev ? { ...prev, devPlan: JSON.stringify(data.devPlan) } : prev)
    } catch(e: any) { setPlanErr(e.message ?? 'Generation failed') }
    finally { setGenPlan(false) }
  }

  // BC Objects fetch + client-side split ──────────────────────────────────
  async function fetchNavObjects() {
    if (!selected || fetchingObjs) return
    setFetchingObjs(true)
    setFetchObjErr('')
    setSplitObjects([])
    setSavedObjCount(0)

    // Parse spec bcObjects → [{type, id}] filter list
    let spec: any = {}
    try { if (selected.aiSpec) spec = JSON.parse(selected.aiSpec) } catch {}
    const bcObjs: string[] = spec.bcObjects ?? []

    const objects: Array<{type: string; id: number}> = []
    for (const o of bcObjs) {
      const m = o.match(/^(Table|Page|Codeunit|Report|XMLport|Query|MenuSuite|Dataport)\s+(\d+)/i)
      if (m) objects.push({ type: m[1], id: parseInt(m[2]) })
    }

    if (!objects.length) {
      setFetchObjErr('No parseable objects in spec (need "Codeunit 80 ..." format). Add objects via the editor above first.')
      setFetchingObjs(false)
      return
    }

    try {
      const res = await fetch(`/api/requirements/${selected.id}/fetch-objects`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ objects }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error ?? `Agent returned ${res.status}`)
      }

      const isDebug = res.headers.get('X-Debug-Mode') === 'true'

      // Client-side unzip + C/AL split
      const blob = await res.blob()
      const JSZip = (window as any).JSZip
      if (!JSZip) throw new Error('JSZip not loaded — refresh and try again')
      const zip = await JSZip.loadAsync(blob)
      const txtFiles = Object.keys(zip.files).filter((n: string) => n.endsWith('.txt'))
      if (!txtFiles.length) throw new Error('No .txt in zip response')
      const txt: string = await zip.files[txtFiles[0]].async('string')

      // Split on OBJECT boundary (relaxed — matches anywhere on line)
      const HDR = /OBJECT\s+(Table|Page|Codeunit|Report|XMLport|Query|MenuSuite|Dataport)\s+(\d+)\s+(.+)/i
      const VL  = /Version List=([^;]*);/
      const lines = txt.split('\n')
      const parsed: any[] = []
      let cur: any = null, buf: string[] = []

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '')
        const m = line.match(HDR)
        if (m) {
          if (cur) { cur.content = buf.join('\n'); cur.sizeBytes = new TextEncoder().encode(cur.content).length; parsed.push(cur) }
          cur = { objectType: m[1], objectId: parseInt(m[2]), objectName: m[3].trim().replace(/\r/g,''), versionList: null, content: '', sizeBytes: 0, selected: true, language: 'CAL', _debug: isDebug }
          buf = [line]
        } else if (cur) {
          buf.push(line)
          if (!cur.versionList) { const v = line.match(VL); if (v) cur.versionList = v[1].trim() }
        }
      }
      if (cur && buf.length) { cur.content = buf.join('\n'); cur.sizeBytes = new TextEncoder().encode(cur.content).length; parsed.push(cur) }

      if (!parsed.length) throw new Error('Zip received but no OBJECT headers found — check NAV database config and object IDs')
      setSplitObjects(parsed)
    } catch(e: any) {
      setFetchObjErr(e.message ?? 'Fetch failed')
    } finally {
      setFetchingObjs(false)
    }
  }

  async function saveSelectedObjects() {
    if (!selected || savingObjs) return
    const toSave = splitObjects.filter(o => o.selected)
    if (!toSave.length) return
    setSavingObjs(true)
    try {
      const res = await fetch(`/api/requirements/${selected.id}/objects`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ objects: toSave }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error) }
      const data = await res.json()
      setSavedObjCount(data.upserted)
      setSplitObjects([])
    } catch(e: any) {
      setFetchObjErr(e.message)
    } finally {
      setSavingObjs(false)
    }
  }

  async function syncFromGitHub() {
    if (!selected || syncLoading) return
    setSyncLoading(true)
    setSyncResult('')
    setSyncErr('')
    try {
      const res = await fetch('/api/requirements/' + selected.id + '/objects/sync-from-github', { method: 'POST' })
      let data: any
      try { data = await res.json() } catch { throw new Error('Sync API returned invalid response') }
      if (!res.ok) throw new Error(data.error ?? 'Sync failed (' + res.status + ')')
      setSyncResult('Synced ' + data.synced + ' file' + (data.synced !== 1 ? 's' : '') + ' from ' + data.branch)
    } catch(e: any) {
      setSyncErr(e.message)
    } finally {
      setSyncLoading(false)
    }
  }

  async function writeObjectsToServer() {
    if (!selected || writeLoading) return
    setWriteLoading(true)
    setWriteErr('')
    setWriteSnapshotId(null)
    setDeployResults(null)
    setDeployDebug(false)
    try {
      // Load object file IDs for this requirement that have content
      const filesRes = await fetch('/api/requirements/' + selected.id + '/objects')
      let filesData: any
      try { filesData = await filesRes.json() } catch { throw new Error('Objects API returned invalid response — check test DB name is set in Settings') }
      if (!filesRes.ok) throw new Error(filesData.error ?? 'Could not load object files (' + filesRes.status + ')')
      const fileIds = (filesData.objects ?? []).filter((f: any) => f.hasContent).map((f: any) => f.id)
      if (!fileIds.length) throw new Error('No object files with content found. Sync from GitHub or fetch from BCAgent first.')

      const res = await fetch('/api/requirements/' + selected.id + '/objects/write', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fileIds }),
      })
      let data: any
      try { data = await res.json() } catch { throw new Error('Write API returned invalid response') }
      if (!res.ok) throw new Error(data.error ?? 'Write failed (' + res.status + ')')
      setWriteSnapshotId(data.snapshotId)
    } catch(e: any) {
      setWriteErr(e.message)
    } finally {
      setWriteLoading(false)
    }
  }

  async function deployToTest() {
    if (!selected || !writeSnapshotId || deployLoading) return
    setDeployLoading(true)
    setDeployErr('')
    setDeployResults(null)
    try {
      const res = await fetch('/api/requirements/' + selected.id + '/objects/deploy-test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ snapshotId: writeSnapshotId }),
      })
      let data: any
      try { data = await res.json() } catch { throw new Error('Deploy API returned invalid response — the operation may have timed out (60s limit). Check BCAgent logs.') }
      if (!res.ok) throw new Error(data.error ?? 'Deploy failed (' + res.status + ')')
      setDeployResults(data.results ?? [])
      setDeployDebug(!!data._debug)
      if (data.success) {
        // Refresh requirement to show testDeployedAt
        const reqRes = await fetch('/api/admin/requirements')
        if (reqRes.ok) { const d = await reqRes.json(); const add2 = (d.allAddenda ?? []).map((a: any) => ({ ...a, addenda: [], assignedDeveloper: null, devPlan: null, testDeployedAt: null, testDeploySnapshotId: null, uatApprovedAt: null, uatApprovedById: null, uatRejectedAt: null, uatRejectionReason: null, uatRejectionAnalysis: null, githubBranch: null, prodApprovalSentAt: null, prodGoLiveDoc: null, prodApprovedAt: null, prodApprovedById: null, prodDeployedAt: null, prodDeploySnapshotId: null, deploymentNotes: null, submittedAt: null, inReviewAt: null, quotedAt: null, depositRequiredAt: null, inDevelopmentAt: null, completePendingPaymentAt: null })); setReqs([...d.requirements, ...add2]) }
      } else {
        setDeployErr('Some objects failed — check results below')
      }
    } catch(e: any) {
      setDeployErr(e.message)
    } finally {
      setDeployLoading(false)
    }
  }

  // ── AI Dev Assistant — streaming fetch with conversation history ─────────
  async function askDevAssistant() {
    if (!selected || !devQuestion.trim() || devStreaming) return
    const question = devQuestion.trim()
    setDevQuestion('')
    setDevStreaming(true)

    // Snapshot history to send (excludes the in-progress assistant message)
    const historyToSend = devHistory.map(h => ({ role: h.role, content: h.content }))

    // Append user turn + empty assistant placeholder immediately
    setDevHistory(prev => [
      ...prev,
      { role: 'user', content: question },
      { role: 'assistant', content: '' },
    ])

    try {
      const res = await fetch(`/api/requirements/${selected.id}/dev-notes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question, history: historyToSend, docContent: devDocContent || undefined }),
      })

      if (!res.ok) {
        let errMsg = 'Request failed'
        try {
          const errData = await res.json()
          errMsg = errData.error ?? errMsg
        } catch {
          try { errMsg = await res.text() } catch {}
        }
        setDevHistory(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: `Error: ${errMsg}` }
          return updated
        })
        return
      }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let   answer  = ''
      let   buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep incomplete last line
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue
          try {
            const data = JSON.parse(raw)
            // Anthropic: content_block_delta / text_delta
            if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
              answer += data.delta.text ?? ''
              setDevHistory(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: answer }
                return updated
              })
            }
          } catch { /* malformed chunk — skip */ }
        }
      }
    } catch {
      setDevHistory(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Error contacting AI — please try again.' }
        return updated
      })
    } finally {
      setDevStreaming(false)
    }
  }

  // ── Coding Assistant — streaming + commit ─────────────────────────────────
  async function askCodingAssistant() {
    if (!selected || !codingMessage.trim() || codingStreaming) return
    const msg = codingMessage.trim()
    setCodingMessage('')
    setCodingStreaming(true)

    const historyToSend = codingHistory.map(h => ({ role: h.role, content: h.content }))
    // Optimistically add the user message + empty assistant placeholder
    setCodingHistory(prev => [...prev, { role: 'user', content: msg }, { role: 'assistant', content: '' }])

    try {
      const res = await fetch(`/api/requirements/${selected.id}/coding-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: msg, history: historyToSend }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as any).error ?? 'Request failed')
      }
      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf    = ''
      let answer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
              answer += data.delta.text ?? ''
              setCodingHistory(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: answer }
                return updated
              })
            }
          } catch { /* skip */ }
        }
      }
    } catch (e: any) {
      setCodingHistory(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: `Error: ${e.message ?? 'Could not reach AI'}` }
        return updated
      })
    } finally {
      setCodingStreaming(false)
    }
  }

  async function commitCalObject(msgIndex: number, filename: string, content: string) {
    if (!selected) return
    setCodingCommitting(msgIndex)
    setCodingCommitErr('')
    try {
      const res = await fetch(`/api/requirements/${selected.id}/coding-assistant/commit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filename, content }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Commit failed')
    } catch (e: any) {
      setCodingCommitErr(e.message ?? 'Commit failed')
    } finally {
      setCodingCommitting(null)
    }
  }

  // Extract C/AL object blocks from an AI response message.
  // Returns array of { filename, content } for each OBJECT block found.
  function extractCalObjects(text: string): { filename: string; content: string }[] {
    const results: { filename: string; content: string }[] = []
    // Match fenced code blocks that contain C/AL OBJECT declarations
    const fenceRe = /```(?:cal|txt|nav|c\/al)?\n(OBJECT [^\n]+[\s\S]*?)```/gi
    let m
    while ((m = fenceRe.exec(text)) !== null) {
      const block = m[1].trim()
      const header = block.split('\n')[0] // e.g. "OBJECT Codeunit 80 Sales-Post"
      const parts  = header.match(/^OBJECT\s+(\w+)\s+(\d+)\s+(.+)$/)
      if (parts) {
        const objType = parts[1]
        const objId   = parts[2]
        const objName = parts[3].trim().replace(/[^a-zA-Z0-9_\-. ]/g, '_')
        results.push({ filename: `${objType}_${objId}_${objName}.txt`, content: block })
      } else {
        results.push({ filename: 'object.txt', content: block })
      }
    }
    return results
  }

  const filtered = filterStatus === 'all' ? reqs : reqs.filter(r => r.status === filterStatus)

  const statusCounts = reqs.reduce((acc: Record<string, number>, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1; return acc
  }, {})

  const parsedSpec = (r: AdminReq) => { try { return r.aiSpec ? JSON.parse(r.aiSpec) : null } catch { return null } }

  if (loading) return <p style={{ color: 'var(--slate)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading…</p>
  if (error)   return <p style={{ color: '#A32D2D' }}>{error}</p>

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* List — hidden when a requirement is selected */}
      <div style={{ flex: selected ? '0 0 0px' : '0 0 480px', overflow: 'hidden', display: selected ? 'none' : 'flex', flexDirection: 'column', gap: 12, transition: 'flex 0.2s' }}>
        {/* Stats */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          {['submitted','in_review','quoted','approved','in_development','in_uat'].map(s => {
            const c = STATUS_COLOR_ADMIN[s]
            return statusCounts[s] ? (
              <span key={s} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '3px 10px', borderRadius: 20, background: c.bg, border: `1px solid ${c.border}`, color: c.text, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {statusCounts[s]} {s.replace(/_/g, ' ')}
              </span>
            ) : null
          })}
        </div>

        {/* Filter */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={filterStatus} onChange={e => setFilter(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
            <option value="all">All statuses ({reqs.length})</option>
            {STATUS_PIPELINE_ADMIN.map(s => statusCounts[s] ? (
              <option key={s} value={s}>{s.replace(/_/g, ' ')} ({statusCounts[s]})</option>
            ) : null)}
          </select>
          <button onClick={load} style={{ background: 'transparent', border: '1px solid var(--fog)', borderRadius: 6, padding: '6px 12px', fontSize: 11, color: 'var(--slate)', cursor: 'pointer' }}>↻</button>
        </div>

        {/* Rows */}
        {filtered.length === 0 && <p style={{ color: 'var(--slate)', fontSize: 13 }}>No requests found.</p>}
        {filtered.map(req => {
          const sc   = STATUS_COLOR_ADMIN[req.status] ?? STATUS_COLOR_ADMIN.draft
          const isAct = selected?.id === req.id
          return (
            <div
              key={req.id}
              onClick={() => {
                selectReq(req)
                setShowQF(false); setShowSB(false); setPlanErr('')
                setShowObjectEditor(false); setNewObjectText('')
                // Reset AI conversation when switching requirements
                setDevHistory([]); setDevQuestion(''); setShowAiPanel(false)
                try { setDevPlanData(req.devPlan ? JSON.parse(req.devPlan) : null) } catch { setDevPlanData(null) }
                try {
                  const s = req.aiSpec ? JSON.parse(req.aiSpec) : null
                  setEditableObjects(s?.bcObjects ?? [])
                } catch { setEditableObjects([]) }
              }}
              style={{ background: isAct ? 'rgba(10,92,70,0.04)' : 'var(--white)', border: `1px solid ${isAct ? 'rgba(10,92,70,0.2)' : 'var(--fog)'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {req.parentId ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 7, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9A6A00', background: 'rgba(200,149,42,0.1)', border: '1px solid rgba(200,149,42,0.2)', borderRadius: 4, padding: '1px 6px', marginBottom: 4, display: 'inline-block' }}>Addendum</span> : null}
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0, lineHeight: 1.3 }}>{req.title}</p>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, padding: '2px 8px', borderRadius: 6, background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>
                  {req.status.replace(/_/g, ' ')}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--jade)' }}>{req.tenant.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)' }}>{req.bcArea}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: PRIORITY_COLOR[req.priority] ?? 'var(--slate)' }}>{PRIORITY_LABEL[req.priority] ?? req.priority}</span>
                {req.aiSpec && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--jade)' }}>✦ spec</span>}
                {req.quote && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--forest)', marginLeft: 'auto', fontWeight: 600 }}>${parseFloat(req.quote).toLocaleString()}</span>}
              </div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--fog)', marginTop: 6 }}>
                {req.user.name ?? req.user.email} · {new Date(req.createdAt).toLocaleDateString('en-NZ')}
              </p>
            </div>
          )
        })}
      </div>

      {/* Detail */}
      {selected && (() => {
        const spec = parsedSpec(selected)
        // Parse Q&A pairs if stored as JSON
        let savedQA: {q:string;a:string}[] = []
        let savedText = ''
        try {
          const parsed = selected.customerAnswers ? JSON.parse(selected.customerAnswers) : null
          if (Array.isArray(parsed) && parsed[0]?.q !== undefined) savedQA = parsed
          else if (selected.customerAnswers) savedText = selected.customerAnswers
        } catch { savedText = selected.customerAnswers ?? '' }

        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* Back to list */}
            <button
              onClick={() => { selectReq(null); setShowQF(false); setShowSB(false); setShowAiPanel(false); setDevHistory([]); setDevQuestion('') }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', marginBottom: 14, padding: 0, width: 'fit-content' }}
            >
              ← Back to list
            </button>
          <div style={{ flex: 1, background: 'var(--cream)', borderRadius: 12, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                {selected.parentId ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'rgba(200,149,42,0.1)', color: '#9A6A00', border: '1px solid rgba(200,149,42,0.25)', borderRadius: 5, padding: '2px 8px' }}>Addendum</span>
                    <button
                      onClick={() => { const parent = reqs.find(r => r.id === selected.parentId); if (parent) selectReq(parent) }}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >← Back to parent requirement</button>
                  </div>
                ) : null}
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 500, color: 'var(--ink)', margin: 0, lineHeight: 1.3 }}>{selected.title}</h3>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(() => { const sc = STATUS_COLOR_ADMIN[selected.status] ?? STATUS_COLOR_ADMIN.draft; return (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, padding: '2px 8px', borderRadius: 6, background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {selected.status.replace(/_/g, ' ')}
                    </span>
                  )})()}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--jade)' }}>{selected.tenant.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)' }}>·</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)' }}>{selected.user.name ?? selected.user.email}</span>
                  {selected.assignedDeveloper ? (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#3B52A3' }}>· Dev: {selected.assignedDeveloper.name ?? selected.assignedDeveloper.email}</span>
                  ) : null}
                </div>
              </div>
              {/* Assign developer — superadmin only */}
              <select
                style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--fog)', background: 'var(--white)', color: 'var(--slate)', cursor: 'pointer' }}
                value={selected.assignedDeveloper?.id ?? ''}
                onChange={async e => {
                  const devId = e.target.value || null
                  const res = await fetch(`/api/requirements/${selected.id}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ assignedDeveloperId: devId }),
                  })
                  if (res.ok) {
                    const dev = devId ? developers.find(u => u.id === devId) : null
                    setSelected((s: any) => s ? { ...s, assignedDeveloper: dev ? { id: dev.id, name: dev.name, email: dev.email } : null } : s)
                    setReqs(prev => prev.map(r => r.id === selected.id ? { ...r, assignedDeveloper: dev ? { id: dev.id, name: dev.name, email: dev.email } : null } : r))
                  }
                }}
              >
                <option value="">Assign developer…</option>
                {developers.map(u => (
                  <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
                ))}
              </select>
            </div>

            {/* Pipeline progress with dates */}
            {(() => {
              const PIPE = ['draft','submitted','in_review','quoted','deposit_required','deposit_paid','in_development','in_uat','uat_confirmed','complete_pending_payment','fully_paid']
              const PIPE_LABELS: Record<string,string> = {
                draft:'Draft', submitted:'Submitted', in_review:'In Review', quoted:'Quoted',
                deposit_required:'Deposit Req.', deposit_paid:'Deposit Paid', in_development:'In Dev',
                in_uat:'In UAT', uat_confirmed:'UAT Confirmed', complete_pending_payment:'Balance Due', fully_paid:'Complete'
              }
              const pipeDateMap: Record<string,string|null|undefined> = {
                draft:                    selected.createdAt,
                submitted:                selected.submittedAt,
                in_review:                selected.inReviewAt,
                quoted:                   selected.quotedAt,
                deposit_required:         selected.depositRequiredAt,
                deposit_paid:             selected.depositPaidAt,
                in_development:           selected.inDevelopmentAt,
                in_uat:                   selected.testDeployedAt,
                uat_confirmed:            selected.uatApprovedAt,
                complete_pending_payment: selected.completePendingPaymentAt,
                fully_paid:               selected.balancePaidAt,
              }
              const si = PIPE.findIndex(s => s === selected.status)
              return (
                <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 8, padding: '12px 14px', overflowX: 'auto' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 10 }}>Pipeline</p>
                  <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 'max-content' }}>
                    {PIPE.map((s, i) => {
                      const done = i < si, cur = i === si
                      const dateStr = pipeDateMap[s]
                      const fmt = dateStr ? new Date(dateStr).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short' }) : null
                      return (
                        <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < PIPE.length - 1 ? 1 : 'none' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                            <div style={{ width: 14, height: 14, borderRadius: '50%', background: done ? 'var(--jade)' : cur ? 'var(--forest)' : 'var(--fog)', boxShadow: cur ? '0 0 0 3px rgba(10,92,70,0.15)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {done ? <span style={{ color: 'white', fontSize: 7 }}>✓</span> : null}
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 6, letterSpacing: '0.07em', textTransform: 'uppercase', color: cur ? 'var(--forest)' : done ? 'var(--jade)' : 'var(--slate)', textAlign: 'center', whiteSpace: 'nowrap' }}>{PIPE_LABELS[s] ?? s}</span>
                            {fmt ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 6, color: done ? 'var(--jade)' : cur ? 'var(--forest)' : 'var(--slate)', textAlign: 'center', whiteSpace: 'nowrap' }}>{fmt}</span> : <span style={{ fontSize: 6 }}>&nbsp;</span>}
                          </div>
                          {i < PIPE.length - 1 ? <div style={{ flex: 1, height: 2, background: done ? 'var(--jade)' : 'var(--fog)', margin: '0 2px', marginBottom: 26, minWidth: 8 }} /> : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Quote rejection banner */}
            {selected.status === 'quote_rejected' && selected.quoteRejectionReason && (
              <div style={{ background: 'rgba(163,45,45,0.05)', border: '1px solid rgba(163,45,45,0.25)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 14 }}>❌</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A32D2D', fontWeight: 600 }}>Customer rejected quote</span>
                  {selected.quoteRejectedAt && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)', marginLeft: 'auto' }}>{new Date(selected.quoteRejectedAt).toLocaleDateString('en-NZ')}</span>}
                </div>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink)', lineHeight: 1.65, fontStyle: 'italic' }}>"{selected.quoteRejectionReason}"</p>
              </div>
            )}

            {/* Needs clarification — show what was asked */}
            {selected.status === 'needs_clarification' && selected.adminQuestions && (
              <div style={{ background: 'rgba(200,149,42,0.06)', border: '1px solid rgba(200,149,42,0.25)', borderRadius: 8, padding: '12px 14px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9A6A00', marginBottom: 8 }}>Questions sent to customer</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{selected.adminQuestions}</p>
              </div>
            )}

            {/* Q&A history — admin questions + customer answers by round */}
            {selected.adminQALog && (() => {
              let log: any[] = []
              try { log = JSON.parse(selected.adminQALog) } catch { return null }
              if (log.length === 0) return null
              return (
                <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsedAdminCards['qa-'+selected.id] ? 0 : 10 }}>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>
                      Consultant Q&amp;A Log ({log.length} round{log.length !== 1 ? 's' : ''})
                    </p>
                    {adminCardToggle('qa-'+selected.id)}
                  </div>
                  <div style={{ overflow: 'hidden', maxHeight: collapsedAdminCards['qa-'+selected.id] ? 0 : '9999px', transition: 'max-height 0.25s ease' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {log.map((round: any, i: number) => (
                      <div key={i} style={{ paddingLeft: 10, borderLeft: `2px solid ${round.answers ? 'var(--jade)' : 'rgba(200,149,42,0.5)'}` }}>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: round.answers ? 'var(--jade)' : '#9A6A00', marginBottom: 5 }}>
                          Round {round.round} · {new Date(round.askedAt).toLocaleDateString('en-NZ')}
                          {round.answers ? ` · Answered ${new Date(round.answeredAt).toLocaleDateString('en-NZ')}` : ' · Awaiting response'}
                        </p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: round.answers ? 8 : 0 }}>{round.questions}</p>
                        {round.answers && (
                          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--fog)' }}>
                            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>Customer response</p>
                            <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{round.answers}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  </div>{/* end collapsible qa */}
                </div>
              )
            })()}

            {/* Description */}
            <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsedAdminCards['desc-'+selected.id] ? 0 : 8 }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>Description</p>
                {adminCardToggle('desc-'+selected.id)}
              </div>
              <div style={{ overflow: 'hidden', maxHeight: collapsedAdminCards['desc-'+selected.id] ? 0 : '9999px', transition: 'max-height 0.25s ease' }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{selected.description}</p>

              {/* Q&A clarification pairs */}
              {(savedQA.length > 0 || savedText) && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--fog)' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--jade)', marginBottom: 10 }}>Clarification provided</p>
                  {savedQA.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {savedQA.map((pair, i) => (
                        <div key={i}>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginBottom: 3, fontStyle: 'italic' }}>Q{i+1}: {pair.q}</p>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink)', lineHeight: 1.6, paddingLeft: 10, borderLeft: '2px solid var(--jade)' }}>{pair.a}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{savedText}</p>
                  )}
                </div>
              )}
              </div>{/* end collapsible description */}
            </div>

            {/* AI Spec */}
            {spec ? (
              <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsedAdminCards['spec-'+selected.id] ? 0 : 10 }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>
                    AI Spec · {spec.complexity} · ~{spec.estimatedDays}d
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={() => generateSpec(selected.id)} disabled={genSpec} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--jade)', fontSize: 10 }}>{genSpec ? '…' : '↺ Regen'}</button>
                    {adminCardToggle('spec-'+selected.id)}
                  </div>
                </div>
                <div style={{ overflow: 'hidden', maxHeight: collapsedAdminCards['spec-'+selected.id] ? 0 : '9999px', transition: 'max-height 0.25s ease' }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink)', fontStyle: 'italic', lineHeight: 1.6, marginBottom: 8 }}>{spec.userStory}</p>
                {spec.acceptanceCriteria?.length > 0 && (
                  <ul style={{ margin: '0 0 8px', paddingLeft: 16 }}>
                    {spec.acceptanceCriteria.map((c: string, i: number) => (
                      <li key={i} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', lineHeight: 1.6 }}>{c}</li>
                    ))}
                  </ul>
                )}
                {spec.bcObjects?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>BC Objects</p>
                      <button
                        onClick={() => setShowObjectEditor(e => !e)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--jade)', letterSpacing: '0.08em' }}
                      >
                        {showObjectEditor ? '✕ Close editor' : '✏ Edit objects'}
                      </button>
                    </div>
                    {showObjectEditor ? (
                      <div style={{ background: 'rgba(10,92,70,0.04)', border: '1px solid rgba(10,92,70,0.2)', borderRadius: 7, padding: '12px 14px' }}>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginBottom: 10, lineHeight: 1.5 }}>
                          Add or remove objects before generating the dev plan. Changes are saved to the spec.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
                          {editableObjects.map((o, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                value={o}
                                onChange={e => setEditableObjects(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                                style={{ ...inputStyle, flex: 1, fontSize: 10, padding: '5px 8px', fontFamily: 'var(--font-mono)' }}
                                onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                                onBlur={e => (e.target.style.borderColor = 'var(--fog)')}
                              />
                              <button onClick={() => setEditableObjects(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A32D2D', fontSize: 14, padding: '2px 6px' }}>✕</button>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                          <input
                            placeholder="e.g. Table 36 Sales Header — add field 50100 Approval_Status"
                            value={newObjectText}
                            onChange={e => setNewObjectText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && newObjectText.trim()) { setEditableObjects(prev => [...prev, newObjectText.trim()]); setNewObjectText('') }}}
                            style={{ ...inputStyle, flex: 1, fontSize: 10, padding: '5px 8px', fontFamily: 'var(--font-mono)' }}
                            onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                            onBlur={e => (e.target.style.borderColor = 'var(--fog)')}
                          />
                          <button
                            onClick={() => { if (newObjectText.trim()) { setEditableObjects(prev => [...prev, newObjectText.trim()]); setNewObjectText('') }}}
                            style={{ ...btnStyle, padding: '5px 12px', fontSize: 11 }}
                          >+ Add</button>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={async () => { await patch(selected.id, { bcObjects: editableObjects }); setShowObjectEditor(false) }}
                            disabled={actionLoading}
                            style={{ ...btnStyle, fontSize: 11 }}
                          >
                            Save to Spec
                          </button>
                          <button onClick={() => setShowObjectEditor(false)} style={{ ...btnStyle, background: 'var(--fog)', color: 'var(--ink)', fontSize: 11 }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {spec.bcObjects.map((o: string, i: number) => (
                          <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 5, padding: '3px 8px', color: 'var(--slate)', display: 'inline-block' }}>{o}</span>
                        ))}
                      </div>
                    )}

                    {/* Fetch from BCAgent */}
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--fog)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>Fetch C/AL Source</p>
                        <button
                          onClick={fetchNavObjects}
                          disabled={fetchingObjs}
                          style={{ ...btnStyle, fontSize: 10, padding: '4px 10px', background: fetchingObjs ? 'var(--fog)' : 'var(--forest)', color: 'var(--cream)', border: 'none' }}
                        >
                          {fetchingObjs ? '⟳ Fetching…' : '↓ Fetch from BCAgent'}
                        </button>
                        {savedObjCount > 0 && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--jade)' }}>✓ {savedObjCount} saved</span>
                        )}
                      </div>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--slate)', margin: '0 0 6px', lineHeight: 1.5 }}>
                        Fetches C/AL source for the objects listed in the spec. Split and select which to save to the knowledge base.
                      </p>
                      {fetchObjErr && (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#A32D2D', margin: '4px 0' }}>{fetchObjErr}</p>
                      )}
                      {splitObjects.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)' }}>{splitObjects.length} objects parsed — select to save</span>
                              {splitObjects[0]?._debug && (
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, background: '#FAEEDA', color: '#633806', border: '1px solid #EF9F27', borderRadius: 4, padding: '1px 6px' }}>🧪 DEBUG — sample data</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => setSplitObjects(p => p.map(o => ({...o, selected: true})))} style={{ ...btnStyle, fontSize: 9, padding: '3px 8px' }}>All</button>
                              <button onClick={() => setSplitObjects(p => p.map(o => ({...o, selected: false})))} style={{ ...btnStyle, fontSize: 9, padding: '3px 8px' }}>None</button>
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--fog)', borderRadius: 6, padding: 6 }}>
                            {splitObjects.map((o, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', borderRadius: 4, background: o.selected ? 'rgba(10,92,70,0.04)' : 'transparent' }}>
                                <input type="checkbox" checked={o.selected} onChange={e => setSplitObjects(p => p.map((x, j) => j === i ? {...x, selected: e.target.checked} : x))} style={{ width: 12, height: 12 }} />
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--jade)', minWidth: 60 }}>{o.objectType}</span>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', minWidth: 40 }}>{o.objectId}</span>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.objectName}</span>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)', whiteSpace: 'nowrap' }}>{o.sizeBytes > 1024 ? (o.sizeBytes/1024).toFixed(0)+'KB' : o.sizeBytes+'B'}</span>
                                {o.versionList && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#9A6A00', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.versionList}>{o.versionList}</span>}
                                <a
                                  href="#"
                                  onClick={e => { e.preventDefault(); const blob = new Blob([o.content], {type:'text/plain'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${o.objectType}_${o.objectId}_${o.objectName.replace(/[^a-z0-9]/gi,'_')}.txt`; a.click() }}
                                  style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--jade)' }}
                                >↓</a>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                            <button
                              onClick={saveSelectedObjects}
                              disabled={savingObjs || !splitObjects.some(o => o.selected)}
                              style={{ ...btnStyle, fontSize: 10, background: 'var(--ink)', color: 'var(--cream)', border: 'none' }}
                            >
                              {savingObjs ? 'Saving…' : `Save ${splitObjects.filter(o=>o.selected).length} to Knowledge Base`}
                            </button>
                            <button onClick={() => setSplitObjects([])} style={{ ...btnStyle, fontSize: 10, background: 'var(--fog)', color: 'var(--ink)', border: 'none' }}>Discard</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {spec.questions?.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--fog)' }}>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9A6A00', marginBottom: 6 }}>Open questions</p>
                    <ol style={{ margin: 0, paddingLeft: 16 }}>
                      {spec.questions.map((q: string, i: number) => (
                        <li key={i} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink)', lineHeight: 1.6 }}>{q}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {specErr && <p style={{ color: '#A32D2D', fontSize: 11, marginTop: 8 }}>{specErr}</p>}
                </div>{/* end collapsible spec */}
              </div>
            ) : (
              <button onClick={() => generateSpec(selected.id)} disabled={genSpec} style={{ background: 'var(--ink)', color: 'var(--cream)', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500 }}>
                {genSpec ? '✦ Generating…' : '✦ Generate AI Spec'}
              </button>
            )}

            {/* ── Deploy to Test (when requirement is in_development) ── */}
            {selected.status === 'in_development' && (
              <DeployToTestPanel
                selected={selected}
                syncLoading={syncLoading}
                syncResult={syncResult}
                syncErr={syncErr}
                writeLoading={writeLoading}
                writeSnapshotId={writeSnapshotId}
                writeErr={writeErr}
                deployLoading={deployLoading}
                deployResults={deployResults}
                deployDebug={deployDebug}
                deployErr={deployErr}
                onSync={syncFromGitHub}
                onWrite={writeObjectsToServer}
                onDeploy={deployToTest}
                onManualDeploy={async () => {
                  const r = await fetch('/api/admin/requirements')
                  if (r.ok) { const d = await r.json(); const add2 = (d.allAddenda ?? []).map((a: any) => ({ ...a, addenda: [], assignedDeveloper: null, devPlan: null, testDeployedAt: null, testDeploySnapshotId: null, uatApprovedAt: null, uatApprovedById: null, uatRejectedAt: null, uatRejectionReason: null, uatRejectionAnalysis: null, githubBranch: null, prodApprovalSentAt: null, prodGoLiveDoc: null, prodApprovedAt: null, prodApprovedById: null, prodDeployedAt: null, prodDeploySnapshotId: null, deploymentNotes: null, submittedAt: null, inReviewAt: null, quotedAt: null, depositRequiredAt: null, inDevelopmentAt: null, completePendingPaymentAt: null })); setReqs([...d.requirements, ...add2]) }
                }}
              />
            )}

            {/* ── Deploy to Production (when UAT approved) ── */}
            {(selected.uatApprovedAt || selected.prodApprovalSentAt || selected.prodDeployedAt) ? (
              <DeployToProductionPanel
                selected={selected}
                onSentApproval={(goLiveDoc, sentAt) => setReqs(prev => prev.map(x => x.id === selected.id ? { ...x, prodGoLiveDoc: goLiveDoc, prodApprovalSentAt: sentAt, prodApprovedAt: null } : x))}
                onDeployed={(snapshotId, deployedAt) => setReqs(prev => prev.map(x => x.id === selected.id ? { ...x, prodDeployedAt: deployedAt, prodDeploySnapshotId: snapshotId } : x))}
                onManualDeployed={(deployedAt) => setReqs(prev => prev.map(x => x.id === selected.id ? { ...x, prodDeployedAt: deployedAt, prodDeploySnapshotId: null } : x))}
              />
            ) : null}

            {/* ── Coding Assistant (in_development with github branch) ── */}
            {selected.status === 'in_development' ? (
              <div style={{ background: 'rgba(10,92,70,0.05)', border: '1px solid rgba(10,92,70,0.2)', borderRadius: 8, overflow: 'hidden' }}>
                <button
                  onClick={() => { setShowCodingPanel(p => !p); if (showCodingPanel) { setCodingHistory([]); setCodingMessage(''); setCodingCommitErr('') } }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{'</>'}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--forest)' }}>Coding Assistant</span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)' }}>
                      {selected.githubBranch ? ('— ' + selected.githubBranch) : '— no branch yet (fetch objects first)'}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--forest)' }}>{showCodingPanel ? '▲' : '▼'}</span>
                </button>

                {showCodingPanel ? (
                  <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid rgba(10,92,70,0.15)' }}>

                    {selected.githubBranch ? null : (
                      <div style={{ paddingTop: 10, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', lineHeight: 1.6 }}>
                        No GitHub branch is linked yet. Use the BC Objects panel above to fetch objects from BCAgent and save them to the Knowledge Base — this will automatically create the branch.
                      </div>
                    )}

                    {selected.githubBranch ? (
                      <>
                        {/* Quick prompts */}
                        {codingHistory.length === 0 ? (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 10 }}>
                            {[
                              'Explain what these objects do and how they relate to each other',
                              'What changes are needed to implement this requirement?',
                              'Write the modified objects for this requirement',
                              'What are the risks and dependencies I should be aware of?',
                              'Check the code for any issues or anti-patterns',
                            ].map(q => (
                              <button key={q} onClick={() => setCodingMessage(q)} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 6, background: 'rgba(10,92,70,0.08)', border: '1px solid rgba(10,92,70,0.2)', color: 'var(--forest)', cursor: 'pointer' }}>{q}</button>
                            ))}
                          </div>
                        ) : null}

                        {/* Conversation thread */}
                        {codingHistory.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, maxHeight: 560, overflowY: 'auto' }}>
                            {codingHistory.map((msg, i) => {
                              const calObjects = msg.role === 'assistant' ? extractCalObjects(msg.content) : []
                              return (
                                <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '95%', width: msg.role === 'assistant' ? '95%' : undefined }}>
                                  {msg.role === 'user' ? (
                                    <div style={{ background: 'rgba(10,92,70,0.1)', border: '1px solid rgba(10,92,70,0.2)', borderRadius: '10px 10px 2px 10px', padding: '8px 12px' }}>
                                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--forest)', margin: 0, lineHeight: 1.5 }}>{msg.content}</p>
                                    </div>
                                  ) : (
                                    <div style={{ background: 'var(--ink)', borderRadius: '10px 10px 10px 2px', padding: '10px 14px' }}>
                                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(244,239,228,0.9)', lineHeight: 1.7 }}>
                                        {renderMd(msg.content)}
                                        {codingStreaming && i === codingHistory.length - 1 ? <span style={{ opacity: 0.5 }}>▌</span> : null}
                                      </div>
                                      {/* Commit buttons for detected C/AL objects */}
                                      {!codingStreaming && calObjects.length > 0 ? (
                                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(10,92,70,0.7)', margin: 0 }}>
                                            {calObjects.length} C/AL object{calObjects.length !== 1 ? 's' : ''} detected
                                          </p>
                                          {calObjects.map((obj, oi) => (
                                            <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(214,217,212,0.6)', flex: 1 }}>{obj.filename}</span>
                                              <button
                                                onClick={() => commitCalObject(i, obj.filename, obj.content)}
                                                disabled={codingCommitting === i}
                                                style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--jade)', background: 'none', border: '1px solid rgba(10,92,70,0.4)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', opacity: codingCommitting === i ? 0.5 : 1 }}
                                              >
                                                {codingCommitting === i ? '…' : '↑ Commit to Branch'}
                                              </button>
                                            </div>
                                          ))}
                                          {codingCommitErr ? (
                                            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A32D2D', margin: 0 }}>{codingCommitErr}</p>
                                          ) : null}
                                        </div>
                                      ) : null}
                                      {/* Clear button on last completed message */}
                                      {msg.role === 'assistant' && !codingStreaming && i === codingHistory.length - 1 ? (
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                                          <button
                                            onClick={() => { setCodingHistory([]); setCodingCommitErr('') }}
                                            style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', background: 'none', border: 'none', padding: '4px 6px', cursor: 'pointer' }}
                                          >✕ Clear</button>
                                        </div>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        ) : null}

                        {/* Input */}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <textarea
                            value={codingMessage}
                            onChange={e => setCodingMessage(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey && codingMessage.trim() && !codingStreaming) {
                                e.preventDefault()
                                askCodingAssistant()
                              }
                            }}
                            placeholder={codingHistory.length > 0 ? 'Ask a follow-up or request changes…' : 'Ask about the code, request modifications, or ask it to write the implementation…'}
                            rows={2}
                            style={{ ...inputStyle, flex: 1, resize: 'vertical', fontFamily: 'var(--font-body)', fontSize: 12 }}
                            disabled={codingStreaming}
                          />
                          <button
                            disabled={codingStreaming || !codingMessage.trim()}
                            onClick={askCodingAssistant}
                            style={{ ...btnStyle, background: '#0A5C46', opacity: (codingStreaming || !codingMessage.trim()) ? 0.6 : 1, whiteSpace: 'nowrap', padding: '9px 14px', alignSelf: 'flex-end' }}
                          >
                            {codingStreaming ? '…' : 'Send →'}
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ── Dev Plan (superadmin internal only) ── */}
            {['in_review','quoted','approved','in_development','complete','quote_rejected'].includes(selected.status) && (
              <div style={{ background: 'var(--ink)', borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: devPlanData ? 14 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--amber)' }}>⚙ Internal Dev Plan</span>
                    {devPlanData && devPlanData.totalEstimatedHours && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(214,217,212,0.5)' }}>
                        {devPlanData.totalEstimatedHours}h · {devPlanData.tasks?.length ?? 0} tasks
                      </span>
                    )}
                    {devPlanData && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: devPlanData._bcConnected ? 'var(--jade)' : 'rgba(214,217,212,0.3)', letterSpacing: '0.08em' }}>
                        {devPlanData._bcConnected
                          ? `🔌 BC live · ${devPlanData._introspectedTables?.join(', ')}`
                          : '🔌 BC not connected'}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => generateDevPlan(selected.id)}
                    disabled={genPlan}
                    style={{ background: 'rgba(200,149,42,0.15)', border: '1px solid rgba(200,149,42,0.3)', color: 'var(--amber)', borderRadius: 6, padding: '5px 12px', cursor: genPlan ? 'wait' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em' }}
                  >
                    {genPlan ? '✦ Generating…' : devPlanData ? '↺ Regenerate' : '✦ Generate Dev Plan'}
                  </button>
                </div>
                {planErr && <p style={{ color: '#E24B4A', fontSize: 11, marginTop: 8 }}>{planErr}</p>}
                {devPlanData && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
                    {devPlanData.summary && (
                      <div>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.35)', marginBottom: 5 }}>Summary</p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(214,217,212,0.8)', lineHeight: 1.65 }}>{devPlanData.summary}</p>
                      </div>
                    )}

                    {/* Field audit — only shown if BC was connected */}
                    {devPlanData._bcConnected && (devPlanData.existingFieldsFound?.length > 0 || devPlanData.missingFieldsAdded?.length > 0) && (
                      <div style={{ display: 'flex', gap: 10 }}>
                        {devPlanData.existingFieldsFound?.length > 0 && (
                          <div style={{ flex: 1, background: 'rgba(26,146,114,0.08)', border: '1px solid rgba(26,146,114,0.2)', borderRadius: 6, padding: '10px 12px' }}>
                            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--jade)', marginBottom: 6 }}>✓ Already in BC — no action</p>
                            <ul style={{ margin: 0, paddingLeft: 14 }}>
                              {devPlanData.existingFieldsFound.map((f: string, i: number) => (
                                <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(214,217,212,0.55)', lineHeight: 1.6 }}>{f}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {devPlanData.missingFieldsAdded?.length > 0 && (
                          <div style={{ flex: 1, background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.2)', borderRadius: 6, padding: '10px 12px' }}>
                            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--amber)', marginBottom: 6 }}>⚠ Missing — being added</p>
                            <ul style={{ margin: 0, paddingLeft: 14 }}>
                              {devPlanData.missingFieldsAdded.map((f: string, i: number) => (
                                <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(214,217,212,0.7)', lineHeight: 1.6 }}>{f}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                    {devPlanData.approach && (
                      <div>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.35)', marginBottom: 5 }}>Technical Approach</p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(214,217,212,0.7)', lineHeight: 1.65 }}>{devPlanData.approach}</p>
                      </div>
                    )}
                    {devPlanData.tasks?.length > 0 && (
                      <div>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.35)', marginBottom: 8 }}>Tasks</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {devPlanData.tasks.map((task: any, i: number) => (
                            <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, padding: '10px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: task.description ? 5 : 0 }}>
                                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--cream)', lineHeight: 1.3, flex: 1 }}>{task.title}</span>
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                  {task.phase && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 7, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--amber)', background: 'rgba(200,149,42,0.12)', border: '1px solid rgba(200,149,42,0.2)', padding: '2px 6px', borderRadius: 4 }}>{task.phase}</span>}
                                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--jade)', fontWeight: 600 }}>{task.estimatedHours}h</span>
                                </div>
                              </div>
                              {task.description && <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(214,217,212,0.6)', lineHeight: 1.55, marginBottom: task.objects?.length ? 6 : 0 }}>{task.description}</p>}
                              {task.objects?.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: task.codeSnippet ? 8 : 0 }}>
                                  {task.objects.map((o: string, j: number) => (
                                    <span key={j} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(214,217,212,0.45)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '2px 6px' }}>{o}</span>
                                  ))}
                                </div>
                              )}
                              {task.codeSnippet && (
                                <div style={{ marginTop: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--jade)' }}>
                                      {task.codeSnippet.filename}
                                    </span>
                                  </div>
                                  {task.codeSnippet.placement && (
                                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(214,217,212,0.4)', marginBottom: 5, fontStyle: 'italic' }}>
                                      📍 {task.codeSnippet.placement}
                                    </p>
                                  )}
                                  <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(214,217,212,0.85)', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, padding: '10px 12px', overflowX: 'auto', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                    {task.codeSnippet.code}
                                  </pre>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {devPlanData.totalEstimatedHours && (
                        <div style={{ background: 'rgba(26,146,114,0.12)', border: '1px solid rgba(26,146,114,0.2)', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300, color: 'var(--jade)', lineHeight: 1 }}>{devPlanData.totalEstimatedHours}h</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.4)', marginTop: 3 }}>Total Hours</div>
                        </div>
                      )}
                      {devPlanData.suggestedDailyRate && (
                        <div style={{ background: 'rgba(200,149,42,0.1)', border: '1px solid rgba(200,149,42,0.2)', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300, color: 'var(--amber)', lineHeight: 1 }}>${devPlanData.suggestedDailyRate.toLocaleString()}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.4)', marginTop: 3 }}>Day Rate (NZD)</div>
                        </div>
                      )}
                      {devPlanData.totalEstimatedHours && devPlanData.suggestedDailyRate && (
                        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300, color: 'var(--cream)', lineHeight: 1 }}>
                            ${Math.round(devPlanData.totalEstimatedHours / 8 * devPlanData.suggestedDailyRate).toLocaleString()}
                          </div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.4)', marginTop: 3 }}>Suggested Quote</div>
                        </div>
                      )}
                    </div>
                    {devPlanData.quotingNotes && (
                      <div style={{ background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.2)', borderRadius: 6, padding: '10px 12px' }}>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--amber)', marginBottom: 5 }}>💰 Quoting Notes</p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(214,217,212,0.75)', lineHeight: 1.65 }}>{devPlanData.quotingNotes}</p>
                      </div>
                    )}
                    {devPlanData.risks?.length > 0 && (
                      <div>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.35)', marginBottom: 6 }}>Risks &amp; Mitigations</p>
                        <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {devPlanData.risks.map((r: string, i: number) => <li key={i} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(214,217,212,0.6)', lineHeight: 1.6 }}>{r}</li>)}
                        </ul>
                      </div>
                    )}
                    {devPlanData.testingPlan && (
                      <div>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.35)', marginBottom: 5 }}>Testing Plan</p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(214,217,212,0.6)', lineHeight: 1.6 }}>{devPlanData.testingPlan}</p>
                      </div>
                    )}
                    {devPlanData.deploymentNotes && (
                      <div>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.35)', marginBottom: 5 }}>Deployment</p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(214,217,212,0.6)', lineHeight: 1.6 }}>{devPlanData.deploymentNotes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Quote info */}
            {selected.quote && (
              <div style={{ background: 'rgba(10,92,70,0.05)', border: '1px solid rgba(10,92,70,0.2)', borderRadius: 8, padding: '12px 14px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>Quote</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500, color: 'var(--forest)', lineHeight: 1 }}>${parseFloat(selected.quote!).toLocaleString()}</p>
                {selected.consultantNote && <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, marginTop: 8, lineHeight: 1.7 }}>{renderMdLight(selected.consultantNote)}</div>}
                {selected.quoteApprovedAt && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--jade)', marginTop: 6 }}>✓ Approved {new Date(selected.quoteApprovedAt).toLocaleDateString('en-NZ')}</p>}
              </div>
            )}

            {/* ── Addenda list ── */}
            {selected.addenda && selected.addenda.length > 0 ? (
              <div style={{ background: 'var(--ink)', borderRadius: 8, padding: '12px 14px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.5)', margin: '0 0 8px' }}>
                  Addenda ({selected.addenda.length})
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selected.addenda.map(add => {
                    const STATUS_COLORS: Record<string, string> = {
                      submitted: '#C8952A', in_review: '#9A6A00', quoted: '#0A5C46',
                      in_development: '#0A5C46', fully_paid: '#0A5240', rejected: '#A32D2D',
                    }
                    const col = STATUS_COLORS[add.status] ?? 'rgba(214,217,212,0.5)'
                    return (
                      <div key={add.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(244,239,228,0.85)', flex: 1 }}>{add.title}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.07em', textTransform: 'uppercase', color: col, whiteSpace: 'nowrap' }}>{add.status.replace(/_/g, ' ')}</span>
                        {add.quote ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--amber)' }}>${parseFloat(add.quote).toLocaleString()}</span> : null}
                        <button
                          onClick={() => {
                            const fullAdd = reqs.find(r => r.id === add.id)
                            if (fullAdd) selectReq(fullAdd)
                          }}
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--slate)', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
                        >View →</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {/* ── AI Developer Assistant — visible during review & quoting ── */}
            {['in_review', 'quote_rejected', 'submitted', 'in_development'].includes(selected.status) && (
              <div style={{ background: 'rgba(200,149,42,0.05)', border: '1px solid rgba(200,149,42,0.2)', borderRadius: 8, overflow: 'hidden' }}>
                <button
                  onClick={() => { setShowAiPanel(p => !p); if (showAiPanel) { setDevHistory([]); setDevQuestion('') } }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>✦</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9A6A00' }}>AI Developer Assistant</span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)' }}>— effort, pricing, integration notes</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#9A6A00' }}>{showAiPanel ? '▲' : '▼'}</span>
                </button>

                {showAiPanel && (
                  <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid rgba(200,149,42,0.15)' }}>

                    {/* Quick prompts — only show when no conversation yet */}
                    {devHistory.length === 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 10 }}>
                        {[
                          'Summarise effort and justify a quote for this requirement',
                          'What are the key risks and dependencies?',
                          `Draft a professional consultant note addressed to ${selected.user?.name ?? 'the customer'}`,
                          'What installation or setup steps are needed?',
                          'What BC objects will be affected?',
                        ].map(q => (
                          <button key={q} onClick={() => setDevQuestion(q)} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 6, background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.2)', color: '#9A6A00', cursor: 'pointer' }}>{q}</button>
                        ))}
                      </div>
                    )}

                    {/* Conversation thread */}
                    {devHistory.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, maxHeight: 420, overflowY: 'auto' }}>
                        {devHistory.map((msg, i) => (
                          <div key={i} style={{
                            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            maxWidth: '90%',
                          }}>
                            {msg.role === 'user' ? (
                              <div style={{ background: 'rgba(200,149,42,0.1)', border: '1px solid rgba(200,149,42,0.2)', borderRadius: '10px 10px 2px 10px', padding: '8px 12px' }}>
                                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7A5000', margin: 0, lineHeight: 1.5 }}>{msg.content}</p>
                              </div>
                            ) : (
                              <div style={{ background: 'var(--ink)', borderRadius: '10px 10px 10px 2px', padding: '10px 14px' }}>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(244,239,228,0.9)', lineHeight: 1.7, margin: 0 }}>
                                  {renderMd(msg.content)}
                                  {devStreaming && i === devHistory.length - 1 ? <span style={{ opacity: 0.5 }}>▌</span> : null}
                                </div>
                                {/* Actions on last completed assistant message */}
                                {msg.role === 'assistant' && !devStreaming && i === devHistory.length - 1 && msg.content && (
                                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                    <button
                                      onClick={() => {
                                        // Strip markdown for plain-text consultant note
                                        const stripped = msg.content
                                          .replace(/^#{1,3} /gm, '')
                                          .replace(/\*\*(.+?)\*\*/g, '$1')
                                          .replace(/^[-–] /gm, '• ')
                                        setQuoteNote(stripped)
                                        setShowQF(true); setShowAiPanel(false)
                                      }}
                                      style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--amber)', background: 'none', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}
                                    >↓ Use as consultant note</button>
                                    <button
                                      onClick={() => navigator.clipboard.writeText(msg.content)}
                                      style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}
                                    >Copy</button>
                                    <button
                                      onClick={() => setDevHistory([])}
                                      style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', background: 'none', border: 'none', padding: '4px 6px', cursor: 'pointer', marginLeft: 'auto' }}
                                    >✕ Clear</button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Question input + send */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={devQuestion}
                        onChange={e => setDevQuestion(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey && devQuestion.trim() && !devStreaming) {
                            e.preventDefault()
                            askDevAssistant()
                          }
                        }}
                        placeholder={devHistory.length > 0 ? 'Ask a follow-up…' : 'Ask about complexity, integrations, risks, or pricing justification…'}
                        style={{ ...inputStyle, flex: 1 }}
                        onFocus={e => (e.target.style.borderColor = 'rgba(200,149,42,0.5)')}
                        onBlur={e => (e.target.style.borderColor = 'var(--fog)')}
                        disabled={devStreaming}
                      />
                      <button
                        disabled={devStreaming || !devQuestion.trim()}
                        onClick={askDevAssistant}
                        style={{ ...btnStyle, background: '#9A6A00', opacity: (devStreaming || !devQuestion.trim()) ? 0.6 : 1, whiteSpace: 'nowrap', padding: '9px 14px' }}
                      >
                        {devStreaming ? '…' : 'Ask →'}
                      </button>
                    </div>

                    {/* Doc upload */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', cursor: 'pointer', padding: '4px 10px', border: '1px solid var(--fog)', borderRadius: 6, background: 'var(--cream)' }}>
                        📎 {devDocName || 'Attach doc'}
                        <input type="file" accept=".txt,.md,.csv,.json" style={{ display: 'none' }} onChange={e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          setDevDocName(file.name)
                          const reader = new FileReader()
                          reader.onload = ev => setDevDocContent(ev.target?.result as string ?? '')
                          reader.readAsText(file)
                        }} />
                      </label>
                      {devDocName && <button onClick={() => { setDevDocName(''); setDevDocContent('') }} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>}
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)' }}>API docs, spec sheets, integration guides (.txt .md .csv .json)</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Admin actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selected.status === 'submitted' && <>
                <button onClick={() => patch(selected.id, { status: 'in_review' })} disabled={actionLoading} style={{ ...btnStyle }}>→ In Review</button>
                <button onClick={() => { setShowSB(true); setShowQF(false) }} style={{ ...btnStyle, background: 'rgba(163,45,45,0.08)', color: '#A32D2D', border: '1px solid rgba(163,45,45,0.2)' }}>↩ Send Back with Questions</button>
              </>}
              {selected.status === 'in_review' && <>
                <button onClick={() => { setShowQF(true); setShowSB(false) }} disabled={actionLoading} style={{ ...btnStyle }}>$ Add Quote</button>
                <button onClick={() => { setShowSB(true); setShowQF(false) }} style={{ ...btnStyle, background: 'rgba(163,45,45,0.08)', color: '#A32D2D', border: '1px solid rgba(163,45,45,0.2)' }}>↩ Send Back</button>
              </>}
              {selected.status === 'quote_rejected' && (
                <button onClick={() => { setShowQF(true); setShowSB(false) }} disabled={actionLoading} style={{ ...btnStyle }}>$ Revise Quote</button>
              )}
              {selected.status === 'deposit_required' && (
                <button onClick={() => patch(selected.id, { status: 'deposit_paid' })} disabled={actionLoading} style={{ ...btnStyle, background: '#0F6E56' }}>✓ Confirm Deposit Received</button>
              )}
              {selected.status === 'deposit_paid' && (
                <button onClick={() => patch(selected.id, { status: 'in_development' })} disabled={actionLoading} style={{ ...btnStyle }}>→ Start Development</button>
              )}
              {selected.status === 'in_development' && (
                <button onClick={() => patch(selected.id, { status: 'complete_pending_payment' })} disabled={actionLoading} style={{ ...btnStyle, background: '#0F6E56' }}>✓ Complete — Request Balance</button>
              )}
              {selected.status === 'complete_pending_payment' && (
                <button onClick={() => patch(selected.id, { status: 'fully_paid' })} disabled={actionLoading} style={{ ...btnStyle, background: '#085040' }}>✓ Confirm Balance Received</button>
              )}
              {!['fully_paid', 'rejected'].includes(selected.status) && (
                <button onClick={() => patch(selected.id, { status: 'rejected' })} disabled={actionLoading} style={{ ...btnStyle, background: 'var(--fog)', color: '#A32D2D' }}>✕ Reject</button>
              )}
            </div>

            {/* Send back form */}
            {showSB && (
              <div style={{ background: 'var(--white)', border: '1px solid rgba(163,45,45,0.25)', borderRadius: 8, padding: '12px 14px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A32D2D', marginBottom: 6 }}>Questions for Customer</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginBottom: 10, lineHeight: 1.5 }}>The customer will see this and must respond before resubmitting.</p>
                <textarea
                  placeholder={'e.g.\n1. Should approval apply to all orders or only above a threshold?\n2. Who are the approvers — named users or a permission group?\n3. Do you need email notifications?'}
                  value={sendBackText}
                  onChange={e => setSBT(e.target.value)}
                  rows={5}
                  style={{ ...inputStyle, resize: 'vertical', marginBottom: 10 }}
                  onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--fog)')}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={async () => { await patch(selected.id, { status: 'needs_clarification', adminQuestions: sendBackText.trim() }); setShowSB(false); setSBT('') }}
                    disabled={!sendBackText.trim() || actionLoading}
                    style={{ ...btnStyle, background: '#A32D2D', opacity: !sendBackText.trim() ? 0.6 : 1 }}
                  >
                    ↩ Send Back to Customer
                  </button>
                  <button onClick={() => { setShowSB(false); setSBT('') }} style={{ ...btnStyle, background: 'var(--fog)', color: 'var(--ink)' }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Quote form */}
            {showQF && (
              <div style={{ background: 'var(--white)', border: '1px solid rgba(10,92,70,0.2)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* ── Quote amount ── */}
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>
                    {selected.status === 'quote_rejected' ? 'Revised Quote Amount (NZD)' : 'Quote Amount (NZD)'}
                  </p>
                  {selected.status === 'quote_rejected' && selected.quoteRejectionReason && (
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginBottom: 8, fontStyle: 'italic', lineHeight: 1.5 }}>Customer reason: "{selected.quoteRejectionReason}"</p>
                  )}
                  <input type="number" placeholder="e.g. 2500" value={quoteAmt} onChange={e => setQuoteAmt(e.target.value)} style={{ ...inputStyle }} onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
                </div>

                {/* ── Consultant note ── */}
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>Consultant note <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(shown on quote to customer)</span></p>
                  <textarea
                    placeholder={selected.status === 'quote_rejected' ? 'e.g. Revised to reduced scope per your feedback.' : 'e.g. Includes design, development, testing, and one round of UAT. Estimate based on standard Continia integration complexity.'}
                    value={quoteNote} onChange={e => setQuoteNote(e.target.value)} rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                    onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')}
                  />
                </div>

                {/* ── Actions ── */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={async () => {
                      await patch(selected.id, { status: 'quoted', quote: quoteAmt, consultantNote: quoteNote || undefined })
                      setShowQF(false); setQuoteAmt(''); setQuoteNote('')
                      setShowAiPanel(false); setDevHistory([]); setDevQuestion(''); setDevDocName(''); setDevDocContent('')
                    }}
                    disabled={!quoteAmt || actionLoading}
                    style={{ ...btnStyle, opacity: (!quoteAmt || actionLoading) ? 0.6 : 1 }}
                  >
                    Send Quote →
                  </button>
                  <button
                    onClick={() => { setShowQF(false); setShowAiPanel(false); setDevHistory([]); setDevQuestion('') }}
                    style={{ ...btnStyle, background: 'var(--fog)', color: 'var(--ink)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>
        )
      })()}
    </div>
  )
}

// ─── AI Settings Tab ─────────────────────────────────────────────────────────

// ─── AI Settings Tab ─────────────────────────────────────────────────────────

function AISettingsTab() {
  const [config, setConfig]   = useState<any>(null)
  const [usage, setUsage]     = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')
  // Editable form state
  const [form, setForm] = useState<any>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/ai-config').then(r => r.json()),
      fetch('/api/admin/ai-usage').then(r => r.json()),
    ]).then(([cfg, usg]) => {
      setConfig(cfg)
      setForm({
        provider:    cfg.provider,
        model:       cfg.model,
        maxTokens:   cfg.maxTokens,
        temperature: cfg.temperature,
        features:    { ...cfg.features },
      })
      setUsage(usg)
      setLoading(false)
    }).catch(() => { setError('Failed to load AI config'); setLoading(false) })
  }, [])

  async function handleSave() {
    setSaving(true); setSaved(false); setError('')
    try {
      const res = await fetch('/api/admin/ai-config', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Save failed'); return }
      setConfig(data)
      setForm({
        provider:    data.provider,
        model:       data.model,
        maxTokens:   data.maxTokens,
        temperature: data.temperature,
        features:    { ...data.features },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  if (loading) return <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--slate)' }}>Loading…</p>
  if (error && !config) return <p style={{ color: '#A32D2D' }}>{error}</p>
  if (!form) return null

  const models = config?.availableModels?.[form.provider] ?? []
  const selectedModel = models.find((m: any) => m.id === form.model)

  const badge = (on: boolean) => (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 8, padding: '2px 8px', borderRadius: 6,
      background: on ? 'rgba(10,92,70,0.08)' : 'rgba(163,45,45,0.08)',
      border: `1px solid ${on ? 'rgba(10,92,70,0.2)' : 'rgba(163,45,45,0.2)'}`,
      color: on ? 'var(--forest)' : '#A32D2D', textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    }}>{on ? 'enabled' : 'disabled'}</span>
  )

  const label = (text: string) => (
    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', margin: '0 0 6px' }}>{text}</p>
  )

  return (
    <div style={{ maxWidth: 700, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Status banner */}
      <div style={{ background: 'rgba(10,92,70,0.05)', border: '1px solid rgba(10,92,70,0.2)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18 }}>✦</span>
          <div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--forest)', margin: 0 }}>AI Active</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', margin: '2px 0 0' }}>
              {config.provider} · {config.model}
              {config.provider === 'anthropic' && !config.anthropicKeySet && <span style={{ color: '#A32D2D' }}> · ⚠ ANTHROPIC_API_KEY missing</span>}
              {config.provider === 'openai'    && !config.openaiKeySet    && <span style={{ color: '#A32D2D' }}> · ⚠ OPENAI_API_KEY missing</span>}
            </p>
            {config.updatedBy && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'rgba(0,0,0,0.3)', margin: '3px 0 0' }}>Last saved by {config.updatedBy}</p>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--forest)', letterSpacing: '0.1em' }}>✓ Saved</span>}
          {error && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A32D2D' }}>{error}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ ...btnStyle, padding: '8px 18px', opacity: saving ? 0.7 : 1 }}
          >{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>

      {/* Provider + Model */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>Provider & Model</p>

        {/* Provider toggle */}
        <div>
          {label('AI Provider')}
          <div style={{ display: 'flex', gap: 8 }}>
            {(['anthropic', 'openai'] as const).map(p => (
              <button key={p} onClick={() => {
                const defaultModel = config.availableModels?.[p]?.[1]?.id ?? config.availableModels?.[p]?.[0]?.id
                setForm((f: any) => ({ ...f, provider: p, model: defaultModel }))
              }} style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, padding: '8px 18px', borderRadius: 8,
                border: `1px solid ${form.provider === p ? 'var(--forest)' : 'var(--fog)'}`,
                background: form.provider === p ? 'rgba(10,92,70,0.08)' : 'var(--cream)',
                color: form.provider === p ? 'var(--forest)' : 'var(--slate)',
                cursor: 'pointer', fontWeight: form.provider === p ? 600 : 400,
                textTransform: 'capitalize',
              }}>{p}</button>
            ))}
          </div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)', margin: '6px 0 0' }}>
            {form.provider === 'anthropic' ? '🔒 Requires ANTHROPIC_API_KEY in Vercel env vars' : '🔒 Requires OPENAI_API_KEY in Vercel env vars'}
          </p>
        </div>

        {/* Model selector */}
        <div>
          {label('Model')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {models.map((m: any) => (
              <div key={m.id} onClick={() => setForm((f: any) => ({ ...f, model: m.id }))} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${form.model === m.id ? 'var(--forest)' : 'var(--fog)'}`,
                background: form.model === m.id ? 'rgba(10,92,70,0.05)' : 'var(--cream)',
                transition: 'all 0.1s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {form.model === m.id && <span style={{ color: 'var(--forest)', fontSize: 12 }}>✓</span>}
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', fontWeight: form.model === m.id ? 600 : 400 }}>{m.label}</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)' }}>{m.costHint}</span>
              </div>
            ))}
          </div>
          {selectedModel && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--jade)', margin: '6px 0 0' }}>Selected: {selectedModel.costHint}</p>
          )}
        </div>
      </div>

      {/* Parameters */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>Parameters</p>

        <div style={{ display: 'flex', gap: 20 }}>
          <div style={{ flex: 1 }}>
            {label('Max Tokens (200–4000)')}
            <input type="number" min={200} max={4000} step={100}
              value={form.maxTokens}
              onChange={e => setForm((f: any) => ({ ...f, maxTokens: parseInt(e.target.value) || 1000 }))}
              style={{ ...inputStyle, width: '100%' }}
            />
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)', margin: '4px 0 0' }}>Max response length per AI call</p>
          </div>
          <div style={{ flex: 1 }}>
            {label(`Temperature — ${form.temperature.toFixed(1)}`)}
            <input type="range" min={0} max={1} step={0.1}
              value={form.temperature}
              onChange={e => setForm((f: any) => ({ ...f, temperature: parseFloat(e.target.value) }))}
              style={{ width: '100%', marginTop: 6 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)' }}>0.0 Consistent</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)' }}>1.0 Creative</span>
            </div>
          </div>
        </div>
      </div>

      {/* Feature flags */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 12 }}>Feature Flags</p>
        {[
          { key: 'devAssistant',   label: 'Dev Assistant',     desc: 'AI panel in admin requirement review' },
          { key: 'specGeneration', label: 'Spec Generation',   desc: 'AI spec generation for customers' },
          { key: 'devPlan',        label: 'Dev Plan',          desc: 'AI internal dev plan generation' },
          { key: 'feasibility',    label: 'Feasibility Check', desc: 'AI feasibility analysis' },
          { key: 'cfoChatQuery',   label: 'CFO Assistant',     desc: 'AI responses to CFO chat queries' },
        ].map(({ key, label: lbl, desc }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--fog)' }}>
            <div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', margin: 0 }}>{lbl}</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', margin: '2px 0 0' }}>{desc}</p>
            </div>
            <button onClick={() => setForm((f: any) => ({ ...f, features: { ...f.features, [key]: !f.features[key] } }))} style={{
              fontFamily: 'var(--font-mono)', fontSize: 8, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
              background: form.features[key] ? 'rgba(10,92,70,0.08)' : 'rgba(163,45,45,0.08)',
              border: `1px solid ${form.features[key] ? 'rgba(10,92,70,0.2)' : 'rgba(163,45,45,0.2)'}`,
              color: form.features[key] ? 'var(--forest)' : '#A32D2D',
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>{form.features[key] ? 'Enabled' : 'Disabled'}</button>
          </div>
        ))}
      </div>

      {/* API key status — read only, managed in Vercel */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>API Keys</p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 12 }}>API keys are managed securely in <strong>Vercel → Project → Settings → Environment Variables</strong> and are never stored in the database.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          {[{ key: 'ANTHROPIC_API_KEY', set: config.anthropicKeySet, label: 'Anthropic' }, { key: 'OPENAI_API_KEY', set: config.openaiKeySet, label: 'OpenAI' }].map(k => (
            <div key={k.key} style={{ flex: 1, background: 'var(--cream)', borderRadius: 8, padding: '10px 14px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>{k.label}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                {badge(k.set)}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)' }}>{k.key}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Usage panel */}
      {usage && !usage.error && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>Token Usage — This Month</p>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Requests',      value: usage.thisMonth.requests.toLocaleString() },
              { label: 'Input tokens',  value: (usage.thisMonth.inputTokens  ?? 0).toLocaleString() },
              { label: 'Output tokens', value: (usage.thisMonth.outputTokens ?? 0).toLocaleString() },
              { label: 'Est. cost',     value: `$${(usage.thisMonth.estimatedUsd ?? 0).toFixed(4)} USD` },
            ].map(k => (
              <div key={k.label} style={{ flex: '1 1 120px', background: 'var(--cream)', borderRadius: 8, padding: '10px 14px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>{k.label}</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--ink)', margin: '4px 0 0' }}>{k.value}</p>
              </div>
            ))}
          </div>
          {usage.byTenant?.length > 0 && (
            <>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>By Tenant — This Month</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 14 }}>
                <thead><tr>{['Tenant','Requests','In tokens','Out tokens','Est. cost'].map(h => (
                  <th key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--slate)', textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid var(--fog)' }}>{h}</th>
                ))}</tr></thead>
                <tbody>{usage.byTenant.map((t: any) => (
                  <tr key={t.tenantId}>
                    <td style={{ fontFamily: 'var(--font-body)', fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--ink)' }}>{t.tenantName}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--slate)' }}>{t.requests}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--slate)' }}>{(t.inputTokens ?? 0).toLocaleString()}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--slate)' }}>{(t.outputTokens ?? 0).toLocaleString()}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--jade)', fontWeight: 600 }}>${(t.estimatedUsd ?? 0).toFixed(4)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </>
          )}
          {usage.byTenantAllTime?.length > 0 && (
            <>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>By Tenant — All Time (Cost Basis)</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 14 }}>
                <thead><tr>{['Tenant','Total Requests','Total Tokens','Est. cost (USD)'].map(h => (
                  <th key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--slate)', textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid var(--fog)' }}>{h}</th>
                ))}</tr></thead>
                <tbody>{usage.byTenantAllTime.map((t: any) => (
                  <tr key={t.tenantId}>
                    <td style={{ fontFamily: 'var(--font-body)', fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--ink)', fontWeight: 500 }}>{t.tenantName}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--slate)' }}>{t.requests}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--slate)' }}>{(t.inputTokens + t.outputTokens).toLocaleString()}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--jade)', fontWeight: 700 }}>${(t.estimatedUsd ?? 0).toFixed(4)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </>
          )}
          {usage.byFeature?.length > 0 && (
            <>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>By Feature</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {usage.byFeature.map((f: any) => (
                  <div key={f.feature} style={{ background: 'var(--cream)', borderRadius: 8, padding: '8px 12px', flex: '1 1 140px' }}>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--jade)', margin: 0 }}>{f.feature.replace(/_/g, ' ')}</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: '3px 0 0' }}>{f.requests} requests</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', margin: '2px 0 0' }}>{(f.inputTokens + f.outputTokens).toLocaleString()} tokens</p>
                  </div>
                ))}
              </div>
            </>
          )}
          {usage.thisMonth.requests === 0 && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', textAlign: 'center', padding: '20px 0' }}>No AI usage recorded yet this month.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Business Settings Tab ────────────────────────────────────────────────────

function BusinessSettingsTab() {
  const [form, setForm]     = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    fetch('/api/admin/business-config').then(r => r.json()).then(d => { setForm(d); setLoading(false) })
      .catch(() => { setError('Failed to load'); setLoading(false) })
  }, [])

  async function handleSave() {
    setSaving(true); setSaved(false); setError('')
    try {
      const res = await fetch('/api/admin/business-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const d   = await res.json()
      if (!res.ok) { setError(d.error ?? 'Save failed'); return }
      setForm(d); setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  function field(label: string, key: string, placeholder?: string, hint?: string) {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>{label}</label>
        <input
          value={form?.[key] ?? ''}
          onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value }))}
          placeholder={placeholder ?? ''}
          style={{ width: '100%', background: 'var(--cream)', border: '1px solid var(--fog)', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' as const }}
        />
        {hint && <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>{hint}</p>}
      </div>
    )
  }

  function termsField(key: 'terms1' | 'terms2' | 'terms3', labelKey: string, textKey: string, hint: string) {
    return (
      <div style={{ background: 'var(--cream)', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
          <div style={{ flex: '0 0 160px' }}>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 4 }}>{key.toUpperCase()} Label</label>
            <input value={form?.[labelKey] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [labelKey]: e.target.value }))}
              style={{ width: '100%', background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 7, padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font-body)', color: 'var(--ink)', outline: 'none' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 4 }}>Terms Text (shown on invoices)</label>
            <input value={form?.[textKey] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [textKey]: e.target.value }))}
              style={{ width: '100%', background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 7, padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font-body)', color: 'var(--ink)', outline: 'none' }} />
          </div>
        </div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)', margin: 0 }}>{hint}</p>
      </div>
    )
  }

  if (loading) return <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--slate)' }}>Loading…</p>
  if (!form)   return <p style={{ color: '#A32D2D' }}>{error}</p>

  return (
    <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Save bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {saved  && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--forest)', letterSpacing: '0.1em' }}>✓ Saved</span>}
        {error  && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A32D2D' }}>{error}</span>}
        <button onClick={handleSave} disabled={saving} style={{ background: 'var(--forest)', color: 'var(--white)', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* Company details */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 14 }}>Company Details</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div>{field('Company Name', 'companyName', 'Nav Solutions NZ')}</div>
          <div>{field('GST Number', 'gstNumber', 'e.g. 123-456-789')}</div>
          <div>{field('Invoice Email', 'email', 'auckland@bespoxai.com')}</div>
          <div>{field('Phone', 'phone', 'e.g. +64 9 000 0000')}</div>
          <div>{field('Website', 'website', 'bespoxai.com')}</div>
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>Address</label>
          <textarea value={form?.address ?? ''} onChange={e => setForm((f: any) => ({ ...f, address: e.target.value }))}
            placeholder="e.g. Level 1, 1 Queen Street, Auckland 1010"
            rows={2}
            style={{ width: '100%', background: 'var(--cream)', border: '1px solid var(--fog)', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--ink)', outline: 'none', resize: 'vertical', boxSizing: 'border-box' as const }} />
        </div>
        <div style={{ marginTop: 14 }}>
          {field('Invoice Footer', 'invoiceFooter', 'Thank you for choosing BespoxAI')}
        </div>
      </div>

      {/* Bank details */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>Bank Details</p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 14 }}>Shown only on bank transfer invoices.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
          <div>{field('Bank Name', 'bankName', 'e.g. ANZ')}</div>
          <div>{field('Account Name', 'bankAccountName', 'e.g. Nav Solutions NZ Ltd')}</div>
          <div>{field('Account Number', 'bankAccount', 'e.g. 01-1234-5678901-00')}</div>
        </div>
      </div>

      {/* Payment terms */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>Payment Terms</p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 14 }}>Assign terms to each tenant in the Tenants tab. Terms text appears on invoices.</p>
        {termsField('terms1', 'terms1Label', 'terms1Text', 'T1 · Default. 20% deposit on acceptance, 80% on completion. Stripe and bank transfer available for both.')}
        {termsField('terms2', 'terms2Label', 'terms2Text', 'T2 · Deposit required upfront. Balance due 20th of following month via bank transfer only.')}
        {termsField('terms3', 'terms3Label', 'terms3Text', 'T3 · No upfront payment. Full amount due 20th of following month via bank transfer only.')}
      </div>

    </div>
  )
}
