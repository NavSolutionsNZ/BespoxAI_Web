'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef } from 'react'
import React from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tenant {
  id: string; name: string; tunnelSubdomain: string; bcInstance: string
  bcCompany: string; active: boolean; country: string; entityConfig: any
  tunnelId: string | null; createdAt: string
  navProduct: string | null; navVersion: string | null; lastCU: string | null
  bcPort: number; agentPort: number
  navDatabaseServer: string | null; navDatabaseName: string | null; navServerInstance: string | null
  testNavDatabaseServer: string | null; testNavDatabaseName: string | null; testNavServerInstance: string | null
  testBcPort: number | null; testBcInstance: string | null; testBcCompany: string | null
  _debug?: boolean // ── DEBUG: remove when SETTINGS_DEBUG env var is removed ──
}
interface TenantUser {
  id: string; name: string | null; email: string; role: string; active: boolean; createdAt: string
}
type Tab = 'overview' | 'users' | 'entities' | 'installer'

const COUNTRY_OPTIONS = [
  { code: 'NZ', label: 'New Zealand' }, { code: 'AU', label: 'Australia' },
  { code: 'GB', label: 'United Kingdom' }, { code: 'US', label: 'United States' },
  { code: 'SG', label: 'Singapore' }, { code: 'MY', label: 'Malaysia' },
  { code: 'ID', label: 'Indonesia' },
]
const NAV: { id: Tab; icon: string; label: string }[] = [
  { id: 'overview',  icon: '⚙️', label: 'Overview'     },
  { id: 'users',     icon: '👥', label: 'Users'         },
  { id: 'entities',  icon: '📊', label: 'Data Entities' },
  { id: 'installer', icon: '⬇️', label: 'BC Installer'  },
]

function relTime(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function RoleBadge({ role }: { role: string }) {
  const m: Record<string, [string, string, string]> = {
    superadmin:   ['rgba(200,149,42,0.12)', 'var(--amber)',  'rgba(200,149,42,0.3)'],
    tenant_admin: ['rgba(10,92,70,0.10)',   'var(--forest)', 'rgba(10,92,70,0.3)'  ],
    user:         ['rgba(59,82,73,0.08)',   'var(--slate)',  'rgba(59,82,73,0.2)'  ],
  }
  const [bg, color, border] = m[role] ?? m.user
  const label = role === 'superadmin' ? 'Super Admin' : role === 'tenant_admin' ? 'Admin' : 'User'
  return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 6, background: bg, color, border: `1px solid ${border}` }}>{label}</span>
}

