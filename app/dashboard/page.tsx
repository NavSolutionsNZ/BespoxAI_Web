'use client'

export const dynamic = 'force-dynamic'

import { useState, useRef, useEffect, KeyboardEvent, Suspense } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { DisplayHint, StructuredData } from '@/app/api/query/route'
import type { BrandingConfig } from '@/lib/branding'
import { useBranding } from '@/app/branding-provider'
import DataVisualizer from '@/components/DataVisualizer'
import { UpgradePrompt } from '@/components/UpgradePrompt'
import RequirementsBuilder from '@/components/RequirementsBuilder'
import MigrationAnalyzerLanding from '@/components/MigrationAnalyzerLanding'
// ─── PDF helpers ──────────────────────────────────────────────────────────────

function buildDataHTML(hint: string | undefined, data: StructuredData | null | undefined): string {
  if (!hint || hint === 'narrative' || !data) return ''

  if (hint === 'kpi' && data.kpis?.length) {
    const cards = data.kpis.map((kpi, i) => {
      const primary = i === 0 ? ' kpi-primary' : ''
      const sub = kpi.subtext ? '<div class="kpi-sub">' + kpi.subtext + '</div>' : ''
      return '<div class="kpi-card' + primary + '"><div class="kpi-label">' + kpi.label + '</div><div class="kpi-value">' + kpi.value + '</div>' + sub + '</div>'
    }).join('')
    return '<div class="kpi-grid">' + cards + '</div>'
  }

  if ((hint === 'table' || hint === 'bar_chart' || hint === 'line_chart') && data.columns?.length && data.rows?.length) {
    const header = data.columns.map(c => '<th>' + c + '</th>').join('')
    const body = data.rows.map(r => '<tr>' + r.map(cell => '<td>' + (cell ?? '') + '</td>').join('') + '</tr>').join('')
    const note = (hint === 'bar_chart' || hint === 'line_chart')
      ? '<p class="chart-note">&#9650; ' + (hint === 'bar_chart' ? 'Bar' : 'Line') + ' chart data</p>'
      : ''
    return note + '<table><thead><tr>' + header + '</tr></thead><tbody>' + body + '</tbody></table>'
  }

  return ''
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthStatus {
  status:     'checking' | 'ok' | 'error'
  latencyMs:  number | null
  checkedAt:  Date | null
  error?:     string
}

interface QueryLogItem {
  id:          string
  question:    string
  answer:      string
  displayHint: string | null
  data:        any
  entity:      string | null
  recordCount: number | null
  createdAt:   string
}

interface QueryResult {
  id: string
  question: string
  answer: string
  displayHint?: DisplayHint
  data?: StructuredData | null
  meta?: { entity: string; reasoning: string; recordCount: number; odataUrl: string }
  error?: string
  errorDetail?: string
  errorUrl?: string
  badQuery?: boolean
  suggestedQueries?: string[]
  ts: Date
  loading?: boolean
}

type NavItem = 'assistant' | 'health' | 'customisations' | 'cashflow' | 'monthend' | 'migration'

// ─── Constants ────────────────────────────────────────────────────────────────

const EXAMPLE_QUERIES = [
  'Show me overdue debtors',
  'Budget vs actual this month',
  'Which costs increased most in Q1?',
  'Forecast cash for next 4 weeks',
  "What's our gross margin by product line?",
  'Top 10 customers by balance',
]

const NAV_ITEMS: { id: NavItem; icon: string; label: string; badge?: string; soon?: boolean }[] = [
  { id: 'assistant',      icon: '💬', label: 'CFO Assistant' },
  { id: 'health',         icon: '🔍', label: 'Health Scanner', badge: '3' },
  { id: 'customisations', icon: '🛠️', label: 'Customisations' },
  { id: 'cashflow',       icon: '📊', label: 'Cash Flow', soon: true },
  { id: 'monthend',       icon: '📅', label: 'Month-End Close', soon: true },
  { id: 'migration',      icon: '🏗️', label: 'Migration Analyser' },
]

// ─── Health polling hook ──────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000

function useHealthStatus(): HealthStatus {
  const [health, setHealth] = useState<HealthStatus>({ status: 'checking', latencyMs: null, checkedAt: null })

  useEffect(() => {
    async function check() {
      try {
        const res  = await fetch('/api/health')
        const data = await res.json()
        setHealth({
          status:    data.ok ? 'ok' : 'error',
          latencyMs: data.latencyMs ?? null,
          checkedAt: new Date(data.checkedAt),
          error:     data.error,
        })
      } catch {
        setHealth(prev => ({ ...prev, status: 'error', checkedAt: new Date() }))
      }
    }

    check()
    const timer = setInterval(check, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  return health
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardInner />
    </Suspense>
  )
}

function DashboardInner() {
  const { data: session } = useSession()
  const router     = useRouter()
  const pathname   = usePathname()
  const searchParams = useSearchParams()
  const user = session?.user as any
  
  // Redirect if no session after a short delay (allows session to load)
  useEffect(() => {
    // Mark dashboard start time on first mount
    if (!(window as any).__dashboardStartTime) {
      (window as any).__dashboardStartTime = performance.now()
    }
    const timer = setTimeout(() => {
      if (!session) {
        router.push('/login')
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [session, router])
  
  const managedByPartner = !!(user?.managedByPartner)
  const branding = useBranding()
  const isTenantAdmin = user?.role === 'tenant_admin' || user?.role === 'superadmin'
  const [partnerReqSent, setPartnerReqSent] = useState<'upgrade' | 'connection' | null>(null)
  const [partnerReqLoading, setPartnerReqLoading] = useState<'upgrade' | 'connection' | null>(null)
  const [partnerReqState, setPartnerReqState] = useState<{
    connectionRequestedAt: string | null; connectionRequestedToEmail: string | null
    upgradeRequestedAt: string | null; upgradeRequestedToEmail: string | null
  }>({ connectionRequestedAt: null, connectionRequestedToEmail: null, upgradeRequestedAt: null, upgradeRequestedToEmail: null })

  useEffect(() => {
    if (!managedByPartner) return
    fetch('/api/partner/request-state').then(r => r.json()).then(d => {
      if (d) setPartnerReqState(d)
    }).catch(() => {})
  }, [managedByPartner])

  async function sendPartnerRequest(type: 'upgrade' | 'connection') {
    setPartnerReqLoading(type)
    try {
      const res = await fetch('/api/partner/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const now = new Date().toISOString()
        setPartnerReqState(prev => type === 'connection'
          ? { ...prev, connectionRequestedAt: now, connectionRequestedToEmail: data.sentTo ?? null }
          : { ...prev, upgradeRequestedAt: now, upgradeRequestedToEmail: data.sentTo ?? null })
        setPartnerReqSent(type)
        setTimeout(() => setPartnerReqSent(null), 4000)
      }
    } catch { /* silent */ } finally {
      setPartnerReqLoading(null)
    }
  }
  const health = useHealthStatus()

  // Superadmin has no tenant dashboard — send to admin portal
  useEffect(() => {
    if (user?.role === 'superadmin') router.replace('/admin')
  }, [user?.role, router])

  useEffect(() => {
    if (user && user.role !== 'superadmin' && user.onboardingDone === false) router.replace('/onboarding')
  }, [user?.onboardingDone, user?.role, router])

  // Persist active nav in URL ?view=xxx so refresh lands on the same tab
  const viewParam = (searchParams.get('view') as NavItem | null) ?? 'assistant'
  const [activeNav, setActiveNavState] = useState<NavItem>(viewParam)

  function setActiveNav(item: NavItem) {
    setActiveNavState(item)
    if (isMobile) setSidebarOpen(false)
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', item)
    router.push(pathname + '?' + params.toString(), { scroll: false })
  }

  // Sync if URL changes externally (back/forward)
  useEffect(() => {
    const v = (searchParams.get('view') as NavItem | null) ?? 'assistant'
    setActiveNavState(v)
  }, [searchParams])

  // When not connected and no explicit view chosen, default to customisations
  // so new users aren't stranded on the CFO Assistant screen
  useEffect(() => {
    if (health.status === 'error' && !searchParams.get('view')) {
      setActiveNav('customisations')
    }
  }, [health.status])
  const [question, setQuestion]   = useState('')
  const [history, setHistory]     = useState<QueryResult[]>([])
  const [showMeta, setShowMeta]   = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
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
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [queryLogs, setQueryLogs]         = useState<QueryLogItem[]>([])
  const [showChangePw, setShowChangePw]   = useState(false)
  const [exportItemId, setExportItemId]   = useState<string | null>(null)
  const exportItem = exportItemId ? (history.find(i => i.id === exportItemId) ?? null) : null
  const [exportText, setExportText]       = useState('')
  const [pwForm, setPwForm]               = useState({ current: '', next: '', confirm: '' })
  const [pwSaving, setPwSaving]           = useState(false)
  const [pwError, setPwError]             = useState('')
  const [pwSuccess, setPwSuccess]         = useState(false)
  const [tierBlocked, setTierBlocked]     = useState<null | { reason: string; trialEndsAt?: string | null }>(null)
  const [aiUsage, setAiUsage]             = useState<{ used: number; limit: number; percentUsed: number; warning: boolean; tier: string } | null>(null)
  const [paymentSuccess, setPaymentSuccess] = useState<'deposit' | 'review' | 'balance' | null>(null)

  // Load query history on mount
  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(d => setQueryLogs(d.logs ?? []))
      .catch(() => {})
  }, [])

  // Load AI token usage on mount
  useEffect(() => {
    fetch('/api/ai-usage')
      .then(r => r.json())
      .then(d => { if (!d.error) setAiUsage(d) })
      .catch(() => {})
  }, [])

  // Refresh AI usage meter whenever billing or payment success params appear
  // Covers: ?billing=success (tier upgrade), ?deposit=paid, ?review=paid, ?balance=paid
  useEffect(() => {
    const billing = searchParams.get('billing')
    const deposit = searchParams.get('deposit')
    const review  = searchParams.get('review')
    const balance = searchParams.get('balance')
    if (billing === 'success' || deposit === 'paid' || review === 'paid' || balance === 'paid') {
      fetch('/api/ai-usage')
        .then(r => r.json())
        .then(d => { if (!d.error) setAiUsage(d) })
        .catch(() => {})
    }
    // Set success banner type and navigate to customisations tab
    if (deposit === 'paid') { setPaymentSuccess('deposit'); setActiveNavState('customisations') }
    else if (review === 'paid')  { setPaymentSuccess('review');  setActiveNavState('customisations') }
    else if (balance === 'paid') { setPaymentSuccess('balance'); setActiveNavState('customisations') }
    // Clear params from URL after reading
    if (deposit === 'paid' || review === 'paid' || balance === 'paid') {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('deposit'); params.delete('review'); params.delete('balance')
      params.set('view', 'customisations')
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }
  }, [searchParams])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  // Mark dashboard as fully rendered and show timing
  useEffect(() => {
    requestAnimationFrame(() => {
      const totalTime = Math.round(performance.now() - ((window as any).__dashboardStartTime || 0))
      alert(`✅ Dashboard ready!\nTotal time: ${totalTime}ms`)
    })
  }, [])

  // ── Greeting ────────────────────────────────────────────────────────────────

  const displayFirst = user?.preferredName || user?.firstName || 'there'
  const hour        = new Date().getHours()
  const greeting    = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const tenantName  = user?.tenantName ?? 'Your Company'
  const erpLabel    = user?.navProduct === 'NAV' ? 'NAV' : 'BC'
  const erpFullName = user?.navProduct === 'NAV' ? 'Microsoft NAV' : 'Business Central'
  const isConnected = health.status === 'ok'

  // ── Query ───────────────────────────────────────────────────────────────────

  async function changePassword() {
    if (pwForm.next !== pwForm.confirm) { setPwError('New passwords do not match'); return }
    if (pwForm.next.length < 8) { setPwError('Password must be at least 8 characters'); return }
    setPwSaving(true); setPwError(''); setPwSuccess(false)
    const res  = await fetch('/api/user/password', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
    })
    const data = await res.json()
    if (!res.ok) { setPwError(data.error); setPwSaving(false); return }
    setPwSuccess(true)
    setPwForm({ current: '', next: '', confirm: '' })
    setPwSaving(false)
    setTimeout(() => { setPwSuccess(false); setShowChangePw(false) }, 1500)
  }

  async function runQuery() {
    const q = question.trim()
    if (!q) return
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setQuestion('')
    if (textareaRef.current) { textareaRef.current.style.height = 'auto' }
    setHistory(prev => [...prev, { id, question: q, answer: '', ts: new Date(), loading: true }])

    try {
      // Build conversation history from the last 3 completed exchanges
      const completedItems = history.filter(i => !i.loading && !i.error && i.answer)
      const recentHistory = completedItems.slice(-3).flatMap(i => [
        { role: 'user' as const,      content: i.question },
        { role: 'assistant' as const, content: i.answer },
      ])

      const res  = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, history: recentHistory }),
      })
      const data = await res.json()
      if (res.status === 402) {
        setTierBlocked({ reason: data.reason, trialEndsAt: data.trialEndsAt })
        setHistory(prev => prev.filter(item => item.id !== id))
        return
      }
      if (res.status === 429 && data.error === 'token_limit_reached') {
        setAiUsage(prev => prev ? { ...prev, percentUsed: 100, warning: true, allowed: false } as any : prev)
        setHistory(prev => prev.map(item => item.id !== id ? item : {
          ...item, loading: false, error: 'token_limit_reached',
          answer: `You've used all ${(data.limit / 1000).toFixed(0)}k AI tokens for this month. Upgrade your plan to continue.`,
        }))
        return
      }
      setHistory(prev => prev.map(item => item.id !== id ? item : {
        ...item, loading: false,
        answer: data.answer ?? '', displayHint: data.displayHint,
        data: data.data, meta: data.meta, error: data.error,
        errorDetail: data.detail, errorUrl: data.odataUrl,
        badQuery: data.badQuery ?? false,
        suggestedQueries: data.suggestedQueries,
      }))
      if (!data.error) {
        setTimeout(() => {
          fetch('/api/history').then(r => r.json()).then(d => setQueryLogs(d.logs ?? [])).catch(() => {})
          fetch('/api/ai-usage').then(r => r.json()).then(d => { if (!d.error) setAiUsage(d) }).catch(() => {})
        }, 1000)
      }
    } catch {
      setHistory(prev => prev.map(item => item.id !== id ? item : {
        ...item, loading: false, error: 'Network error — could not reach server.',
      }))
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runQuery() }
  }

  // ── Initials ─────────────────────────────────────────────────────────────────

  const initials = (user?.name ?? 'U')
    .split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()

  // ─────────────────────────────────────────────────────────────────────────────
  // Don't render anything until session is known, and never render for superadmin
  // (prevents the CFO dashboard flashing briefly before the redirect fires)
  if (!session || user?.role === 'superadmin' || user?.onboardingDone === false) return null

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'var(--font-body)', flexDirection: 'row' }}>

      {/* ── Mobile overlay backdrop ── */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 199 }} />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside style={{
        width: sidebarOpen ? 240 : 0, flexShrink: 0,
        background: 'var(--ink)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', transition: 'width 0.2s ease',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        position: isMobile ? 'fixed' : 'relative',
        top: 0, left: 0, height: '100vh', zIndex: isMobile ? 200 : 'auto',
      }}>

        {/* Logo */}
        <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            {branding.isWhiteLabel && branding.logoUrl ? (
              <img src={branding.logoUrl} alt={branding.brandName} style={{ height: 28, objectFit: 'contain' }} />
            ) : branding.isWhiteLabel && branding.brandName ? (
              <span style={{
                fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 20,
                color: 'var(--cream)', letterSpacing: '-0.3px',
              }}>{branding.brandName}</span>
            ) : (
              <>
                <span style={{
                  fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 22,
                  color: 'var(--cream)', letterSpacing: '-0.3px',
                }}>Bespox</span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 17,
                  color: 'var(--amber)', letterSpacing: '0.04em', marginLeft: 3,
                }}>AI</span>
              </>
            )}
          </div>
          {/* Connected company badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
            background: health.status === 'ok'
              ? 'rgba(10,92,70,0.25)'
              : health.status === 'error'
              ? 'rgba(163,45,45,0.2)'
              : 'rgba(100,100,100,0.15)',
            border: `1px solid ${health.status === 'ok' ? 'rgba(10,92,70,0.4)' : health.status === 'error' ? 'rgba(163,45,45,0.35)' : 'rgba(100,100,100,0.25)'}`,
            borderRadius: 12, padding: '4px 10px',
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: health.status === 'ok' ? 'var(--jade)' : health.status === 'error' ? '#E24B4A' : 'rgba(214,217,212,0.4)',
              animation: health.status === 'ok' ? 'pulse 2s infinite' : 'none',
            }} />
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: health.status === 'ok' ? 'var(--jade)' : health.status === 'error' ? '#E24B4A' : 'rgba(214,217,212,0.4)',
            }}>
              {tenantName} · {health.status === 'ok' ? 'Live' : health.status === 'error' ? 'Offline' : '···'}
            </span>
          </div>
        </div>

        {/* Workspace label */}
        <div style={{ padding: '18px 20px 8px' }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 8,
            letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(214,217,212,0.3)',
          }}>Workspace</span>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '0 10px', overflowY: 'auto', minHeight: 0 }}>
          {NAV_ITEMS.map(item => {
            const active = activeNav === item.id
            return (
              <button
                key={item.id}
                onClick={() => !item.soon && setActiveNav(item.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 10px', borderRadius: 8, marginBottom: 2, border: 'none',
                  background: active ? 'rgba(10,92,70,0.3)' : 'transparent',
                  cursor: item.soon ? 'default' : 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!active && !item.soon) (e.currentTarget.style.background = 'rgba(255,255,255,0.04)') }}
                onMouseLeave={e => { if (!active) (e.currentTarget.style.background = 'transparent') }}
              >
                <span style={{ fontSize: 14, opacity: item.soon ? 0.35 : 1 }}>{item.icon}</span>
                <span style={{
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: active ? 600 : 400,
                  color: item.soon ? 'rgba(214,217,212,0.3)' : active ? 'var(--cream)' : 'rgba(214,217,212,0.7)',
                  flex: 1, textAlign: 'left',
                }}>
                  {item.label}
                </span>
                {item.badge && (
                  <span style={{
                    background: 'rgba(200,149,42,0.2)', border: '1px solid rgba(200,149,42,0.4)',
                    color: 'var(--amber)', fontFamily: 'var(--font-mono)',
                    fontSize: 9, padding: '1px 6px', borderRadius: 8,
                  }}>
                    {item.badge}
                  </span>
                )}
                {item.soon && (
                  <span style={{
                    color: 'rgba(214,217,212,0.25)', fontFamily: 'var(--font-mono)',
                    fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase',
                  }}>
                    Soon
                  </span>
                )}
              </button>
            )
          })}

          {/* Query history — inside nav so it scrolls and never pushes the user footer off screen */}
          {queryLogs.length > 0 && (
            <div style={{ padding: '12px 0 0', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 8 }}>
              <div style={{ padding: '0 0 8px', fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.3)' }}>
                Recent queries
              </div>
              {queryLogs.map(log => (
                <button
                  key={log.id}
                  onClick={() => {
                    setQuestion(log.question)
                    setActiveNav('assistant')
                    textareaRef.current?.focus()
                  }}
                  title={log.question}
                  style={{
                    width: '100%', display: 'flex', flexDirection: 'column', gap: 2,
                    padding: '7px 0', borderRadius: 6, marginBottom: 1,
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    textAlign: 'left', transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{
                    fontFamily: 'var(--font-body)', fontSize: 11,
                    color: 'rgba(214,217,212,0.7)', whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis', display: 'block',
                  }}>
                    {log.question}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'rgba(214,217,212,0.25)', letterSpacing: '0.08em' }}>
                    {log.entity ?? ''}{log.entity && log.recordCount ? ' · ' : ''}{log.recordCount ? `${log.recordCount} records` : ''} · {formatRelativeTime(new Date(log.createdAt))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* Admin link — superadmin only */}
        {user?.role === 'superadmin' && (
          <div style={{ padding: '8px 10px 0' }}>
            <a href="/admin" style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 8,
              fontFamily: 'var(--font-body)', fontSize: 13,
              color: 'rgba(200,149,42,0.7)', textDecoration: 'none',
              transition: 'color 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--amber)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(200,149,42,0.7)')}
            >
              <span style={{ fontSize: 12 }}>⚙</span> Admin Portal
            </a>
          </div>
        )}

        {/* Upgrade / billing link — non-superadmin, non-partner-managed only */}
        {user?.role !== 'superadmin' && !managedByPartner && (
          <div style={{ padding: '4px 10px 0' }}>
            <button onClick={() => router.push('/billing')} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 8, border: 'none',
              background: 'transparent', cursor: 'pointer', textAlign: 'left',
              transition: 'background 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(200,149,42,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 13 }}>⭐</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(200,149,42,0.7)' }}>Upgrade / Billing</span>
            </button>
          </div>
        )}


        {/* Token usage meter */}
        {aiUsage && aiUsage.limit > 0 && (
          <div style={{ padding: '10px 20px 4px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: aiUsage.warning ? 'rgba(200,149,42,0.8)' : 'rgba(214,217,212,0.35)' }}>
                {aiUsage.warning ? '⚠ ' : ''}AI Tokens
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'rgba(214,217,212,0.35)' }}>
                {(aiUsage.used / 1000).toFixed(0)}k / {(aiUsage.limit / 1000).toFixed(0)}k
              </span>
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2, transition: 'width 0.4s',
                width: `${aiUsage.percentUsed}%`,
                background: aiUsage.percentUsed >= 100 ? '#A32D2D' : aiUsage.warning ? 'rgba(200,149,42,0.8)' : 'rgba(10,92,70,0.7)',
              }} />
            </div>
            {aiUsage.percentUsed >= 100 && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#A32D2D', marginTop: 4, letterSpacing: '0.06em' }}>
                Monthly limit reached{!managedByPartner ? ' — ' : ''}{!managedByPartner ? <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => router.push('/billing')}>upgrade to continue</span> : null}{managedByPartner && partnerReqState.upgradeRequestedAt ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.06em', color: '#8B949E' }}>{' — Requested ' + new Date(partnerReqState.upgradeRequestedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) + (partnerReqState.upgradeRequestedToEmail ? ' (' + partnerReqState.upgradeRequestedToEmail + ')' : '')}</span> : null}{managedByPartner && !partnerReqState.upgradeRequestedAt ? <button onClick={() => sendPartnerRequest('upgrade')} disabled={partnerReqLoading === 'upgrade'} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 8, color: partnerReqSent === 'upgrade' ? '#3FB950' : '#A32D2D', textDecoration: 'underline', letterSpacing: '0.06em' }}>{partnerReqSent === 'upgrade' ? ' ✓ Sent' : ' — Request upgrade'}</button> : null}
              </p>
            )}
          </div>
        )}

        {/* User */}
        <div style={{
          padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--jade), var(--forest))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: 'var(--cream)',
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--cream)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(user as any)?.preferredName || (user as any)?.firstName || user?.name || user?.email}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(214,217,212,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {user?.role === 'superadmin' ? 'Super Admin' : user?.role === 'tenant_admin' ? 'Admin' : 'User'}
            </div>
          </div>
          <button
            onClick={() => setShowChangePw(true)}
            title="Change password"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(214,217,212,0.3)', fontSize: 13, padding: 4, lineHeight: 1,
              transition: 'color 0.15s', flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--fog)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(214,217,212,0.3)')}
          >
            🔑
          </button>
          {isTenantAdmin && (
            <button
              onClick={() => router.push('/settings?tab=overview')}
              title="Settings"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(214,217,212,0.3)', fontSize: 14, padding: 4, lineHeight: 1,
                transition: 'color 0.15s', flexShrink: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--fog)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(214,217,212,0.3)')}
            >
              ⚙️
            </button>
          )}
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            title="Sign out"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(214,217,212,0.3)', fontSize: 14, padding: 4, lineHeight: 1,
              transition: 'color 0.15s', flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--fog)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(214,217,212,0.3)')}
          >
            ⎋
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#ffffff' }}>

        {/* Header */}
        <header style={{
          padding: isMobile ? '0 14px' : '0 28px', height: 60, flexShrink: 0,
          background: 'var(--white)', borderBottom: '1px solid var(--fog)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 14 }}>
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(o => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate)', fontSize: 16, padding: 4 }}
            >
              ☰
            </button>
            <div>
              <h1 style={{
                fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: isMobile ? 16 : 20,
                color: 'var(--ink)', lineHeight: 1,
              }}>
                {activeNav === 'assistant' ? 'CFO Assistant' : activeNav === 'customisations' ? 'Customisations' : activeNav === 'migration' ? 'Migration Analyser' : 'Data Health Scanner'}
              </h1>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
            {/* Live / offline badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: health.status === 'ok'
                ? 'rgba(26,146,114,0.08)'
                : health.status === 'error'
                ? 'rgba(163,45,45,0.08)'
                : 'rgba(100,100,100,0.06)',
              border: '1px solid ' + (health.status === 'ok' ? 'rgba(26,146,114,0.2)' : health.status === 'error' ? 'rgba(163,45,45,0.2)' : 'rgba(100,100,100,0.15)'),
              borderRadius: 20, padding: isMobile ? '4px 8px' : '4px 12px',
            }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%',
                background: health.status === 'ok' ? 'var(--jade)' : health.status === 'error' ? '#E24B4A' : 'rgba(150,150,150,0.5)',
                animation: health.status === 'ok' ? 'pulse 2s infinite' : 'none',
              }} />
              {!isMobile && <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: health.status === 'ok' ? 'var(--forest)' : health.status === 'error' ? '#A32D2D' : 'var(--slate)',
              }}>
                {health.status === 'ok' ? erpLabel + ' connected' : health.status === 'error' ? 'Agent offline' : 'Checking…'}
              </span>}
            </div>
            {/* Last checked + latency */}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fog)' }}>
              {health.checkedAt
                ? `Checked ${formatRelativeTime(health.checkedAt)}${health.latencyMs != null ? ` · ${health.latencyMs}ms` : ''}`
                : 'Connecting…'}
            </span>
          </div>
        </header>

        {/* ── CFO Assistant view ─────────────────────────────────────────────── */}
        {activeNav === 'assistant' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Tier blocked */}
            {tierBlocked && !managedByPartner && (
              <UpgradePrompt reason={tierBlocked.reason} trialEndsAt={tierBlocked.trialEndsAt} />
            )}
            {tierBlocked && managedByPartner && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '96px 32px', textAlign: 'center' }}>
                <div style={{ background: '#0c1610', border: '1px solid rgba(200,149,42,0.25)', borderRadius: 16, padding: '40px', maxWidth: 440, width: '100%' }}>
                  <div style={{ fontSize: 28, marginBottom: 16 }}>⭐</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--cream)', marginBottom: 12 }}>Usage limit reached</div>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--slate)', lineHeight: 1.7, marginBottom: 24 }}>
                    Your AI token allowance for this month has been used. Contact your partner to request an upgrade.
                  </p>
                  {partnerReqState.upgradeRequestedAt ? (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8B949E' }}>
                      {'Upgrade requested ' + new Date(partnerReqState.upgradeRequestedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                    </span>
                  ) : (
                    <button onClick={() => sendPartnerRequest('upgrade')} disabled={partnerReqLoading === 'upgrade'} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(200,149,42,0.1)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 6, color: 'var(--amber)', padding: '10px 20px', cursor: 'pointer' }}>
                      {partnerReqSent === 'upgrade' ? '✓ Request sent' : 'Request upgrade'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Chat area */}
            {!tierBlocked && <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>

              {/* Greeting / overview state */}
              {history.length === 0 && (
                <div style={{ maxWidth: 740, margin: '0 auto' }}>

                  {/* AI opening message — connection-aware */}
                  <div style={{
                    background: 'var(--white)', border: '1px solid var(--fog)',
                    borderRadius: '2px 16px 16px 16px', padding: '20px 24px', marginBottom: 28,
                    boxShadow: '0 2px 12px rgba(4,14,9,0.04)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: 'linear-gradient(135deg, var(--jade), var(--forest))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cream)',
                      }}>AI</div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)' }}>
                        {(branding.isWhiteLabel && branding.brandName ? branding.brandName : 'BespoxAI') + ' · Financial Assistant'}
                      </span>
                    </div>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)', lineHeight: 1.7 }}>
                      {greeting}, {displayFirst}.{' '}
                      {isConnected
                        ? <>I&apos;m connected to <strong>{tenantName}</strong> and ready to answer questions about your finances. What would you like to know?</>
                        : managedByPartner ? <>{'I\'m your ' + erpLabel + ' financial assistant. Your ' + erpLabel + ' system is not yet connected — your partner can set this up for you.'}</> : <>{'I\'m your ' + erpLabel + ' financial assistant. '}<a href="/settings?tab=installer" style={{ color: 'var(--forest)', fontWeight: 600, textDecoration: 'none' }}>{'Connect your ' + erpFullName + ' system'}</a>{' to start querying your live data.'}</>
                      }
                    </p>
                  </div>

                  {/* Overview cards — only shown when connected */}
                  {isConnected && <OverviewCards tenantName={tenantName} onQuery={(q) => { setQuestion(q); setTimeout(() => textareaRef.current?.focus(), 50) }} />}

                  {/* Not connected — setup prompt */}
                  {!isConnected && health.status !== 'checking' && !managedByPartner && (
                    <div style={{ background: 'rgba(200,149,42,0.06)', border: '1px solid rgba(200,149,42,0.2)', borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9A6A00', marginBottom: 10 }}>{'🔌 ' + erpLabel + ' not connected'}</p>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 6 }}>
                        {'Connect your ' + erpFullName + ' system to get started'}
                      </p>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', lineHeight: 1.65, marginBottom: 16 }}>
                        Your IT team needs to install the BCAgent on your server. It takes about 5 minutes and connects your system securely without opening any firewall ports.
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 16, paddingLeft: 12, borderLeft: '2px solid rgba(200,149,42,0.3)' }}>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink)', margin: 0 }}>1. Go to <a href="/settings?tab=installer" style={{ color: 'var(--forest)', fontWeight: 600, textDecoration: 'none' }}>{'Settings → ' + erpLabel + ' Installer'}</a></p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink)', margin: 0 }}>{'2. Enter your ' + erpLabel + ' credentials and download the installer'}</p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink)', margin: 0 }}>{'3. Run the installer on your ' + erpLabel + ' server as Administrator'}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <a href="/settings?tab=installer" style={{ display: 'inline-block', background: 'var(--forest)', color: '#fff', borderRadius: 8, padding: '9px 18px', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                          {'Go to ' + erpLabel + ' Installer →'}
                        </a>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)' }}>
                          Or use <button onClick={() => setActiveNav('customisations')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--forest)', fontWeight: 600, textDecoration: 'underline' }}>Customisations</button> to plan changes while you set up
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Partner-managed — not connected state */}
                  {!isConnected && health.status !== 'checking' && managedByPartner ? (
                    <div style={{ background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.15)', borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#58A6FF', marginBottom: 10 }}>{'🔌 ' + erpLabel + ' not yet connected'}</p>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 6 }}>
                        {'Your ' + erpLabel + ' system is not yet connected'}
                      </p>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', lineHeight: 1.65, marginBottom: 16 }}>
                        Your partner can connect your system using the BCAgent installer. Once installed, your live data will appear here automatically.
                      </p>
                      {partnerReqState.connectionRequestedAt ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--slate)', lineHeight: 1.6 }}>
                          {'✓ Requested on ' + new Date(partnerReqState.connectionRequestedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) + (partnerReqState.connectionRequestedToEmail ? ' — sent to ' + partnerReqState.connectionRequestedToEmail : '')}
                        </p>
                      ) : partnerReqSent === 'connection' ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--forest)', fontWeight: 500 }}>✓ Request sent — your partner has been notified</p>
                      ) : (
                        <button onClick={() => sendPartnerRequest('connection')} disabled={partnerReqLoading === 'connection'} style={{ background: 'var(--forest)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, cursor: partnerReqLoading === 'connection' ? 'default' : 'pointer', opacity: partnerReqLoading === 'connection' ? 0.6 : 1 }}>
                          {partnerReqLoading === 'connection' ? 'Sending…' : 'Request Connection Setup'}
                        </button>
                      )}
                    </div>
                  ) : null}

                  {/* Suggested questions — only when connected */}
                  {isConnected && (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--slate)' }}>
                          Suggested questions
                        </span>
                      </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {EXAMPLE_QUERIES.map(q => (
                      <button key={q}
                        onClick={() => { setQuestion(q); textareaRef.current?.focus() }}
                        style={{
                          background: 'var(--white)', border: '1px solid var(--fog)',
                          borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
                          fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)',
                          transition: 'border-color 0.15s, color 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--emerald)'; e.currentTarget.style.color = 'var(--forest)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--fog)'; e.currentTarget.style.color = 'var(--slate)' }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  </>
                  )}
                </div>
              )}

              {/* Message history */}
              <div style={{ maxWidth: 680, margin: '0 auto' }}>
                {history.map(item => (
                  <div key={item.id} style={{ marginBottom: 24 }}>

                    {/* User question */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                      <div style={{
                        background: 'var(--forest)', color: 'var(--cream)',
                        borderRadius: '16px 2px 16px 16px', padding: '11px 18px',
                        maxWidth: '72%', fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.55,
                        boxShadow: '0 2px 8px rgba(10,92,70,0.2)',
                      }}>
                        {item.question}
                      </div>
                    </div>

                    {/* AI answer */}
                    <div style={{
                      background: 'var(--white)', border: '1px solid var(--fog)',
                      borderRadius: '2px 16px 16px 16px', padding: '18px 22px',
                      maxWidth: '88%', boxShadow: '0 2px 12px rgba(4,14,9,0.04)',
                    }}>
                      {item.loading ? (
                        <LoadingDots />
                      ) : item.badQuery ? (
                        /* ── Bad query warning card ── */
                        <div style={{ borderLeft: '3px solid #C68B00', paddingLeft: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                            <span style={{ fontSize: 15 }}>⚠️</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8A6000', fontWeight: 600 }}>
                              Query not supported
                            </span>
                          </div>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', lineHeight: 1.65, marginBottom: 14 }}>
                            {item.answer}
                          </p>
                          {item.suggestedQueries && item.suggestedQueries.length > 0 && (
                            <div>
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8A6000', marginBottom: 8 }}>
                                Try asking instead
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {item.suggestedQueries.map((q, i) => (
                                  <button key={i}
                                    onClick={() => { setQuestion(q); textareaRef.current?.focus() }}
                                    style={{ background: '#FFFBEB', border: '1px solid #C68B00', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, color: '#5C4A00', textAlign: 'left', lineHeight: 1.4, transition: 'background 0.15s' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#FEF3C7' }}
                                    onMouseLeave={e => { e.currentTarget.style.background = '#FFFBEB' }}
                                  >
                                    → {q}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : item.error ? (
                        <div>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#A32D2D', lineHeight: 1.6, marginBottom: item.errorUrl ? 10 : 0 }}>
                            <strong>Error:</strong> {item.error}
                          </p>
                          {item.errorUrl && (
                            <details style={{ marginTop: 8 }}>
                              <summary style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', cursor: 'pointer' }}>
                                Debug info
                              </summary>
                              <code style={{ display: 'block', background: 'var(--parchment)', padding: '8px 12px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', wordBreak: 'break-all', lineHeight: 1.6, marginTop: 6 }}>
                                {item.errorUrl}
                              </code>
                              {item.errorDetail && (
                                <code style={{ display: 'block', background: '#FEF2F2', padding: '8px 12px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#A32D2D', wordBreak: 'break-all', lineHeight: 1.6, marginTop: 4 }}>
                                  {item.errorDetail}
                                </code>
                              )}
                            </details>
                          )}
                        </div>
                      ) : (
                        <>
                          {/* Data pulse decoration */}
                          <DataPulseBar />

                          <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)', lineHeight: 1.75, whiteSpace: 'pre-wrap', marginBottom: item.data ? 0 : item.meta ? 14 : 0 }}>
                            {item.answer}
                          </p>

                          {/* Suggested queries for generic answers */}
                          {item.suggestedQueries && item.suggestedQueries.length > 0 && (
                            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--fog)' }}>
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>
                                Ask about your data
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {item.suggestedQueries.map((q, i) => (
                                  <button key={i} onClick={() => { setQuestion(q); textareaRef.current?.focus() }}
                                    style={{ background: 'var(--cream)', border: '1px solid var(--fog)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', transition: 'border-color 0.15s' }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--emerald)'; e.currentTarget.style.color = 'var(--forest)' }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--fog)'; e.currentTarget.style.color = 'var(--slate)' }}
                                  >{q}</button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Chart / table / KPI visualizer */}
                          {item.displayHint && item.displayHint !== 'narrative' && item.data && (
                            <div style={{ marginBottom: item.meta ? 18 : 0 }}>
                              <DataVisualizer displayHint={item.displayHint} data={item.data} />
                            </div>
                          )}

                          {/* Meta footer */}
                          {item.meta && (
                            <div style={{ borderTop: '1px solid var(--fog)', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <button
                                onClick={() => { setExportItemId(item.id); setExportText(item.answer) }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--slate)', padding: 0, marginLeft: 'auto' }}
                              >
                                ↓ Export PDF
                              </button>
                              {item.displayHint && item.displayHint !== 'narrative' && (
                                <span style={{
                                  background: 'rgba(10,92,70,0.08)', border: '1px solid rgba(10,92,70,0.2)',
                                  color: 'var(--forest)', fontFamily: 'var(--font-mono)',
                                  fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                                  padding: '2px 8px', borderRadius: 6,
                                }}>
                                  {item.displayHint.replace('_', ' ')}
                                </span>
                              )}
                              <button
                                onClick={() => setShowMeta(showMeta === item.id ? null : item.id)}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  fontFamily: 'var(--font-mono)', fontSize: 9,
                                  letterSpacing: '0.1em', textTransform: 'uppercase',
                                  color: 'var(--slate)', padding: 0,
                                }}
                              >
                                {showMeta === item.id ? '▼' : '▶'} {item.meta.entity} · {item.meta.recordCount} records
                              </button>
                              {showMeta === item.id && (
                                <div style={{ width: '100%', marginTop: 8 }}>
                                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 6 }}>
                                    {item.meta.reasoning}
                                  </p>
                                  <code style={{
                                    display: 'block', background: 'var(--parchment)',
                                    padding: '8px 12px', borderRadius: 6,
                                    fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)',
                                    wordBreak: 'break-all', lineHeight: 1.6,
                                  }}>
                                    {item.meta.odataUrl}
                                  </code>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--fog)', marginTop: 5, paddingLeft: 4 }}>
                      {item.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </div>}

            {/* Input bar */}
            {!tierBlocked && <div style={{
              background: 'var(--white)', borderTop: '1px solid var(--fog)',
              padding: '16px 28px 20px',
            }}>
              <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <textarea
                  ref={textareaRef}
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Ask about your Business Central data…  (Enter to send, Shift+Enter for new line)"
                  style={{
                    flex: 1, background: 'var(--cream)', border: '1px solid var(--fog)',
                    borderRadius: 10, padding: '11px 16px', color: 'var(--ink)', fontSize: 14,
                    fontFamily: 'var(--font-body)', resize: 'none', outline: 'none',
                    lineHeight: 1.5, maxHeight: 120, overflowY: 'auto',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--fog)')}
                  onInput={e => {
                    const t = e.currentTarget; t.style.height = 'auto'
                    t.style.height = Math.min(t.scrollHeight, 120) + 'px'
                  }}
                />
                <button
                  onClick={runQuery}
                  disabled={!question.trim()}
                  style={{
                    background: question.trim() ? 'var(--forest)' : 'var(--fog)',
                    color: question.trim() ? 'var(--white)' : 'var(--slate)',
                    border: 'none', borderRadius: 10, padding: '11px 20px',
                    cursor: question.trim() ? 'pointer' : 'not-allowed',
                    fontSize: 16, fontWeight: 700, transition: 'background 0.15s',
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => { if (question.trim()) (e.currentTarget.style.background = 'var(--emerald)') }}
                  onMouseLeave={e => { if (question.trim()) (e.currentTarget.style.background = 'var(--forest)') }}
                >
                  →
                </button>
              </div>
            </div>}

          </div>
        )}

        {/* ── Health Scanner placeholder ─────────────────────────────────────── */}
        {activeNav === 'health' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              <HealthScoreCard />
            </div>
          </div>
        )}

        {/* ── Customisations ─────────────────────────────────────────────────── */}
        {activeNav === 'customisations' && (
          <RequirementsBuilder
            userRole={user?.role ?? 'user'}
            userId={user?.id ?? ''}
            tenantId={user?.tenantId ?? ''}
            bcConnected={isConnected}
            erpLabel={erpLabel}
            paymentSuccess={paymentSuccess}
            onPaymentSuccessDismiss={() => setPaymentSuccess(null)}
          />
        )}

        {/* ── Migration Analyser ────────────────────────────────────────────── */}
        {activeNav === 'migration' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
            <MigrationAnalyzerLanding />
          </div>
        )}
      </div>

      {/* PDF export modal */}
      {exportItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,14,9,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
          <div style={{ background: 'var(--white)', borderRadius: 16, padding: '28px 32px', width: 640, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(4,14,9,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>Export as PDF</h2>
              <button onClick={() => setExportItemId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate)', fontSize: 20 }}>✕</button>
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', marginBottom: 12 }}>Edit the text below before saving. Charts and tables will not be included in this version.</p>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>Question</div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', marginBottom: 16, padding: '10px 12px', background: 'var(--parchment)', borderRadius: 8 }}>{exportItem.question}</p>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>Answer</div>
            <textarea
              value={exportText}
              onChange={e => setExportText(e.target.value)}
              style={{ flex: 1, minHeight: 200, background: 'var(--cream)', border: '1px solid var(--fog)', borderRadius: 8, padding: '12px', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--ink)', resize: 'vertical', outline: 'none', lineHeight: 1.7 }}
              onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
              onBlur={e => (e.target.style.borderColor = 'var(--fog)')}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={() => {
                  const dataHTML = buildDataHTML(exportItem.displayHint, exportItem.data)

                  const w = window.open('', '_blank')!
                  w.document.write(`<!DOCTYPE html><html><head><title>${branding.isWhiteLabel && branding.brandName ? branding.brandName : 'BespoxAI'} — ${exportItem.question.slice(0,60)}</title><style>
                    body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; color: #1a1a1a; line-height: 1.7; }
                    .logo { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #888; margin-bottom: 32px; }
                    .question { font-size: 18px; font-weight: 600; margin-bottom: 24px; color: #0a5c46; }
                    .answer { font-size: 15px; white-space: pre-wrap; margin-bottom: 28px; }
                    .meta { font-size: 11px; color: #888; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px; }
                    /* KPI cards */
                    .kpi-grid { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 28px; }
                    .kpi-card { border: 1px solid #d4d0c8; border-radius: 10px; padding: 16px 20px; min-width: 140px; flex: 1; }
                    .kpi-primary { background: #0a5c46; color: #fff; border-color: #0a5c46; }
                    .kpi-label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.7; margin-bottom: 6px; }
                    .kpi-value { font-size: 22px; font-weight: 700; }
                    .kpi-sub { font-size: 11px; opacity: 0.6; margin-top: 4px; }
                    /* Data table */
                    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 28px; }
                    th { background: #0a5c46; color: #fff; padding: 8px 12px; text-align: left; font-size: 11px; letter-spacing: 0.06em; }
                    td { padding: 7px 12px; border-bottom: 1px solid #eee; }
                    tr:nth-child(even) td { background: #f9f7f2; }
                    .chart-note { font-size: 11px; color: #888; margin-bottom: 8px; font-style: italic; }
                    @media print { body { margin: 20px; } .kpi-grid { break-inside: avoid; } table { break-inside: auto; } }
                  </style></head><body>
                    <div class="logo">${branding.isWhiteLabel && branding.brandName ? branding.brandName : 'BespoxAI'} · ${tenantName} · ${new Date().toLocaleDateString('en-NZ', { dateStyle: 'long' })}</div>
                    <div class="question">${exportItem.question}</div>
                    <div class="answer">${exportText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
                    ${dataHTML}
                    <div class="meta">Generated by ${branding.isWhiteLabel && branding.brandName ? branding.brandName : 'BespoxAI'} CFO Assistant · ${exportItem.ts.toLocaleString()}</div>
                  </body></html>`)
                  w.document.close()
                  setExportItemId(null)
                  setTimeout(() => { w.print(); }, 300)
                }}
                style={{ background: 'var(--forest)', color: 'var(--white)', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500 }}
              >
                Save as PDF
              </button>
              <button onClick={() => setExportItemId(null)} style={{ background: 'var(--fog)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Change password modal */}
      {showChangePw && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,14,9,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--white)', borderRadius: 16, padding: '28px 32px', width: 400, maxWidth: '90vw', boxShadow: '0 8px 40px rgba(4,14,9,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>Change password</h2>
              <button onClick={() => { setShowChangePw(false); setPwError(''); setPwForm({ current: '', next: '', confirm: '' }) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate)', fontSize: 20 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Current password', key: 'current' },
                { label: 'New password',     key: 'next' },
                { label: 'Confirm new password', key: 'confirm' },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', display: 'block', marginBottom: 6 }}>{label}</label>
                  <input
                    type="password"
                    value={pwForm[key as keyof typeof pwForm]}
                    onChange={e => setPwForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: '100%', background: 'var(--cream)', border: '1px solid var(--fog)', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
                    onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                    onBlur={e => (e.target.style.borderColor = 'var(--fog)')}
                  />
                </div>
              ))}
            </div>
            {pwError   && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#A32D2D', marginTop: 12 }}>{pwError}</p>}
            {pwSuccess && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--forest)', marginTop: 12 }}>Password updated successfully.</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button
                onClick={changePassword}
                disabled={pwSaving || !pwForm.current || !pwForm.next || !pwForm.confirm}
                style={{ background: 'var(--forest)', color: 'var(--white)', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, opacity: (pwSaving || !pwForm.current || !pwForm.next || !pwForm.confirm) ? 0.6 : 1 }}
              >
                {pwSaving ? 'Saving…' : 'Update password'}
              </button>
              <button onClick={() => { setShowChangePw(false); setPwError(''); setPwForm({ current: '', next: '', confirm: '' }) }} style={{ background: 'var(--fog)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const diffMs  = Date.now() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 10)  return 'just now'
  if (diffSec < 60)  return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60)  return `${diffMin}m ago`
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--forest)', opacity: 0.3,
          animation: `dotPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { transform: scale(1); opacity: 0.3; }
          40%            { transform: scale(1.35); opacity: 0.8; }
        }
      `}</style>
    </div>
  )
}

function DataPulseBar() {
  return (
    <div style={{ marginBottom: 14 }}>
      <svg width="120" height="20" viewBox="0 0 120 20" fill="none">
        <line x1="0" y1="10" x2="18" y2="10" stroke="var(--fog)" strokeWidth="1.5" />
        <path d="M18 10L30 10L36 3L42 17L48 6L54 14L60 10L102 10"
          stroke="var(--forest)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="60" cy="10" r="2.5" fill="var(--gold)" />
        <line x1="102" y1="10" x2="120" y2="10" stroke="var(--fog)" strokeWidth="1.5" />
      </svg>
    </div>
  )
}

function HealthScoreCard() {
  const findings = [
    { severity: 'Critical', title: 'Duplicate VAT registration numbers', detail: '14 customers share VAT numbers — potential compliance risk and fraud exposure' },
    { severity: 'Critical', title: 'G/L balance discrepancy detected', detail: '3 accounts show net imbalance totalling $2,140 — likely from a failed posting batch' },
    { severity: 'Critical', title: 'Bank reconciliation 47 days overdue', detail: 'Reserve account has not been reconciled since 11 March — period is still open' },
    { severity: 'Warning',  title: '4 vendors without payment terms', detail: 'Missing terms cause inconsistent due date calculation on AP ageing reports' },
    { severity: 'Warning',  title: 'Dimension gaps on 23 transactions', detail: 'Sales journal entries missing required department dimension — affects management reporting' },
    { severity: 'Warning',  title: 'Number series approaching limit', detail: 'Sales Invoice series (SI-) at 94% capacity — will fail to post when exhausted' },
    { severity: 'Info',     title: '2 inactive user accounts with SUPER role', detail: 'Former employees retain full permissions — recommend removing access' },
  ]

  const colors = {
    Critical: { bg: 'rgba(163,45,45,0.06)', border: 'rgba(163,45,45,0.2)', text: '#A32D2D' },
    Warning:  { bg: 'rgba(200,149,42,0.08)', border: 'rgba(200,149,42,0.25)', text: 'var(--gold)' },
    Info:     { bg: 'rgba(59,82,73,0.06)',  border: 'rgba(59,82,73,0.2)',  text: 'var(--slate)' },
  }

  return (
    <>
      {/* Score card */}
      <div style={{
        background: 'var(--ink)', borderRadius: 16, padding: '28px 32px',
        display: 'flex', alignItems: 'center', gap: 32, marginBottom: 24,
      }}>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 64, fontWeight: 300, color: 'var(--amber)', lineHeight: 1 }}>63</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.4)', marginTop: 4 }}>/ 100</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300, color: 'var(--cream)', marginBottom: 6 }}>
            Moderate — attention required
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(214,217,212,0.6)', lineHeight: 1.6 }}>
            3 critical issues and 4 warnings found across 34 automated checks. Run a fresh scan to update.
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            {[['3', 'Critical', '#A32D2D'], ['4', 'Warnings', 'var(--amber)'], ['0', 'Info', 'var(--slate)']].map(([n, label, color]) => (
              <div key={label} style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8, padding: '6px 14px', textAlign: 'center',
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: color as string }}>{n}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(214,217,212,0.35)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Findings list */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 12 }}>
        All findings · Last scan: Today 9:14am · 34 checks run
      </div>
      {findings.map((f, i) => {
        const c = colors[f.severity as keyof typeof colors]
        return (
          <div key={i} style={{
            background: c.bg, border: `1px solid ${c.border}`,
            borderRadius: 10, padding: '14px 18px', marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: c.text, marginTop: 2, flexShrink: 0,
              }}>{f.severity}</span>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>{f.title}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--slate)', lineHeight: 1.5 }}>{f.detail}</div>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}

// ─── Overview Cards — live CFO snapshot ──────────────────────────────────────

interface OverviewCard {
  label: string
  value: string
  sub?:  string
  color?: string
  query: string  // the natural-language query to run on click
}

function OverviewCards({ tenantName, onQuery }: { tenantName: string; onQuery: (q: string) => void }) {
  const [cards, setCards]     = useState<OverviewCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    async function fetchOverview() {
      setLoading(true)
      try {
        // Run four lightweight BC queries in parallel via the existing /api/query endpoint
        const queries = [
          { label: 'Overdue debtors',     question: 'Total overdue debtor balance today as a single dollar figure' },
          { label: 'Cash & bank',         question: 'Total cash and bank balance right now as a single dollar figure' },
          { label: 'Outstanding payables',question: 'Total outstanding payables balance today as a single dollar figure' },
          { label: 'Month revenue',       question: 'Total revenue billed this month as a single dollar figure' },
        ]

        const results = await Promise.allSettled(
          queries.map(q =>
            fetch('/api/query', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ question: q.question, history: [] }),
            }).then(r => r.json())
          )
        )

        const built: OverviewCard[] = queries.map((q, i) => {
          const result = results[i]
          if (result.status === 'rejected') {
            return { label: q.label, value: '—', sub: 'unavailable', query: q.question }
          }
          const data = result.value
          // Extract KPI value from response
          const kpi = data?.data?.kpis?.[0]
          if (kpi) {
            return { label: q.label, value: kpi.value, sub: kpi.subtext, query: q.question }
          }
          // Fallback — extract first number-like thing from answer text
          const match = (data?.answer ?? '').match(/\$[\d,]+(\.\d+)?|[\d,]+(\.\d+)?\s*(million|thousand|k|m)?/i)
          return {
            label: q.label,
            value: match ? match[0] : '—',
            sub:   match ? undefined : 'no data',
            query: q.question,
          }
        })

        setCards(built)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    fetchOverview()
  }, [tenantName])

  if (error) return null  // silent fail — don't break the page

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--slate)' }}>
          Live snapshot · {tenantName}
        </span>
        {loading && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', letterSpacing: '0.08em' }}>Loading…</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 18px', minHeight: 76, animation: 'pulse 1.5s infinite' }} />
            ))
          : cards.map(card => (
              <button
                key={card.label}
                onClick={() => onQuery(card.query)}
                style={{
                  background: 'var(--white)', border: '1px solid var(--fog)',
                  borderRadius: 10, padding: '16px 18px', cursor: 'pointer',
                  textAlign: 'left', transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(10,92,70,0.3)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(10,92,70,0.07)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--fog)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 8 }}>
                  {card.label}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 400, color: card.value === '—' ? 'var(--fog)' : 'var(--ink)', lineHeight: 1, marginBottom: 4 }}>
                  {card.value}
                </div>
                {card.sub && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', letterSpacing: '0.06em' }}>{card.sub}</div>
                )}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'rgba(10,92,70,0.4)', marginTop: 8, letterSpacing: '0.08em' }}>
                  Click to explore →
                </div>
              </button>
            ))
        }
      </div>
    </div>
  )
}
