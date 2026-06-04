'use client'
import type { BrandingConfig } from '@/lib/branding'
import { DEFAULT_BRANDING } from '@/lib/branding'
export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef, Suspense } from 'react'
import React from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tenant {
  id: string; name: string; tunnelSubdomain: string; bcInstance: string
  bcCompany: string; active: boolean; country: string; entityConfig: any
  tunnelId: string | null; createdAt: string
  navProduct: string | null; navVersion: string | null; lastCU: string | null
  bcPort: number; agentPort: number
  navDatabaseServer: string | null; navDatabaseName: string | null; navServerInstance: string | null; navManagementPort: number | null
  testNavDatabaseServer: string | null; testNavDatabaseName: string | null; testNavServerInstance: string | null
  testBcPort: number | null; testBcInstance: string | null; testBcCompany: string | null; testAgentPort: number | null; testNavManagementPort: number | null
  bcUsername: string | null
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

const sharedInp: React.CSSProperties = { width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' }

// Test environment form — same-server setup only (separate server handled below)


// ─── Shared sub-components (module-level so their references are stable across
// SettingsInner re-renders — defining them inside the component caused React to
// see a new function type on every render and unmount/remount all children) ───
function Label({ children }: { children: string }) {
  return <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 14 }}>{children}</div>
}
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: 'var(--white)', borderRadius: 14, padding: '24px 28px', border: '1px solid var(--fog)', marginBottom: 16, ...style }}>{children}</div>
}
function ChangePasswordCard() {
  const [open,    setOpen]    = useState(false)
  const [current, setCurrent] = useState('')
  const [next,    setNext]    = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const inp: React.CSSProperties = { width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' }
  async function save() {
    setMsg(null)
    if (next.length < 8)   { setMsg({ ok: false, text: 'Password must be at least 8 characters.' }); return }
    if (next !== confirm)   { setMsg({ ok: false, text: 'Passwords do not match.' }); return }
    setSaving(true)
    try {
      const res = await fetch('/api/settings/profile/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const data = await res.json()
      if (!res.ok) { setMsg({ ok: false, text: data.error ?? 'Failed to change password.' }); return }
      setMsg({ ok: true, text: 'Password changed.' })
      setCurrent(''); setNext(''); setConfirm(''); setOpen(false)
    } catch { setMsg({ ok: false, text: 'Something went wrong.' }) }
    finally { setSaving(false) }
  }
  return (
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--fog)' }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', padding: 0 }}>
        {open ? '▲ Hide' : '▼ Change Password'}
      </button>
      {msg ? <span style={{ marginLeft: 12, fontFamily: 'var(--font-mono)', fontSize: 9, color: msg.ok ? 'var(--forest)' : '#A32D2D' }}>{msg.text}</span> : null}
      {open && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Current Password</div><input type="password" value={current} onChange={e => setCurrent(e.target.value)} style={inp} /></div>
          <div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>New Password</div><input type="password" value={next} onChange={e => setNext(e.target.value)} style={inp} /></div>
          <div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>Confirm New Password</div><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inp} onKeyDown={e => { if (e.key === 'Enter') save() }} /></div>
          <button onClick={save} disabled={saving} style={{ alignSelf: 'flex-start', background: 'var(--forest)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Update Password'}
          </button>
        </div>
      )}
    </div>
  )
}
function Btn({ onClick, disabled, full, children }: { onClick: () => void; disabled?: boolean; full?: boolean; children: React.ReactNode }) {
  return <button onClick={onClick} disabled={disabled} style={{ background: 'var(--forest)', color: '#fff', border: 'none', borderRadius: 8, padding: full ? '11px' : '8px 20px', width: full ? '100%' : undefined, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-body)', fontSize: full ? 14 : 13, fontWeight: 500, opacity: disabled ? 0.6 : 1 }}>{children}</button>
}
function FieldInput({ label, field, type, placeholder, obj, set }: any) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>{label}</div>
      <input type={type} placeholder={placeholder} value={obj[field]} onChange={e => set((f: any) => ({ ...f, [field]: e.target.value }))}
        style={{ width: '100%', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }}
        onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
    </div>
  )
}