// Test environment form — full credentials + optional "use production credentials" checkbox
function TestEnvForm({ initial, onSave, onSaved, prodUsername, prodPassword, onTestCredsChange }: {
  initial: { testNavDatabaseServer: string; testNavDatabaseName: string; testNavServerInstance: string; testBcPort: string; testBcInstance: string; testBcCompany: string }
  onSave: (data: Record<string, any>) => Promise<void>
  onSaved: (vals: Record<string, string | null>) => void
  prodUsername: string
  prodPassword: string
  onTestCredsChange: (username: string, password: string) => void
}) {
  const [saving, setSaving]         = useState(false)
  const [useProdCreds, setUseProdCreds] = useState(false)
  const refs = {
    testNavDatabaseServer: useRef<HTMLInputElement>(null),
    testNavDatabaseName:   useRef<HTMLInputElement>(null),
    testNavServerInstance: useRef<HTMLInputElement>(null),
    testBcPort:            useRef<HTMLInputElement>(null),
    testBcInstance:        useRef<HTMLInputElement>(null),
    testBcCompany:         useRef<HTMLInputElement>(null),
    testBcUsername:        useRef<HTMLInputElement>(null),
    testBcPassword:        useRef<HTMLInputElement>(null),
  }
  const inp: React.CSSProperties = { width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' }
  const lbl = (text: string, required = false) => (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>
      {text}{required ? <span style={{ color: '#A32D2D' }}> *</span> : null}
    </div>
  )
  async function save() {
    setSaving(true)
    const username = useProdCreds ? prodUsername : (refs.testBcUsername.current?.value || '')
    const password = useProdCreds ? prodPassword : (refs.testBcPassword.current?.value || '')
    onTestCredsChange(username, password)
    const vals = {
      testNavDatabaseServer: refs.testNavDatabaseServer.current?.value || null,
      testNavDatabaseName:   refs.testNavDatabaseName.current?.value   || null,
      testNavServerInstance: refs.testNavServerInstance.current?.value || null,
      testBcPort:            refs.testBcPort.current?.value            || null,
      testBcInstance:        refs.testBcInstance.current?.value        || null,
      testBcCompany:         refs.testBcCompany.current?.value         || null,
    }
    await onSave(vals)
    onSaved(vals)
    setSaving(false)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>{lbl('Test Database Server')}<input ref={refs.testNavDatabaseServer} style={inp} type="text" defaultValue={initial.testNavDatabaseServer} placeholder="localhost" /></div>
        <div>{lbl('Test Database Name', true)}<input ref={refs.testNavDatabaseName} style={inp} type="text" defaultValue={initial.testNavDatabaseName} placeholder="e.g. Dynamics NAV 2017 Test" /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>{lbl('Test Server Instance')}<input ref={refs.testNavServerInstance} style={inp} type="text" defaultValue={initial.testNavServerInstance} placeholder="e.g. DynamicsNAV110_Test" /></div>
        <div>{lbl('Test BC Instance')}<input ref={refs.testBcInstance} style={inp} type="text" defaultValue={initial.testBcInstance} placeholder="e.g. BC_Test" /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>{lbl('Test BC Company')}<input ref={refs.testBcCompany} style={inp} type="text" defaultValue={initial.testBcCompany} placeholder="e.g. Cronus NZ Test" /></div>
        <div>{lbl('Test BC OData Port')}<input ref={refs.testBcPort} style={inp} type="number" defaultValue={initial.testBcPort} placeholder="e.g. 7048" /></div>
      </div>
      <div style={{ borderTop: '1px solid rgba(10,92,70,0.15)', paddingTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
          <input type="checkbox" checked={useProdCreds} onChange={e => setUseProdCreds(e.target.checked)} style={{ accentColor: 'var(--forest)', width: 14, height: 14 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)' }}>Use production credentials</span>
        </label>
        {!useProdCreds && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>{lbl('Test Username')}<input ref={refs.testBcUsername} style={inp} type="text" placeholder="DOMAIN\username" /></div>
            <div>{lbl('Test Password')}<input ref={refs.testBcPassword} style={inp} type="password" placeholder="" /></div>
          </div>
        )}
      </div>
      <div><button onClick={save} disabled={saving} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--forest)', color: 'var(--white)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save Test Environment'}</button></div>
    </div>
  )
}

export default function SettingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [tab,          setTab]          = useState<Tab>('overview')
  const [tenant,       setTenant]       = useState<Tenant | null>(null)
  const [users,        setUsers]        = useState<TenantUser[]>([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [toast,        setToast]        = useState<{ msg: string; ok: boolean } | null>(null)
  const [country,      setCountry]      = useState('NZ')
  const [health,       setHealth]       = useState<{ status: 'checking' | 'ok' | 'error'; ms: number | null }>({ status: 'checking', ms: null })
  const [instForm,     setInstForm]     = useState({ bcUsername: '', bcPassword: '', bcPort: '8048', agentPort: '8080', bcInstance: '', bcCompany: '', navDatabaseServer: 'localhost', navDatabaseName: '', navServerInstance: '', testBcUsername: '', testBcPassword: '', testServerSeparate: false, testAgentUrl: '', testTunnelToken: '' })
  const [testEnv,      setTestEnv]      = useState({ testNavDatabaseServer: '', testNavDatabaseName: '', testNavServerInstance: '', testBcPort: '', testBcInstance: '', testBcCompany: '' })
  const [instLoading,  setInstLoading]  = useState(false)
  const [inviteForm,   setInviteForm]   = useState({ email: '', name: '', role: 'user' })
  const [inviteResult, setInviteResult] = useState<{ tempPassword: string; email: string } | null>(null)
  const [resetResult,  setResetResult]  = useState<{ id: string; tempPassword: string } | null>(null)
  const [entityConfig, setEntityConfig] = useState<Record<string, boolean>>({})
  const [entitySaving, setEntitySaving] = useState(false)

  const user       = session?.user as any
  const role       = user?.role as string ?? ''
  const initials   = (user?.name ?? user?.email ?? '?').split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()
  const tenantName = user?.tenantName ?? tenant?.name ?? '…'

  const toast$ = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500) }

  useEffect(() => {
    if (status === 'loading') return
    if (!session) { router.push('/login'); return }
    if (role !== 'tenant_admin' && role !== 'superadmin') router.push('/dashboard')
  }, [status, session, role])

  useEffect(() => {
    if (!session) return
    Promise.all([fetch('/api/settings').then(r => r.json()), fetch('/api/settings/users').then(r => r.json())])
      .then(([td, ud]) => {
        const t = td.tenant ?? null
        setTenant(t); setCountry(t?.country ?? 'NZ')
        setEntityConfig(t?.entityConfig ?? {}); setUsers(ud.users ?? [])
        if (t?.bcPort)              setInstForm(f => ({ ...f, bcPort:              String(t.bcPort)            }))
        if (t?.agentPort)           setInstForm(f => ({ ...f, agentPort:           String(t.agentPort)         }))
        if (t?.bcInstance)          setInstForm(f => ({ ...f, bcInstance:          t.bcInstance                }))
        if (t?.navDatabaseServer)   setInstForm(f => ({ ...f, navDatabaseServer:   t.navDatabaseServer         }))
        if (t?.navDatabaseName)     setInstForm(f => ({ ...f, navDatabaseName:     t.navDatabaseName           }))
        if (t?.navServerInstance)   setInstForm(f => ({ ...f, navServerInstance:   t.navServerInstance         }))
        if (t?.testServerSeparate)  setInstForm(f => ({ ...f, testServerSeparate:  t.testServerSeparate        }))
        if (t?.testAgentUrl)        setInstForm(f => ({ ...f, testAgentUrl:        t.testAgentUrl              }))
        if (t?.testTunnelToken)     setInstForm(f => ({ ...f, testTunnelToken:     t.testTunnelToken           }))
        setTestEnv({
          testNavDatabaseServer: t?.testNavDatabaseServer ?? '',
          testNavDatabaseName:   t?.testNavDatabaseName   ?? '',
          testNavServerInstance: t?.testNavServerInstance ?? '',
          testBcPort:            t?.testBcPort ? String(t.testBcPort) : '',
          testBcInstance:        t?.testBcInstance        ?? '',
          testBcCompany:         t?.testBcCompany         ?? '',
        })
        if (t?.bcCompany)  setInstForm(f => ({ ...f, bcCompany:  t.bcCompany         }))
        setLoading(false)
      }).catch(() => setLoading(false))
  }, [session])

  useEffect(() => {
    if (!session) return
    const check = async () => {
      const t0 = Date.now()
      try { const r = await fetch('/api/health'); const d = await r.json(); setHealth({ status: d.ok ? 'ok' : 'error', ms: Date.now() - t0 }) }
      catch { setHealth({ status: 'error', ms: null }) }
    }
    check(); const iv = setInterval(check, 60000); return () => clearInterval(iv)
  }, [session])

  async function saveCountry() { setSaving(true); const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ country }) }); setSaving(false); toast$(r.ok ? 'Country updated' : 'Failed', r.ok) }
  async function saveSystemConfig(data: Record<string, any>) { const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); toast$(r.ok ? 'Saved' : 'Failed', r.ok) }
  async function saveEntities() { setEntitySaving(true); const r = await fetch('/api/settings/entities', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityConfig }) }); setEntitySaving(false); toast$(r.ok ? 'Saved' : 'Failed', r.ok) }

  async function inviteUser() {
    if (!inviteForm.email) return
    const r = await fetch('/api/settings/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteForm.email, name: inviteForm.name, userRole: inviteForm.role }) })
    const d = await r.json()
    if (r.ok) { setInviteResult({ tempPassword: d.tempPassword, email: d.user.email }); setUsers(p => [...p, d.user]); setInviteForm({ email: '', name: '', role: 'user' }) }
    else toast$(d.error ?? 'Failed', false)
  }

  async function userAction(id: string, action: 'disable' | 'enable' | 'reset' | 'promote' | 'demote') {
    const r = await fetch(`/api/settings/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    const d = await r.json()
    if (r.ok) {
      if (action === 'reset') setResetResult({ id, tempPassword: d.tempPassword })
      setUsers(p => p.map(u => {
        if (u.id !== id) return u
        return {
          ...u,
          active: action === 'enable' ? true : action === 'disable' ? false : u.active,
          role:   action === 'promote' ? 'tenant_admin' : action === 'demote' ? 'user' : u.role,
        }
      }))
      toast$(action === 'reset' ? 'Password reset' : action === 'promote' ? 'Promoted to Admin' : action === 'demote' ? 'Demoted to User' : `User ${action}d`)
    } else toast$(d.error ?? 'Failed', false)
  }

  async function deleteUser(id: string) {
    if (!confirm('Delete this user? Cannot be undone.')) return
    const r = await fetch(`/api/settings/users/${id}`, { method: 'DELETE' })
    if (r.ok) { setUsers(p => p.filter(u => u.id !== id)); toast$('User deleted') } else toast$('Failed', false)
  }

  async function downloadInstaller() {
    if (!instForm.bcUsername || !instForm.bcPassword) { toast$('BC username and password required', false); return }
    setInstLoading(true)
    // Persist port values to tenant so they're remembered
    await saveSystemConfig({ bcPort: instForm.bcPort, agentPort: instForm.agentPort })
    try {
      const r = await fetch('/api/settings/installer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...instForm, testBcUsername: instForm.testBcUsername, testBcPassword: instForm.testBcPassword }) })
      if (!r.ok) { toast$('Generation failed', false); setInstLoading(false); return }
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: 'BespoxAI-Installer.zip' })
      a.click(); URL.revokeObjectURL(a.href)
    } catch { toast$('Download failed', false) }
    setInstLoading(false)
  }

  if (loading || status === 'loading') return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.4)' }}>Loading…</span>
    </div>
  )

  const selfId = user?.id
  const hOk = health.status === 'ok', hErr = health.status === 'error'
  const hColor = hOk ? 'var(--jade)' : hErr ? '#E24B4A' : 'rgba(214,217,212,0.4)'

  // ─── Shared sub-components ────────────────────────────────────────────────
  const Label = ({ children }: { children: string }) => (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 14 }}>{children}</div>
  )
  const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ background: 'var(--white)', borderRadius: 14, padding: '24px 28px', border: '1px solid var(--fog)', marginBottom: 16, ...style }}>{children}</div>
  )
  const Btn = ({ onClick, disabled, full, children }: { onClick: () => void; disabled?: boolean; full?: boolean; children: React.ReactNode }) => (
    <button onClick={onClick} disabled={disabled} style={{ background: 'var(--forest)', color: '#fff', border: 'none', borderRadius: 8, padding: full ? '11px' : '8px 20px', width: full ? '100%' : undefined, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-body)', fontSize: full ? 14 : 13, fontWeight: 500, opacity: disabled ? 0.6 : 1 }}>{children}</button>
  )
  const FieldInput = ({ label, field, type, placeholder, obj, set }: any) => (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>{label}</div>
      <input type={type} placeholder={placeholder} value={obj[field]} onChange={e => set((f: any) => ({ ...f, [field]: e.target.value }))}
        style={{ width: '100%', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }}
        onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'var(--font-body)' }}>

      {/* ── DEBUG BANNER — remove when SETTINGS_DEBUG env var is removed ── */}
      {tenant?._debug && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, background: '#C8952A', color: '#fff', padding: '6px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>🧪 DEBUG MODE — SETTINGS_DEBUG=true — mock data only — remove env var before production</span>
          <span style={{ marginLeft: 'auto', opacity: 0.7 }}>API routes return mock responses · DB not touched · installer generates dummy zip</span>
        </div>
      )}
      {/* ── END DEBUG BANNER ── */}

      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, background: toast.ok ? 'var(--forest)' : '#A32D2D', color: '#fff', padding: '10px 18px', borderRadius: 10, fontFamily: 'var(--font-body)', fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,0.25)' }}>{toast.msg}</div>}

      {/* ── Sidebar ── */}
      <aside style={{ width: 240, flexShrink: 0, background: 'var(--ink)', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.04)' }}>

        {/* Logo + health */}
        <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 22, color: 'var(--cream)', letterSpacing: '-0.3px' }}>Bespox</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 17, color: 'var(--amber)', letterSpacing: '0.04em', marginLeft: 3 }}>AI</span>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, background: hOk ? 'rgba(10,92,70,0.25)' : hErr ? 'rgba(163,45,45,0.2)' : 'rgba(100,100,100,0.15)', border: `1px solid ${hOk ? 'rgba(10,92,70,0.4)' : hErr ? 'rgba(163,45,45,0.35)' : 'rgba(100,100,100,0.25)'}`, borderRadius: 12, padding: '4px 10px' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: hColor }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: hColor }}>
              {tenantName} · {hOk ? 'Live' : hErr ? 'Offline' : '···'}
            </span>
          </div>
        </div>

        <div style={{ padding: '18px 20px 8px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.3)' }}>Settings</span>
        </div>

        <nav style={{ flex: 1, padding: '0 10px' }}>
          {NAV.map(item => {
            const active = tab === item.id
            return (
              <button key={item.id} onClick={() => setTab(item.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, marginBottom: 2, border: 'none', background: active ? 'rgba(10,92,70,0.3)' : 'transparent', cursor: 'pointer', transition: 'background 0.15s', textAlign: 'left' }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                <span style={{ fontSize: 14 }}>{item.icon}</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: active ? 600 : 400, color: active ? 'var(--cream)' : 'rgba(214,217,212,0.55)' }}>{item.label}</span>
                {active && <div style={{ marginLeft: 'auto', width: 3, height: 3, borderRadius: '50%', background: 'var(--jade)' }} />}
              </button>
            )
          })}

          <div style={{ margin: '12px 10px', borderTop: '1px solid rgba(255,255,255,0.06)' }} />
          <button onClick={() => router.back()}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <span style={{ fontSize: 13 }}>←</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(214,217,212,0.45)' }}>Back to Dashboard</span>
          </button>
        </nav>

        {/* User row */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, var(--jade), var(--forest))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: 'var(--cream)' }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--cream)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name ?? user?.email}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(214,217,212,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{role.replace('_', ' ')}</div>
          </div>
          <button onClick={() => signOut({ callbackUrl: '/login' })} title="Sign out"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(214,217,212,0.3)', fontSize: 15, padding: 4, lineHeight: 1, transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--fog)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(214,217,212,0.3)')}>↪</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, overflowY: 'auto', background: 'var(--cream)', paddingTop: tenant?._debug ? 32 : 0 }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 32px' }}>

          {/* Overview */}
          {tab === 'overview' && <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, color: 'var(--ink)', marginBottom: 28 }}>Overview</h1>
            <Card>
              <Label>BC Connection</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 40px' }}>
                {([['Tenant Name', tenant?.name], ['BC Instance', tenant?.bcInstance], ['BC Company', tenant?.bcCompany], ['Agent URL', `https://${tenant?.tunnelSubdomain}-agent.bespoxai.com`], ['Status', hOk ? `Connected · ${health.ms}ms` : hErr ? 'Offline' : 'Checking…'], ['Member Since', tenant ? relTime(tenant.createdAt) : '—']] as [string, string|undefined][]).map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>{k}</div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)' }}>{v ?? '—'}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <Label>System Configuration</Label>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', marginBottom: 18, lineHeight: 1.65 }}>Your BC or NAV version details help us tailor compatibility checks and support.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Product</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px' }}>
                    {tenant?.navProduct === 'BC' ? 'Business Central' : tenant?.navProduct === 'NAV' ? 'Microsoft NAV' : tenant?.navProduct === 'unsure' ? 'Not sure' : 'Not specified'}
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Last CU</div>
                  <input type="text" defaultValue={tenant?.lastCU ?? ''} placeholder="e.g. CU3" onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ lastCU: e.target.value }) }} style={{ width: '100%', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} onFocus={e => (e.target.style.borderColor = 'var(--forest)')} />
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>OData / Agent Ports</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', minWidth: 80, textAlign: 'center' as const }}>{tenant?.bcPort ?? 8048}</span>
                  <span style={{ color: 'var(--fog)', fontSize: 14 }}>·</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', minWidth: 80, textAlign: 'center' as const }}>{tenant?.agentPort ?? 8080}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)' }}>To change ports, update them in the <strong>BC Installer</strong> tab and reinstall BCAgent.</span>
                </div>
              </div>
            </Card>

            {/* Test Environment — NAV/BC14 only */}
            {(tenant?.navProduct === 'NAV' || tenant?.navProduct === 'BC') && (
              <Card>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>Test Environment</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 16, lineHeight: 1.55 }}>
                  Used for pre-production deployment and UAT. Leave blank to use the same server as production. Details are injected into the BCAgent installer.
                </p>
                {/* Read-only reference — edit in BC Installer tab */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { label: 'Test Database Server',   val: tenant?.testNavDatabaseServer },
                    { label: 'Test Database Name',     val: tenant?.testNavDatabaseName   },
                    { label: 'Test Server Instance',   val: tenant?.testNavServerInstance },
                    { label: 'Test BC Port',           val: tenant?.testBcPort ? String(tenant.testBcPort) : null },
                    { label: 'Test BC Instance',       val: tenant?.testBcInstance },
                    { label: 'Test BC Company',        val: tenant?.testBcCompany },
                  ].map(({ label, val }) => val ? (
                    <div key={label} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', minWidth: 160 }}>{label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 6, padding: '4px 10px' }}>{val}</span>
                    </div>
                  ) : null)}
                  {!tenant?.testNavDatabaseName && (
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', margin: 0 }}>No test environment configured.</p>
                  )}
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', margin: 0 }}>To configure, go to the <strong>BC Installer</strong> tab.</p>
                </div>
                {false && <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Test Database Server</div>
                    <input type="text" value={testEnv.testNavDatabaseServer} placeholder="localhost (defaults to production server)"
                      onChange={e => setTestEnv(f => ({ ...f, testNavDatabaseServer: e.target.value }))}
                      onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ testNavDatabaseServer: e.target.value }) }}
                      onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                      style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Test Database Name <span style={{ color: '#A32D2D' }}>*</span></div>
                    <input type="text" value={testEnv.testNavDatabaseName} placeholder="e.g. Dynamics NAV 2017 Test"
                      onChange={e => setTestEnv(f => ({ ...f, testNavDatabaseName: e.target.value }))}
                      onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ testNavDatabaseName: e.target.value }) }}
                      onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                      style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Test Server Instance <span style={{ fontFamily: 'var(--font-body)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>(optional)</span></div>
                    <input type="text" value={testEnv.testNavServerInstance} placeholder="e.g. DynamicsNAV110_Test"
                      onChange={e => setTestEnv(f => ({ ...f, testNavServerInstance: e.target.value }))}
                      onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ testNavServerInstance: e.target.value }) }}
                      onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                      style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} />
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Test BC Port <span style={{ fontFamily: 'var(--font-body)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>(OData, optional)</span></div>
                      <input type="number" value={testEnv.testBcPort} placeholder="e.g. 7048"
                        onChange={e => setTestEnv(f => ({ ...f, testBcPort: e.target.value }))}
                        onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; if (e.target.value) await saveSystemConfig({ testBcPort: e.target.value }) }}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Test BC Company <span style={{ fontFamily: 'var(--font-body)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>(optional)</span></div>
                      <input type="text" value={testEnv.testBcCompany} placeholder="e.g. Cronus NZ Test"
                        onChange={e => setTestEnv(f => ({ ...f, testBcCompany: e.target.value }))}
                        onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ testBcCompany: e.target.value }) }}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                  </div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', margin: 0 }}>saved on blur · injected into BCAgent installer</p>
                </div>}
              </Card>
            )}
            <Card>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', marginBottom: 18, lineHeight: 1.65 }}>Sets the tax, accounting, and compliance context for AI responses — GST rates, VAT rules, and local reporting standards.</p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select value={country} onChange={e => setCountry(e.target.value)} style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', outline: 'none' }}>
                  {COUNTRY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
                <Btn onClick={saveCountry} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
              </div>
            </Card>
          </>}

          {/* Users */}
          {tab === 'users' && <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, color: 'var(--ink)', marginBottom: 28 }}>Users</h1>
            <Card>
              <Label>Invite User</Label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {([['Email', 'email', 'email'], ['Name (optional)', 'name', 'text']] as [string,string,string][]).map(([label, field, type]) => (
                  <div key={field}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>{label}</div>
                    <input type={type} value={(inviteForm as any)[field]} onChange={e => setInviteForm(f => ({ ...f, [field]: e.target.value }))}
                      style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '7px 12px', outline: 'none', width: 190 }}
                      onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
                  </div>
                ))}
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Role</div>
                  <select value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))} style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', outline: 'none' }}>
                    <option value="user">User</option>
                    <option value="tenant_admin">Admin</option>
                  </select>
                </div>
                <Btn onClick={inviteUser}>Invite</Btn>
              </div>
              {inviteResult && (
                <div style={{ marginTop: 16, background: 'rgba(26,146,114,0.08)', border: '1px solid rgba(26,146,114,0.25)', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--jade)', marginBottom: 6 }}>User created — copy credentials now</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)' }}>{inviteResult.email} · <span style={{ fontFamily: 'var(--font-mono)' }}>{inviteResult.tempPassword}</span></div>
                  <button onClick={() => setInviteResult(null)} style={{ marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Dismiss</button>
                </div>
              )}
            </Card>
            {resetResult && (
              <div style={{ background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--amber)', marginBottom: 6 }}>New temp password — shown once</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)' }}>{resetResult.tempPassword}</div>
                <button onClick={() => setResetResult(null)} style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Dismiss</button>
              </div>
            )}
            <div style={{ background: 'var(--white)', borderRadius: 14, border: '1px solid var(--fog)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--parchment)' }}>{['Name','Email','Role','Status','Joined','Actions'].map(h => <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', fontWeight: 500 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderTop: '1px solid var(--fog)' }}>
                      <td style={{ padding: '11px 16px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)' }}>{u.name || '—'}</td>
                      <td style={{ padding: '11px 16px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)' }}>{u.email}</td>
                      <td style={{ padding: '11px 16px' }}><RoleBadge role={u.role} /></td>
                      <td style={{ padding: '11px 16px' }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 6, background: u.active ? 'rgba(26,146,114,0.1)' : 'rgba(163,45,45,0.1)', color: u.active ? 'var(--jade)' : '#A32D2D', border: `1px solid ${u.active ? 'rgba(26,146,114,0.25)' : 'rgba(163,45,45,0.2)'}` }}>{u.active ? 'Active' : 'Disabled'}</span></td>
                      <td style={{ padding: '11px 16px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)' }}>{relTime(u.createdAt)}</td>
                      <td style={{ padding: '11px 16px' }}>
                        {u.id !== selfId && <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => userAction(u.id, u.active ? 'disable' : 'enable')} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: u.active ? '#A32D2D' : 'var(--jade)', background: 'none', border: `1px solid ${u.active ? 'rgba(163,45,45,0.3)' : 'rgba(26,146,114,0.3)'}`, borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>{u.active ? 'Disable' : 'Enable'}</button>
                          {u.role === 'user'
                            ? <button onClick={() => userAction(u.id, 'promote')} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--forest)', background: 'none', border: '1px solid rgba(10,92,70,0.3)', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>→ Admin</button>
                            : u.role === 'tenant_admin'
                            ? <button onClick={() => userAction(u.id, 'demote')} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', background: 'none', border: '1px solid var(--fog)', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>→ User</button>
                            : null}
                          <button onClick={() => userAction(u.id, 'reset')} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', background: 'none', border: '1px solid var(--fog)', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>Reset pw</button>
                          <button onClick={() => deleteUser(u.id)} style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#A32D2D', background: 'none', border: 'none', padding: '3px 4px', cursor: 'pointer' }}>✕</button>
                        </div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>}

          {/* Entities */}
          {tab === 'entities' && <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, color: 'var(--ink)', margin: 0 }}>Data Entities</h1>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={async () => {
                  setEntitySaving(true)
                  const r = await fetch('/api/settings/discover', { method: 'POST' })
                  const d = await r.json()
                  if (r.ok) { setEntityConfig(d.entityConfig ?? {}); toast$(`Discovered ${d.discovered} entities, ${d.enabled} enabled`) }
                  else toast$(d.error ?? 'Discovery failed', false)
                  setEntitySaving(false)
                }} disabled={entitySaving}
                  style={{ background: 'none', color: 'var(--forest)', border: '1px solid var(--forest)', borderRadius: 8, padding: '8px 16px', cursor: entitySaving ? 'default' : 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, opacity: entitySaving ? 0.6 : 1 }}>
                  {entitySaving ? 'Working…' : '⟳ Discover from BC'}
                </button>
                <Btn onClick={saveEntities} disabled={entitySaving}>{entitySaving ? 'Saving…' : 'Save Changes'}</Btn>
              </div>
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', marginBottom: 20, lineHeight: 1.65 }}>Enable or disable which Business Central entities the AI assistant can query. Disabled entities are excluded from the planner.</p>
            <div style={{ background: 'var(--white)', borderRadius: 14, border: '1px solid var(--fog)', overflow: 'hidden' }}>
              {Object.keys(entityConfig).length === 0
                ? <div style={{ padding: 40, textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)' }}>No entity configuration found. Ask your administrator to run entity discovery.</div>
                : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ background: 'var(--parchment)' }}>{['Entity','Enabled'].map(h => <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', fontWeight: 500 }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {Object.entries(entityConfig).sort(([a],[b]) => a.localeCompare(b)).map(([entity, enabled]) => (
                        <tr key={entity} style={{ borderTop: '1px solid var(--fog)' }}>
                          <td style={{ padding: '10px 20px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)' }}>{entity}</td>
                          <td style={{ padding: '10px 20px' }}>
                            <button onClick={() => setEntityConfig(c => ({ ...c, [entity]: !enabled }))} style={{ width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', background: enabled ? 'var(--jade)' : 'var(--fog)', position: 'relative', transition: 'background 0.2s' }}>
                              <div style={{ position: 'absolute', top: 3, left: enabled ? 18 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>}
            </div>
          </>}

          {/* Installer */}
          {tab === 'installer' && <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, color: 'var(--ink)', marginBottom: 10 }}>BC Agent Installer</h1>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', marginBottom: 28, lineHeight: 1.65 }}>Download a pre-configured installer for the BespoxAI BCAgent. Run it on the Windows Server hosting Business Central — it installs the agent, configures the Cloudflare tunnel, and starts the service automatically.</p>

            <Card style={{ background: 'rgba(200,149,42,0.06)', border: '1px solid rgba(200,149,42,0.25)' }}>
              <Label>Production Environment</Label>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 18, lineHeight: 1.6 }}>Production BC connection details. Instance, company and database fields are saved — credentials are embedded in the installer only and never stored.</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>Database Server</div>
                  <input type="text" placeholder="localhost" value={instForm.navDatabaseServer}
                    onChange={e => setInstForm(f => ({ ...f, navDatabaseServer: e.target.value }))}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ navDatabaseServer: e.target.value || 'localhost' }) }} />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>Database Name</div>
                  <input type="text" placeholder="e.g. Dynamics NAV 2017" value={instForm.navDatabaseName}
                    onChange={e => setInstForm(f => ({ ...f, navDatabaseName: e.target.value }))}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ navDatabaseName: e.target.value }) }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>Server Instance</div>
                  <input type="text" placeholder="e.g. DynamicsNAV110" value={instForm.navServerInstance}
                    onChange={e => setInstForm(f => ({ ...f, navServerInstance: e.target.value }))}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ navServerInstance: e.target.value }) }} />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>BC Instance Name</div>
                  <input type="text" placeholder="e.g. BC" value={instForm.bcInstance}
                    onChange={e => setInstForm(f => ({ ...f, bcInstance: e.target.value }))}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; if (e.target.value) await saveSystemConfig({ bcInstance: e.target.value }) }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>BC Company Name</div>
                  <input type="text" placeholder="e.g. CRONUS International Ltd." value={instForm.bcCompany}
                    onChange={e => setInstForm(f => ({ ...f, bcCompany: e.target.value }))}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; if (e.target.value) await saveSystemConfig({ bcCompany: e.target.value }) }} />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>BC OData Port · default 8048</div>
                  <input type="number" value={instForm.bcPort}
                    onChange={e => setInstForm(f => ({ ...f, bcPort: e.target.value }))}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ bcPort: e.target.value }) }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>BC Username</div>
                  <input type="text" placeholder="DOMAIN\username" value={instForm.bcUsername}
                    onChange={e => setInstForm(f => ({ ...f, bcUsername: e.target.value }))}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
                  <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>Windows / BC service account with OData access.</p>
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>BC Password</div>
                  <input type="password" placeholder="" value={instForm.bcPassword}
                    onChange={e => setInstForm(f => ({ ...f, bcPassword: e.target.value }))}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
                  <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>Never stored — embedded in installer only.</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Agent Port · default 8080</div>
                  <input type="number" value={instForm.agentPort}
                    onChange={e => setInstForm(f => ({ ...f, agentPort: e.target.value }))}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }}
                    onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ agentPort: e.target.value }) }} />
                </div>
              </div>
            </Card>

            {(tenant?.navProduct === 'NAV' || tenant?.navProduct === 'BC') && (
              <Card style={{ background: 'rgba(10,92,70,0.06)', border: '1px solid rgba(10,92,70,0.25)' }}>
                <Label>Test Environment</Label>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 16, lineHeight: 1.55 }}>
                  Used for pre-production deployment and UAT. These details will be included the next time you generate the installer below.
                </p>
                <TestEnvForm
                  key={tenant?.id ?? 'testenv'}
                  initial={testEnv}
                  onSave={saveSystemConfig}
                  onSaved={vals => setTestEnv(prev => ({ ...prev, ...Object.fromEntries(Object.entries(vals).map(([k,v]) => [k, v ?? ''])) }))}
                  prodUsername={instForm.bcUsername}
                  prodPassword={instForm.bcPassword}
                  onTestCredsChange={(u, p) => setInstForm(f => ({ ...f, testBcUsername: u, testBcPassword: p }))}
                />
              </Card>
            )}

            <Card>
              <Label>Separate Test Server</Label>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 16, lineHeight: 1.55 }}>
                If your test environment is on a separate server, enable this to configure a dedicated BCAgent for it.
                The test agent handles deployment and compilation only — no object export or health polling.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: instForm.testServerSeparate ? 16 : 0 }}>
                <input type="checkbox" checked={instForm.testServerSeparate}
                  onChange={async e => {
                    const val = e.target.checked
                    setInstForm(f => ({ ...f, testServerSeparate: val }))
                    await saveSystemConfig({ testServerSeparate: val })
                  }}
                  style={{ accentColor: 'var(--forest)', width: 14, height: 14 }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)' }}>Test environment is on a separate server</span>
              </label>
              {instForm.testServerSeparate && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Test Agent URL</div>
                    <input type="text" placeholder="e.g. http://test-server:8080" value={instForm.testAgentUrl}
                      onChange={e => setInstForm(f => ({ ...f, testAgentUrl: e.target.value }))}
                      style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }}
                      onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                      onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ testAgentUrl: e.target.value }) }} />
                    <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>URL of the BCAgent running on the test server. Set after installing the test agent below.</p>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Cloudflare Tunnel Token (test server)</div>
                    <input type="password" placeholder="" value={instForm.testTunnelToken}
                      onChange={e => setInstForm(f => ({ ...f, testTunnelToken: e.target.value }))}
                      style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }}
                      onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                      onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; await saveSystemConfig({ testTunnelToken: e.target.value }) }} />
                    <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>From your Cloudflare Zero Trust dashboard — separate tunnel for the test server.</p>
                  </div>
                  <div style={{ background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.25)', borderRadius: 10, padding: '12px 16px' }}>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--amber)', margin: 0 }}>
                      ✦ Separate test server installer generation is coming soon. Once your details are saved above, contact BespoxAI and we will configure the test agent installer for you.
                    </p>
                  </div>
                </div>
              )}
            </Card>

            <button onClick={downloadInstaller} disabled={instLoading} style={{ marginTop: 8, width: '100%', background: 'var(--forest)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', cursor: instLoading ? 'default' : 'pointer', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500, opacity: instLoading ? 0.7 : 1 }}>
              {instLoading ? 'Generating…' : '⬇ Download Installer (.zip)'}
            </button>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginTop: 10, lineHeight: 1.5, textAlign: 'center' }}>BC credentials are embedded in the installer and never stored by BespoxAI.</p>
          </>}

        </div>
      </main>
    </div>
  )
}
