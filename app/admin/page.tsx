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

type Tab = 'overview' | 'tenants' | 'users' | 'entities' | 'signups' | 'requirements' | 'settings'

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

  function setTab(id: Tab) {
    setTabState(id)
    router.push(`/admin?tab=${id}`)
  }

  // Sync state when URL changes (back/forward navigation)
  useEffect(() => {
    const t = (searchParams.get('tab') as Tab | null) ?? 'overview'
    setTabState(t)
  }, [searchParams])
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
  const [tenantForm, setTenantForm]               = useState({ name: '', tunnelSubdomain: '', bcInstance: 'BC', bcCompany: 'CRONUS International Ltd.' })
  const [newTenantResult, setNewTenantResult]     = useState<{ apiKey: string; name: string; tenantId?: string; provisioned?: boolean } | null>(null)
  const [provisionMode, setProvisionMode]         = useState(true)   // true = auto-provision, false = manual
  const [provisionSteps, setProvisionSteps]       = useState<string[]>([])

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
  const [installerForm, setInstallerForm]         = useState({ bcUsername: '', bcPassword: '', bcPort: '8048', agentPort: '8080' })
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
    if (tab === 'signups' && !signupsLoaded) {
      setSignupsError(null)
      fetch('/api/admin/signups')
        .then(async r => {
          if (!r.ok) {
            const d = await r.json().catch(() => ({}))
            throw new Error(d.error ?? `HTTP ${r.status}`)
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
  }, [tab, signupsLoaded])

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
          agentPort:  parseInt(installerForm.agentPort) || 8080,
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
      setInstallerForm({ bcUsername: '', bcPassword: '', bcPort: '8048', agentPort: '8080' })
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
    if (res.ok) setUsers(prev => prev.filter(u => u.id !== userId))
    setConfirmDelete(null)
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
    setNewTenantResult({ apiKey: data.apiKey, name: data.tenant.name, tenantId: data.tenant.id, provisioned: provisionMode })
    setTenantForm({ name: '', tunnelSubdomain: '', bcInstance: 'BC', bcCompany: 'CRONUS International Ltd.' })
    setShowNewTenant(false)
    setSaving(false)
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
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--slate)', letterSpacing: '0.1em' }}>
      LOADING…
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'var(--font-body)' }}>

      {/* Sidebar */}
      <aside style={{ width: 220, flexShrink: 0, background: 'var(--ink)', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
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
          {([['overview', 'Overview'], ['tenants', 'Tenants'], ['users', 'Users'], ['entities', 'Entities'], ['signups', 'Signups'], ['requirements', 'Customisations'], ['settings', '⚙ AI Setup']] as [Tab, string][]).map(([id, label]) => (
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
            <button onClick={() => router.back()} style={{
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
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--cream)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--amber)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{user?.role === 'superadmin' ? 'Super Admin' : user?.role === 'tenant_admin' ? 'Admin' : 'User'}</div>
          </div>
          <button onClick={() => signOut({ callbackUrl: '/login' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(214,217,212,0.3)', fontSize: 14, padding: 4 }}>⎋</button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--cream)' }}>
        <header style={{ padding: '0 32px', height: 60, flexShrink: 0, background: 'var(--white)', borderBottom: '1px solid var(--fog)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 20, color: 'var(--ink)' }}>
            {tab === 'overview' ? 'Overview' : tab === 'tenants' ? 'Tenants' : tab === 'users' ? 'Users' : tab === 'signups' ? 'Signup Requests' : tab === 'requirements' ? 'Customisation Requests' : tab === 'settings' ? 'AI Setup' : 'Entities'}
          </h1>
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
<SuperAdminDashboard onNavigate={(t) => setTab(t as any)} />
          )}
          {/* ── Tenants tab ───────────────────────────────────────────────── */}
          {tab === 'tenants' && (
            <div style={{ maxWidth: 860 }}>
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
                      {['Tenant', 'Subdomain', 'BC Instance', 'Users', 'Queries', 'Status', ''].map(h => (
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
                        <td style={tdStyle}><StatusPill active={t.active} /></td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 8 }}>
                          {(t as any).tunnelId && (
                            <button onClick={() => { setInstallerTenantId(t.id); setInstallerError('') }} style={{ ...ghostBtn, color: 'var(--forest)' }}>↓ Installer</button>
                          )}
                          <select
                            value={(t as any).tier ?? 'trial'}
                            onChange={e => setTenantTier(t.id, e.target.value)}
                            style={{
                              background: 'var(--cream)', color: 'var(--ink)',
                              border: '1px solid var(--fog)', borderRadius: 6,
                              padding: '3px 8px', fontSize: 11,
                              fontFamily: 'var(--font-mono)', cursor: 'pointer',
                            }}
                          >
                            <option value="trial">Trial</option>
                            <option value="paid">Paid</option>
                            <option value="enterprise">Enterprise</option>
                          </select>
                          <button onClick={() => toggleTenant(t.id, t.active)} style={{ ...ghostBtn, color: t.active ? '#A32D2D' : 'var(--forest)' }}>
                            {t.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
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
            <div style={{ maxWidth: 860 }}>
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
                      </select>
                    </FormRow>
                  </div>
                </FormCard>
              )}

              <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--fog)' }}>
                      {['User', 'Email', 'Tenant', 'Role', 'Queries', 'Joined', 'Status', ''].map(h => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--fog)' }}>
                        <td style={tdStyle}><span style={{ fontWeight: 500 }}>{u.name || '—'}</span></td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{u.email}</td>
                        <td style={tdStyle}>{u.tenant.name}</td>
                        <td style={tdStyle}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 6, background: u.role === 'superadmin' ? 'rgba(200,149,42,0.12)' : 'rgba(26,146,114,0.08)', color: u.role === 'superadmin' ? 'var(--amber)' : 'var(--forest)', border: `1px solid ${u.role === 'superadmin' ? 'rgba(200,149,42,0.3)' : 'rgba(26,146,114,0.2)'}` }}>
                            {u.role === 'superadmin' ? 'Super Admin' : u.role === 'tenant_admin' ? 'Admin' : 'User'}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{u._count.queryLogs}</td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)' }}>
                          {new Date(u.createdAt).toLocaleDateString([], { dateStyle: 'short' })}
                        </td>
                        <td style={tdStyle}><StatusPill active={u.active} /></td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {u.role === 'superadmin' ? (
                              <span style={{ fontSize: 10, color: 'var(--slate)', fontStyle: 'italic' }}>🔒 protected</span>
                            ) : (
                              <>
                                <button
                                  disabled={userAction === u.id}
                                  onClick={() => toggleUserActive(u.id, u.active)}
                                  style={{ ...ghostBtn, color: u.active ? '#A32D2D' : 'var(--forest)', fontSize: 10 }}
                                >
                                  {userAction === u.id ? '…' : u.active ? 'Disable' : 'Enable'}
                                </button>
                                <button
                                  disabled={userAction === u.id}
                                  onClick={() => resetUserPassword(u.id, u.email)}
                                  style={{ ...ghostBtn, color: 'var(--slate)', fontSize: 10 }}
                                >
                                  Reset pw
                                </button>
                                <button
                                  disabled={userAction === u.id}
                                  onClick={() => setConfirmDelete(u.id)}
                                  style={{ ...ghostBtn, color: '#A32D2D', fontSize: 10 }}
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
                onClick={() => { setSignupsLoaded(false) }}
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
          <AdminRequirementsTab />
        )}

        {/* ── AI Setup tab ──────────────────────────────────────────────────── */}
        {tab === 'settings' && (
          <AISettingsTab />
        )}

        {tab === 'entities' && (
            <div style={{ maxWidth: 860 }}>
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

const btnStyle: React.CSSProperties = {
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
      border: `1px solid ${active ? 'rgba(26,146,114,0.2)' : 'rgba(163,45,45,0.2)'}`,
    }}>
      {active ? 'Active' : 'Inactive'}
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

// ─── Admin Requirements Tab ────────────────────────────────────────────────────

const STATUS_PIPELINE_ADMIN = ['draft','submitted','needs_clarification','in_review','quoted','quote_rejected','deposit_required','deposit_paid','in_development','complete_pending_payment','fully_paid','rejected']
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
  createdAt: string; updatedAt: string
  user: { name: string | null; email: string }
  tenant: { name: string }
}

function AdminRequirementsTab() {
  const { data: session } = useSession()
  const adminName  = (session?.user as any)?.name  ?? 'Admin'
  const adminEmail = (session?.user as any)?.email ?? ''
  const [reqs, setReqs]           = useState<AdminReq[]>([])
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

  async function load() {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/requirements')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setReqs(data.requirements)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  useState(() => { load() })

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
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        setDevHistory(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: err.error ?? 'Request failed' }
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
          {['submitted','in_review','quoted','approved','in_development'].map(s => {
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
                setSelected(req)
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
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0, lineHeight: 1.3, flex: 1 }}>{req.title}</p>
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
              onClick={() => { setSelected(null); setShowQF(false); setShowSB(false); setShowAiPanel(false); setDevHistory([]); setDevQuestion('') }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', marginBottom: 14, padding: 0, width: 'fit-content' }}
            >
              ← Back to list
            </button>
          <div style={{ flex: 1, background: 'var(--cream)', borderRadius: 12, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
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
                </div>
              </div>
            </div>

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
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 10 }}>
                    Consultant Q&amp;A Log ({log.length} round{log.length !== 1 ? 's' : ''})
                  </p>
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
                </div>
              )
            })()}

            {/* Description */}
            <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 8, padding: '12px 14px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>Description</p>
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
            </div>

            {/* AI Spec */}
            {spec ? (
              <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', margin: 0 }}>
                    AI Spec · {spec.complexity} · ~{spec.estimatedDays}d
                  </p>
                  <button onClick={() => generateSpec(selected.id)} disabled={genSpec} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--jade)', fontSize: 10 }}>{genSpec ? '…' : '↺ Regen'}</button>
                </div>
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
              </div>
            ) : (
              <button onClick={() => generateSpec(selected.id)} disabled={genSpec} style={{ background: 'var(--ink)', color: 'var(--cream)', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500 }}>
                {genSpec ? '✦ Generating…' : '✦ Generate AI Spec'}
              </button>
            )}

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
                {selected.consultantNote && <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginTop: 8, lineHeight: 1.6 }}>{selected.consultantNote}</p>}
                {selected.quoteApprovedAt && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--jade)', marginTop: 6 }}>✓ Approved {new Date(selected.quoteApprovedAt).toLocaleDateString('en-NZ')}</p>}
              </div>
            )}

            {/* ── AI Developer Assistant — visible during review & quoting ── */}
            {['in_review', 'quote_rejected', 'submitted'].includes(selected.status) && (
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
                                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(244,239,228,0.9)', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
                                  {msg.content}{devStreaming && i === devHistory.length - 1 && msg.content === '' ? <span style={{ opacity: 0.5 }}>▌</span> : devStreaming && i === devHistory.length - 1 ? <span style={{ opacity: 0.5 }}>▌</span> : null}
                                </p>
                                {/* Actions on last completed assistant message */}
                                {msg.role === 'assistant' && !devStreaming && i === devHistory.length - 1 && msg.content && (
                                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                    <button
                                      onClick={() => { setQuoteNote(msg.content); setShowQF(true); setShowAiPanel(false) }}
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

function AISettingsTab() {
  const [config, setConfig]   = useState<any>(null)
  const [usage, setUsage]     = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/ai-config').then(r => r.json()),
      fetch('/api/admin/ai-usage').then(r => r.json()),
    ]).then(([cfg, usg]) => {
      setConfig(cfg)
      setUsage(usg)
      setLoading(false)
    }).catch(() => { setError('Failed to load AI config'); setLoading(false) })
  }, [])

  const badge = (on: boolean) => (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 8, padding: '2px 8px', borderRadius: 6,
      background: on ? 'rgba(10,92,70,0.08)' : 'rgba(163,45,45,0.08)',
      border: `1px solid ${on ? 'rgba(10,92,70,0.2)' : 'rgba(163,45,45,0.2)'}`,
      color: on ? 'var(--forest)' : '#A32D2D', textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    }}>{on ? 'enabled' : 'disabled'}</span>
  )

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--fog)' }}>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--slate)' }}>{value}</span>
    </div>
  )

  if (loading) return <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--slate)' }}>Loading…</p>
  if (error)   return <p style={{ color: '#A32D2D' }}>{error}</p>

  return (
    <div style={{ maxWidth: 700, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Status banner */}
      <div style={{ background: config.enabled ? 'rgba(10,92,70,0.05)' : 'rgba(163,45,45,0.05)', border: `1px solid ${config.enabled ? 'rgba(10,92,70,0.2)' : 'rgba(163,45,45,0.2)'}`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 20 }}>{config.enabled ? '✦' : '○'}</span>
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: config.enabled ? 'var(--forest)' : '#A32D2D', margin: 0 }}>
            AI {config.enabled ? 'Active' : 'Disabled'}
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', margin: '2px 0 0' }}>
            Provider: <strong>{config.provider}</strong> · Model: <strong>{config.model}</strong>
            {config.provider === 'anthropic' && !config.anthropicKeySet && <span style={{ color: '#A32D2D' }}> · ⚠ ANTHROPIC_API_KEY not set</span>}
            {config.provider === 'openai' && !config.openaiKeySet && <span style={{ color: '#A32D2D' }}> · ⚠ OPENAI_API_KEY not set</span>}
          </p>
        </div>
      </div>

      {/* Current config */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>Current Configuration</p>
        {row('Master switch',    badge(config.enabled))}
        {row('Provider',         config.provider)}
        {row('Model',            config.model)}
        {row('Max tokens',       config.maxTokens)}
        {row('Temperature',      config.temperature)}
        {row('Anthropic API key', badge(config.anthropicKeySet))}
        {row('OpenAI API key',    badge(config.openaiKeySet))}
      </div>

      {/* Feature flags */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>Feature Flags</p>
        {config.features && Object.entries(config.features).map(([key, val]) => (
          row(key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()), badge(!!val))
        ))}
      </div>

      {/* Usage this month */}
      {usage && !usage.error && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>Token Usage — This Month</p>

          {/* KPI row */}
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

          {/* By tenant */}
          {usage.byTenant?.length > 0 && (
            <>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>By Tenant</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 14 }}>
                <thead>
                  <tr>{['Tenant', 'Requests', 'In tokens', 'Out tokens', 'Est. cost'].map(h => (
                    <th key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--slate)', textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid var(--fog)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {usage.byTenant.map((t: any) => (
                    <tr key={t.tenantId}>
                      <td style={{ fontFamily: 'var(--font-body)', fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--ink)' }}>{t.tenantName}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--slate)' }}>{t.requests}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--slate)' }}>{(t.inputTokens  ?? 0).toLocaleString()}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--slate)' }}>{(t.outputTokens ?? 0).toLocaleString()}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid var(--fog)', color: 'var(--jade)', fontWeight: 600 }}>${(t.estimatedUsd ?? 0).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* By feature */}
          {usage.byFeature?.length > 0 && (
            <>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>By Feature</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {usage.byFeature.map((f: any) => (
                  <div key={f.feature} style={{ background: 'var(--cream)', borderRadius: 8, padding: '8px 12px', flex: '1 1 140px' }}>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--jade)', margin: 0 }}>{f.feature.replace(/_/g, ' ')}</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: '3px 0 0' }}>{f.requests} req</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', margin: '2px 0 0' }}>{((f.inputTokens + f.outputTokens) ?? 0).toLocaleString()} tokens</p>
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

      {/* Env var reference */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 20px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>Environment Variables</p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 12 }}>
          Set these in <strong>Vercel Dashboard → Project → Settings → Environment Variables</strong>. Changes take effect on next deployment.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Variable', 'Default', 'Description'].map(h => (
                <th key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--fog)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.envVars?.map((v: any) => (
              <tr key={v.key}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink)', padding: '7px 8px', borderBottom: '1px solid var(--fog)', verticalAlign: 'top' }}>
                  {v.key}
                  {v.sensitive && <span style={{ marginLeft: 6, fontSize: 8, color: 'var(--slate)' }}>🔒</span>}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--jade)', padding: '7px 8px', borderBottom: '1px solid var(--fog)', verticalAlign: 'top' }}>{v.default ?? '—'}</td>
                <td style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', padding: '7px 8px', borderBottom: '1px solid var(--fog)', verticalAlign: 'top' }}>{v.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