function SettingsInner() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<Tab>('overview')
  useEffect(() => { const t = searchParams.get('tab'); const isMgdByPartner = !!(session?.user as any)?.managedByPartner; if (t === 'installer' || t === 'overview' || t === 'users' || t === 'entities') { if (t === 'installer' && isMgdByPartner) { router.replace('/settings?tab=overview'); return } setTab(t as Tab) } else router.replace('/settings?tab=overview') }, [searchParams, session])
  const [tenant,       setTenant]       = useState<Tenant | null>(null)
  const [users,        setUsers]        = useState<TenantUser[]>([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [toast,        setToast]        = useState<{ msg: string; ok: boolean } | null>(null)
  const [country,      setCountry]      = useState('NZ')
  const [health,       setHealth]       = useState<{ status: 'checking' | 'ok' | 'error'; ms: number | null }>({ status: 'checking', ms: null })
  const [instForm,     setInstForm]     = useState({ bcUsername: '', bcPassword: '', bcPort: '8048', agentPort: '9099', bcInstance: '', bcCompany: '', navDatabaseServer: 'localhost', navDatabaseName: '', navServerInstance: '', navManagementPort: '7045', testBcUsername: '', testBcPassword: '', testServerSeparate: false, testAgentUrl: '', testTunnelToken: '' })
  const hasLoaded = useRef(false)
  const [testEnv,      setTestEnv]      = useState({ testNavDatabaseServer: '', testNavDatabaseName: '', testNavServerInstance: '', testBcPort: '', testBcInstance: '', testBcCompany: '', testAgentPort: '' })
  const [instLoading,  setInstLoading]  = useState(false)
  const [agentVersion, setAgentVersion] = useState('')
  const [inviteForm,   setInviteForm]   = useState({ email: '', name: '', role: 'user' })
  const [inviteResult, setInviteResult] = useState<{ tempPassword: string; email: string } | null>(null)
  const [resetResult,  setResetResult]  = useState<{ id: string; tempPassword: string } | null>(null)
  const [entityConfig, setEntityConfig] = useState<Record<string, boolean>>({})
  const [entitySaving, setEntitySaving] = useState(false)

  const user       = session?.user as any
  const managedByPartner = user?.managedByPartner ?? false
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING)

  useEffect(() => {
    fetch('/api/branding')
      .then(r => r.ok ? r.json() : null)
      .then(b => {
        if (!b) return
        setBranding(b)

      })
      .catch(() => {})
  }, [])
  const visibleNav = managedByPartner ? NAV.filter(item => item.id !== 'installer') : NAV
  const [profile, setProfile] = useState<{ firstName: string; lastName: string; preferredName: string }>({ firstName: '', lastName: '', preferredName: '' })
  const profileRefs = { firstName: useRef<HTMLInputElement>(null), lastName: useRef<HTMLInputElement>(null), preferredName: useRef<HTMLInputElement>(null) }
  const [profileSaving, setProfileSaving] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  const [profileSaved,  setProfileSaved]  = useState(false)
  const role       = user?.role as string ?? ''
  const initials   = (user?.name ?? user?.email ?? '?').split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()

  useEffect(() => {
    fetch('/api/settings/profile').then(r => r.json()).then(d => {
      if (d.profile) setProfile({ firstName: d.profile.firstName || '', lastName: d.profile.lastName || '', preferredName: d.profile.preferredName || '' })
    }).catch(() => {})
  }, [])

  async function saveProfile() {
    setProfileSaving(true)
    const vals = { firstName: profileRefs.firstName.current?.value || '', lastName: profileRefs.lastName.current?.value || '', preferredName: profileRefs.preferredName.current?.value || '' }
    await fetch('/api/settings/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vals) })
    setProfile(vals)
    setProfileSaving(false); setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 2000)
  }
  const tenantName = user?.tenantName ?? tenant?.name ?? '…'
  const erpLabel   = tenant?.navProduct === 'NAV' ? 'NAV' : 'BC'

  const toast$ = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500) }

  useEffect(() => {
    if (status === 'loading') return
    if (status === 'unauthenticated' || !session) { router.push('/login'); return }
    if (role && role !== 'tenant_admin' && role !== 'superadmin') router.push('/dashboard')
  }, [status, session, role])

  useEffect(() => {
    fetch('/api/settings/installer').then(r => r.json()).then(d => { if (d.version) setAgentVersion(d.version) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!session || hasLoaded.current) return
    hasLoaded.current = true
    Promise.all([fetch('/api/settings').then(r => r.json()), fetch('/api/settings/users').then(r => r.json())])
      .then(([td, ud]) => {
        const t = td.tenant ?? null
        setTenant(t); setCountry(t?.country ?? 'NZ')
        setEntityConfig(t?.entityConfig ?? {}); setUsers(ud.users ?? [])
        if (t?.bcPort)              setInstForm(f => ({ ...f, bcPort:              String(t.bcPort)            }))
        if (t?.agentPort)           setInstForm(f => ({ ...f, agentPort:           String(t.agentPort)         }))
        if (t?.bcInstance)          setInstForm(f => ({ ...f, bcInstance:          t.bcInstance                }))
        if (t?.bcUsername)          setInstForm(f => ({ ...f, bcUsername:          t.bcUsername                }))
        if (t?.navDatabaseServer)   setInstForm(f => ({ ...f, navDatabaseServer:   t.navDatabaseServer         }))
        if (t?.navDatabaseName)     setInstForm(f => ({ ...f, navDatabaseName:     t.navDatabaseName           }))
        if (t?.navServerInstance)   setInstForm(f => ({ ...f, navServerInstance:   t.navServerInstance         }))
        if (t?.navManagementPort)   setInstForm(f => ({ ...f, navManagementPort:   String(t.navManagementPort) }))
        if (t?.testServerSeparate)  setInstForm(f => ({ ...f, testServerSeparate:  t.testServerSeparate        }))
        if (t?.testAgentUrl)        setInstForm(f => ({ ...f, testAgentUrl:        t.testAgentUrl              }))
        if (t?.testTunnelToken)     setInstForm(f => ({ ...f, testTunnelToken:     t.testTunnelToken           }))
        // Note: these only run once due to hasLoaded guard above
        setTestEnv({
          testNavDatabaseServer: t?.testNavDatabaseServer ?? '',
          testNavDatabaseName:   t?.testNavDatabaseName   ?? '',
          testNavServerInstance: t?.testNavServerInstance ?? '',
          testBcPort:            t?.testBcPort ? String(t.testBcPort) : '',
          testBcInstance:        t?.testBcInstance        ?? '',
          testBcCompany:         t?.testBcCompany         ?? '',
          testAgentPort:         t?.testAgentPort ? String(t.testAgentPort) : '',
        })
        if (t?.bcCompany)  setInstForm(f => ({ ...f, bcCompany:  t.bcCompany         }))
        setLoading(false)
      }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!session) return
    const check = async () => {
      const t0 = Date.now()
      try { const r = await fetch('/api/health'); const d = await r.json(); setHealth({ status: d.ok ? 'ok' : 'error', ms: Date.now() - t0 }) }
      catch { setHealth({ status: 'error', ms: null }) }
    }
    check(); const iv = setInterval(check, 60000); return () => clearInterval(iv)
  }, [!!session])

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

  const [syncLoading, setSyncLoading] = useState(false)

  async function syncConfig() {
    setSyncLoading(true)
    const r = await fetch('/api/settings/sync-config', { method: 'POST' })
    setSyncLoading(false)
    const json = await r.json().catch(() => ({}))
    toast$(r.ok ? 'Config synced to agent' : (json.error || 'Sync failed'), r.ok)
  }

  async function downloadInstaller() {
    if (!instForm.bcUsername || !instForm.bcPassword) { toast$(erpLabel + ' username and password required', false); return }
    setInstLoading(true)
    // Persist port values to tenant so they're remembered
    await saveSystemConfig({ bcPort: instForm.bcPort, agentPort: instForm.agentPort })
    try {
      const r = await fetch('/api/settings/installer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...instForm, ...testEnv, testBcUsername: instForm.testBcUsername, testBcPassword: instForm.testBcPassword }) })
      if (!r.ok) { toast$('Generation failed', false); setInstLoading(false); return }
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: 'Install-BespoxAI-v' + agentVersion + '.zip' })
      a.click(); URL.revokeObjectURL(a.href)
    } catch { toast$('Download failed', false) }
    setInstLoading(false)
  }

  // NOTE: intentionally only gating on `loading` (our own data-load flag), NOT on
  // `status === 'loading'`. NextAuth briefly sets status→'loading' every ~60s during
  // its silent session refresh. Including it here caused the entire content tree to
  // unmount and remount each time, clearing all form fields. The auth guard effect
  // handles unauthenticated users via router.push, so we don't need status here.
  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.4)' }}>Loading…</span>
    </div>
  )

  const selfId = user?.id
  const hOk = health.status === 'ok', hErr = health.status === 'error'
  const hColor = hOk ? 'var(--jade)' : hErr ? '#E24B4A' : 'rgba(214,217,212,0.4)'



  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : '100vh', minHeight: '100vh', overflow: isMobile ? 'visible' : 'hidden', fontFamily: 'var(--font-body)' }}>

      {/* ── DEBUG BANNER — remove when SETTINGS_DEBUG env var is removed ── */}
      {tenant?._debug && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, background: '#C8952A', color: '#fff', padding: '6px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>🧪 DEBUG MODE — SETTINGS_DEBUG=true — mock data only — remove env var before production</span>
          <span style={{ marginLeft: 'auto', opacity: 0.7 }}>API routes return mock responses · DB not touched · installer generates dummy zip</span>
        </div>
      )}
      {/* ── END DEBUG BANNER ── */}

      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, background: toast.ok ? 'var(--forest)' : '#A32D2D', color: '#fff', padding: '10px 18px', borderRadius: 10, fontFamily: 'var(--font-body)', fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,0.25)' }}>{toast.msg}</div>}

      {/* ── Sidebar / Mobile Top Nav ── */}
      <aside style={{
        width: isMobile ? '100%' : 240,
        flexShrink: 0,
        background: 'var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,0.04)',
        borderBottom: isMobile ? '1px solid rgba(255,255,255,0.08)' : 'none',
        position: isMobile ? 'sticky' : 'relative',
        top: 0,
        zIndex: 100,
      }}>

        {/* Logo + health — hidden on mobile to save space */}
        {!isMobile && (
          <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              {branding.isWhiteLabel && branding.logoUrl ? (
                <img src={branding.logoUrl} alt={branding.brandName} style={{ height: 28, objectFit: 'contain' }} />
              ) : branding.isWhiteLabel && branding.brandName ? (
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 20, color: 'var(--cream)', letterSpacing: '-0.3px' }}>{branding.brandName}</span>
              ) : (
                <>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 22, color: 'var(--cream)', letterSpacing: '-0.3px' }}>Bespox</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 17, color: 'var(--amber)', letterSpacing: '0.04em', marginLeft: 3 }}>AI</span>
                </>
              )}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, background: hOk ? 'rgba(10,92,70,0.25)' : hErr ? 'rgba(163,45,45,0.2)' : 'rgba(100,100,100,0.15)', border: '1px solid ' + (hOk ? 'rgba(10,92,70,0.4)' : hErr ? 'rgba(163,45,45,0.35)' : 'rgba(100,100,100,0.25)'), borderRadius: 12, padding: '4px 10px' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: hColor }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: hColor }}>
                {tenantName} · {hOk ? 'Live' : hErr ? 'Offline' : '···'}
              </span>
            </div>
          </div>
        )}

        {/* Mobile header row */}
        {isMobile && (
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 18, color: 'var(--cream)' }}>Bespox</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 14, color: 'var(--amber)' }}>AI</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: hOk ? 'rgba(10,92,70,0.25)' : 'rgba(100,100,100,0.15)', border: '1px solid ' + (hOk ? 'rgba(10,92,70,0.4)' : 'rgba(100,100,100,0.25)'), borderRadius: 10, padding: '3px 8px' }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: hColor }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: hColor }}>{hOk ? 'Live' : hErr ? 'Offline' : '···'}</span>
              </div>
              <button onClick={() => signOut({ callbackUrl: '/login' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(214,217,212,0.4)', fontSize: 14, padding: 4 }}>↪</button>
            </div>
          </div>
        )}

        {/* Nav items */}
        {!isMobile && (
          <div style={{ padding: '18px 20px 8px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.3)' }}>Settings</span>
          </div>
        )}

        <nav style={{ flex: isMobile ? undefined : 1, padding: isMobile ? '6px 10px 10px' : '0 10px', display: isMobile ? 'flex' : 'block', flexWrap: 'wrap', gap: isMobile ? 4 : 0 }}>
          {visibleNav.map(item => {
            const active = tab === item.id
            return (
              <button key={item.id} onClick={() => { router.push('/settings?tab=' + item.id); if (isMobile) window.scrollTo({ top: 0 }) }}
                style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10, padding: isMobile ? '7px 10px' : '9px 10px', borderRadius: 8, marginBottom: isMobile ? 0 : 2, border: 'none', background: active ? 'rgba(10,92,70,0.3)' : 'transparent', cursor: 'pointer', textAlign: 'left', width: isMobile ? 'auto' : '100%' }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? 'rgba(10,92,70,0.3)' : 'transparent' }}>
                <span style={{ fontSize: isMobile ? 13 : 14 }}>{item.icon}</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: isMobile ? 12 : 13, fontWeight: active ? 600 : 400, color: active ? 'var(--cream)' : 'rgba(214,217,212,0.55)', whiteSpace: 'nowrap' }}>{item.id === 'installer' ? erpLabel + ' Installer' : item.label}</span>
              </button>
            )
          })}

          {!isMobile && <div style={{ margin: '12px 10px', borderTop: '1px solid rgba(255,255,255,0.06)' }} />}
          {!isMobile && (
            <button onClick={() => router.push('/dashboard')}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              <span style={{ fontSize: 13 }}>←</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(214,217,212,0.45)' }}>Back to Dashboard</span>
            </button>
          )}
        </nav>

        {/* User row — desktop only */}
        {!isMobile && (
          <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, var(--jade), var(--forest))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: 'var(--cream)' }}>{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--cream)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.preferredName || user?.firstName || user?.name || user?.email}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(214,217,212,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{role.replace('_', ' ')}</div>
            </div>
            <button onClick={() => signOut({ callbackUrl: '/login' })} title="Sign out"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(214,217,212,0.3)', fontSize: 15, padding: 4, lineHeight: 1, transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--fog)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(214,217,212,0.3)')}>↪</button>
          </div>
        )}
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, overflowY: isMobile ? 'visible' : 'auto', background: '#ffffff', paddingTop: tenant?._debug ? 32 : 0 }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: isMobile ? '20px 16px 40px' : '40px 32px' }}>

          {/* Overview */}
          {tab === 'overview' && <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: isMobile ? 22 : 28, fontWeight: 400, color: 'var(--ink)', marginBottom: 28 }}>Overview</h1>
            <Card>
              <Label>Your Profile</Label>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 18, lineHeight: 1.6 }}>How you appear in the portal and how we address you.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>First Name</div>
                  <input ref={profileRefs.firstName} style={sharedInp} defaultValue={profile.firstName} placeholder="Jane" key={'fn-' + profile.firstName}
                    onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>Last Name</div>
                  <input ref={profileRefs.lastName} style={sharedInp} defaultValue={profile.lastName} placeholder="Smith" key={'ln-' + profile.lastName}
                    onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>Preferred Name <span style={{ fontWeight: 400, opacity: 0.6 }}>· optional</span></div>
                <input ref={profileRefs.preferredName} style={sharedInp} defaultValue={profile.preferredName} placeholder="e.g. Jay — leave blank to use first name" key={'pn-' + profile.preferredName}
                  onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={saveProfile} disabled={profileSaving} style={{ background: 'var(--forest)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, cursor: profileSaving ? 'default' : 'pointer', opacity: profileSaving ? 0.7 : 1 }}>
                  {profileSaving ? 'Saving…' : 'Save Profile'}
                </button>
                {profileSaved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--forest)', letterSpacing: '0.1em' }}>✓ Saved</span>}
              </div>
              <ChangePasswordCard />
            </Card>
            <Card>
              <Label>Production Environment Details</Label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px 40px' }}>
                {([
                  ['Product',             tenant?.navProduct === 'BC' ? 'Business Central' : tenant?.navProduct === 'NAV' ? 'Microsoft NAV' : null],
                  ['Last CU',             tenant?.lastCU],
                  [erpLabel + ' Instance',          tenant?.bcInstance],
                  [erpLabel + ' Company',           tenant?.bcCompany],
                  ['BC OData Port',                 tenant?.bcPort ? String(tenant.bcPort) : '8048'],
                  ['Agent Port',                    tenant?.agentPort ? String(tenant.agentPort) : '9099'],
                  ['NAV Database Server',           tenant?.navDatabaseServer],
                  ['NAV Database Name',             tenant?.navDatabaseName],
                  ['NAV Server Instance',           tenant?.navServerInstance],
                  ['NAV Management Port',           tenant?.navManagementPort ? String(tenant.navManagementPort) : '7045'],
                ] as [string, string|null|undefined][]).map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>{k}</div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: v ? 'var(--ink)' : 'var(--fog)' }}>{v || '—'}</div>
                  </div>
                ))}
              </div>
              {!managedByPartner ? <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', margin: '14px 0 0' }}>To configure, go to the <button onClick={() => router.push('/settings?tab=installer')} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--forest)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>{erpLabel + ' Installer'}</button> tab.</p> : null}
            </Card>

            {/* Test Environment — NAV/BC14 only */}
            {(tenant?.navProduct === 'NAV' || tenant?.navProduct === 'BC') && (
              <Card>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>Test Environment Details</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 16, lineHeight: 1.55 }}>
                  Used for pre-production deployment and UAT.
                </p>
                {/* Read-only reference — edit in BC Installer tab */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px 40px' }}>
                  {[
                    { label: 'Test ' + erpLabel + ' Instance',    val: tenant?.testBcInstance },
                    { label: 'Test ' + erpLabel + ' Company',     val: tenant?.testBcCompany },
                    { label: 'Test ' + erpLabel + ' Port',        val: tenant?.testBcPort ? String(tenant.testBcPort) : null },
                    { label: 'Test Agent Port',                   val: tenant?.testAgentPort ? String(tenant.testAgentPort) : null },
                    { label: 'Test Database Server',              val: tenant?.testNavDatabaseServer },
                    { label: 'Test Database Name',                val: tenant?.testNavDatabaseName   },
                    { label: 'Test Server Instance',              val: tenant?.testNavServerInstance },
                    { label: 'Test NAV Management Port',          val: tenant?.testNavManagementPort ? String(tenant.testNavManagementPort) : '7045' },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: val ? 'var(--ink)' : 'var(--fog)' }}>{val || '—'}</div>
                    </div>
                  ))}
                </div>
                {!managedByPartner ? <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', margin: '14px 0 0' }}>To configure, go to the <button onClick={() => router.push('/settings?tab=installer')} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--forest)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>{erpLabel + ' Installer'}</button> tab.</p> : null}
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
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>{'Test ' + erpLabel + ' Port'} <span style={{ fontFamily: 'var(--font-body)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>(OData, optional)</span></div>
                      <input type="number" value={testEnv.testBcPort} placeholder="e.g. 7048"
                        onChange={e => setTestEnv(f => ({ ...f, testBcPort: e.target.value }))}
                        onBlur={async e => { e.target.style.borderColor = 'var(--fog)'; if (e.target.value) await saveSystemConfig({ testBcPort: e.target.value }) }}
                        onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                        style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 5 }}>{'Test ' + erpLabel + ' Company'} <span style={{ fontFamily: 'var(--font-body)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>(optional)</span></div>
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
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: isMobile ? 22 : 28, fontWeight: 400, color: 'var(--ink)', marginBottom: 28 }}>Users</h1>
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
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: isMobile ? 22 : 28, fontWeight: 400, color: 'var(--ink)', margin: 0 }}>Data Entities</h1>
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
                  {entitySaving ? 'Working…' : '⟳ Discover from ' + erpLabel}
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
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: isMobile ? 22 : 28, fontWeight: 400, color: 'var(--ink)', marginBottom: 10 }}>{erpLabel} Agent Installer</h1>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', marginBottom: 28, lineHeight: 1.65 }}>Download a pre-configured installer for the BespoxAI BCAgent. Run it on the Windows Server hosting Business Central — it installs the agent, configures the Cloudflare tunnel, and starts the service automatically.</p>

            <Card style={{ background: 'rgba(200,149,42,0.06)', border: '1px solid rgba(200,149,42,0.25)' }}>
              <Label>Production Environment</Label>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 18, lineHeight: 1.6 }}>{'Production ' + erpLabel + ' connection details. Instance, company and database fields are saved — credentials are embedded in the installer only and never stored.'}</p>
              <ProdEnvForm
                key={tenant?.id ?? 'loading'}
                initial={instForm}
                erpLabel={erpLabel}
                onSave={saveSystemConfig}
                onSaved={vals => setInstForm(f => ({ ...f, ...vals }))}
              />
            </Card>

            {(tenant?.navProduct === 'NAV' || tenant?.navProduct === 'BC') && (
              <Card style={{ background: 'rgba(10,92,70,0.06)', border: '1px solid rgba(10,92,70,0.25)' }}>
                <Label>Test Environment</Label>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 16, lineHeight: 1.55 }}>
                  Used for pre-production deployment and UAT. These details will be included the next time you generate the installer below.
                </p>
                <TestEnvForm
                  key={tenant?.id ?? 'loading'}
                  initial={{
                    testNavDatabaseName:   tenant?.testNavDatabaseName   ?? '',
                    testNavServerInstance: tenant?.testNavServerInstance  ?? '',
                    testBcInstance:        tenant?.testBcInstance         ?? '',
                    testBcCompany:         tenant?.testBcCompany          ?? '',
                    testNavManagementPort: String(tenant?.testNavManagementPort ?? 7045),
                  }}
                  erpLabel={erpLabel}
                  onSave={saveSystemConfig}
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

            <button onClick={syncConfig} disabled={syncLoading || !tenant?.tunnelSubdomain} style={{ marginTop: 8, width: '100%', background: tenant?.tunnelSubdomain ? 'var(--forest)' : 'var(--fog)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', cursor: (syncLoading || !tenant?.tunnelSubdomain) ? 'default' : 'pointer', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500, opacity: syncLoading ? 0.7 : 1 }}>
              {syncLoading ? 'Syncing…' : '↑ Sync Config to Agent'}
            </button>
            {!tenant?.tunnelSubdomain ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginTop: 6, textAlign: 'center' }}>Download the installer first to provision your tunnel.</p>
            ) : (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginTop: 6, lineHeight: 1.5, textAlign: 'center' }}>Pushes your current settings to the running agent immediately — no reinstall needed. Credentials stay unchanged on the server.</p>
            )}

            <button onClick={downloadInstaller} disabled={instLoading} style={{ marginTop: 8, width: '100%', background: 'var(--forest)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', cursor: instLoading ? 'default' : 'pointer', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500, opacity: instLoading ? 0.7 : 1 }}>
              {instLoading ? 'Generating…' : ('⬇ Download Installer ' + (agentVersion ? 'v' + agentVersion + ' ' : '') + '(.zip)')}
            </button>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginTop: 10, lineHeight: 1.5, textAlign: 'center' }}>{erpLabel + ' credentials are embedded in the installer and never stored by BespoxAI.'}</p>
          </>}

        </div>
      </main>
    </div>
  )
}

function TestEnvForm({ initial, onSave, erpLabel = 'BC' }: {
  initial: { testNavDatabaseName: string; testNavServerInstance: string; testBcInstance: string; testBcCompany: string; testNavManagementPort: string }
  onSave: (data: Record<string, any>) => Promise<void>
  erpLabel?: string
}) {

  const refs = {
    testNavDatabaseName:   useRef<HTMLInputElement>(null),
    testNavServerInstance: useRef<HTMLInputElement>(null),
    testBcInstance:        useRef<HTMLInputElement>(null),
    testBcCompany:         useRef<HTMLInputElement>(null),
    testNavManagementPort: useRef<HTMLInputElement>(null),
  }
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave({
      testNavDatabaseName:   refs.testNavDatabaseName.current?.value   || null,
      testNavServerInstance: refs.testNavServerInstance.current?.value || null,
      testBcInstance:        refs.testBcInstance.current?.value        || null,
      testBcCompany:         refs.testBcCompany.current?.value         || null,
      testNavManagementPort: refs.testNavManagementPort.current?.value || 7045,
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inp: React.CSSProperties = { width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }
  const lbl = (t: string) => <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>{t}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: 'rgba(10,92,70,0.04)', border: '1px solid rgba(10,92,70,0.12)', borderRadius: 8, padding: '10px 14px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', lineHeight: 1.55 }}>
        Uses the same server, ports, and credentials as production. Only configure what differs.
      </div>
      <div>
        {lbl('Test Database Name *')}
        <input ref={refs.testNavDatabaseName} style={inp} type="text" defaultValue={initial.testNavDatabaseName}
          placeholder="e.g. Dynamics NAV 2017 Test" autoComplete="off"
          onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
          onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>The SQL database used for test deployments.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div>
          {lbl('Test Server Instance')}
          <input ref={refs.testNavServerInstance} style={inp} type="text" defaultValue={initial.testNavServerInstance}
            placeholder="e.g. DynamicsNAV110_Test" autoComplete="off"
            onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
            onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>NAV Windows service instance name for schema sync.</p>
        </div>
        <div>
          {lbl('Test ' + erpLabel + ' Instance')}
          <input ref={refs.testBcInstance} style={inp} type="text" defaultValue={initial.testBcInstance}
            placeholder="e.g. DynamicsNAV110_Test" autoComplete="off"
            onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
            onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
        </div>
        <div>
          {lbl('Test ' + erpLabel + ' Company')}
          <input ref={refs.testBcCompany} style={inp} type="text" defaultValue={initial.testBcCompany}
            placeholder="e.g. Cronus Test" autoComplete="off"
            onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
            onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
        </div>
        <div>
          {lbl('NAV Server Management Port')}
          <input ref={refs.testNavManagementPort} style={inp} type="number" defaultValue={initial.testNavManagementPort}
            placeholder="7045" autoComplete="off"
            onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
            onBlur={e  => (e.target.style.borderColor = 'var(--fog)')} />
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>Used by NAV to sync schema changes. Default is 7045.</p>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={handleSave} disabled={saving}
          style={{ background: 'var(--forest)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Test Environment'}
        </button>
        {saved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--forest)', letterSpacing: '0.1em' }}>✓ Saved</span>}
      </div>
    </div>
  )
}

function ProdEnvForm({ initial, onSave, onSaved, erpLabel = 'BC' }: {
  initial: { navDatabaseServer: string; navDatabaseName: string; navServerInstance: string; navManagementPort: string; bcInstance: string; bcCompany: string; bcPort: string; agentPort: string; bcUsername: string; bcPassword: string }
  onSave:  (data: Record<string, any>) => Promise<void>
  onSaved: (vals: Record<string, string>) => void
  erpLabel?: string
}) {

  const refs = {
    navDatabaseServer: useRef<HTMLInputElement>(null),
    navDatabaseName:   useRef<HTMLInputElement>(null),
    navServerInstance: useRef<HTMLInputElement>(null),
    navManagementPort: useRef<HTMLInputElement>(null),
    bcInstance:        useRef<HTMLInputElement>(null),
    bcCompany:         useRef<HTMLInputElement>(null),
    bcPort:            useRef<HTMLInputElement>(null),
    agentPort:         useRef<HTMLInputElement>(null),
    bcUsername:        useRef<HTMLInputElement>(null),
    bcPassword:        useRef<HTMLInputElement>(null),
  }
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  async function handleSave() {
    setSaving(true)
    const vals = {
      navDatabaseServer: refs.navDatabaseServer.current?.value || 'localhost',
      navDatabaseName:   refs.navDatabaseName.current?.value   || '',
      navServerInstance: refs.navServerInstance.current?.value || '',
      navManagementPort: refs.navManagementPort.current?.value || '7045',
      bcInstance:        refs.bcInstance.current?.value        || '',
      bcCompany:         refs.bcCompany.current?.value         || '',
      bcPort:            refs.bcPort.current?.value            || '8048',
      agentPort:         refs.agentPort.current?.value         || '9099',
      bcUsername:        refs.bcUsername.current?.value        || '',
      bcPassword:        refs.bcPassword.current?.value        || '',
    }
    await onSave({
      navDatabaseServer: vals.navDatabaseServer,
      navDatabaseName:   vals.navDatabaseName,
      navServerInstance: vals.navServerInstance,
      navManagementPort: vals.navManagementPort,
      bcInstance:        vals.bcInstance,
      bcCompany:         vals.bcCompany,
      bcPort:            vals.bcPort,
      agentPort:         vals.agentPort,
    })
    onSaved(vals)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inp: React.CSSProperties = { width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--parchment)', border: '1px solid var(--fog)', borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const }
  const lbl = (t: string) => <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)', marginBottom: 5 }}>{t}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div>{lbl('Database Server')}<input ref={refs.navDatabaseServer} style={inp} defaultValue={initial.navDatabaseServer} placeholder="localhost" onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} /></div>
        <div>{lbl('Database Name')}<input ref={refs.navDatabaseName} style={inp} defaultValue={initial.navDatabaseName} placeholder="e.g. Dynamics NAV 2017" onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div>{lbl('Server Instance')}<input ref={refs.navServerInstance} style={inp} defaultValue={initial.navServerInstance} placeholder="e.g. DynamicsNAV110" onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} /></div>
        <div>{lbl('BC Instance Name')}<input ref={refs.bcInstance} style={inp} defaultValue={initial.bcInstance} placeholder="e.g. BC" onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} /></div>
        <div>{lbl('NAV Management Port')}<input ref={refs.navManagementPort} style={inp} type="number" defaultValue={initial.navManagementPort} placeholder="7045" onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div>{lbl('BC Company Name')}<input ref={refs.bcCompany} style={inp} defaultValue={initial.bcCompany} placeholder="e.g. CRONUS International Ltd." onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>{lbl('BC OData Port')}<input ref={refs.bcPort} style={inp} type="number" defaultValue={initial.bcPort} onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} /></div>
          <div>{lbl('Agent Port')}<input ref={refs.agentPort} style={inp} type="number" defaultValue={initial.agentPort} onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} /></div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div>
          {lbl(erpLabel + ' Username')}
          <input ref={refs.bcUsername} style={inp} defaultValue={initial.bcUsername} placeholder="DOMAIN\username" autoComplete="off" name="bc-username" onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
          <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>{'Windows / ' + erpLabel + ' service account with OData access.'}</p>
        </div>
        <div>
          {lbl(erpLabel + ' Password')}
          <input ref={refs.bcPassword} style={inp} type="password" defaultValue={initial.bcPassword} autoComplete="new-password" name="bc-password" onFocus={e => (e.target.style.borderColor = 'var(--forest)')} onBlur={e => (e.target.style.borderColor = 'var(--fog)')} />
          <p style={{ fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>Never stored — embedded in installer only.</p>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 4 }}>
        <button onClick={handleSave} disabled={saving} style={{ background: 'var(--forest)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : 'Save Production Environment'}
        </button>
        {saved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--forest)', letterSpacing: '0.1em' }}>✓ Saved</span>}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#ffffff' }} />}>
      <SettingsInner />
    </Suspense>
  )
}
