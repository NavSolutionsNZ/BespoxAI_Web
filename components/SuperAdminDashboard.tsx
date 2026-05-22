'use client'

import { useState, useEffect, useCallback } from 'react'

interface Tenant {
  id: string; name: string; tunnelSubdomain: string; active: boolean
  tier: string; createdAt: string; subscriptionStatus: string | null
  _count: { users: number; queryLogs: number; requirements: number }
  queryLogs: { createdAt: string }[]
}

interface Requirement {
  id: string; title: string; status: string; priority: string
  createdAt: string; updatedAt: string
  tenant: { name: string }
  user: { name: string | null; email: string }
}

interface MigrationEnquiry {
  id: string; contactName: string | null; phone: string
  version: string; users: string; urgency: string | null
  notes: string | null; status: string; createdAt: string
  tenant: { name: string }
  user: { name: string | null; email: string }
}

interface PlanChange { customer: string; from: string; to: string; mrrDelta: number; changedAt: string }

interface BillingStats {
  mrr: number
  active: number
  totalLostMRR: number
  byTier: Record<string, number>
  newToday:   { count: number; valueNZD: number; byTier: Record<string, number> }
  newMonth:   { count: number; valueNZD: number; byTier: Record<string, number>; list: { customer: string; plan: string; startedAt: string; valueNZD: number }[] }
  upgrades:   { count: number; list: PlanChange[] }
  downgrades: { count: number; lostMRR: number; list: PlanChange[] }
  cancelled:  { count: number; lostMRR: number; list: { customer: string; plan: string; cancelledAt: string; reason: string | null; feedback: string | null; comment: string | null; lostMRR: number }[] }
  reviews: {
    allTime:   { count: number; revenueNZD: number }
    thisMonth: { count: number; revenueNZD: number }
    list: { id?: string; tenant: string; customer: string; title: string; paidAt: string; amountNZD: number }[]
  }
  byTenant: { name: string; mrr: number; devRevenue: number; reviewRevenue: number; total: number }[]
  dev?: {
    allTime:   { deposits: { count: number; revenueNZD: number }; balances: { count: number; revenueNZD: number }; totalNZD: number }
    thisMonth: { deposits: { count: number; revenueNZD: number }; balances: { count: number; revenueNZD: number }; totalNZD: number }
    recentDeposits: { id?: string; tenant: string; title: string; paidAt: string; amountNZD: number }[]
    recentBalances: { id?: string; tenant: string; title: string; paidAt: string; amountNZD: number }[]
  }
}

interface TenantHealth {
  tenantId: string
  status: 'checking' | 'ok' | 'error' | 'idle'
  latencyMs?: number
  error?: string
}

interface SignupRequest {
  id: string; companyName: string; email: string
  verifiedAt: string | null; activatedAt: string | null; createdAt: string
}

const ATTENTION: Record<string, { label: string; color: string; bg: string; border: string; action: string }> = {
  submitted:                { label: 'New Request',            color: '#0A5C46', bg: 'rgba(10,92,70,0.06)',    border: 'rgba(10,92,70,0.2)',    action: 'Review & quote'      },
  needs_clarification:      { label: 'Customer Replied',       color: '#1A9272', bg: 'rgba(26,146,114,0.06)',  border: 'rgba(26,146,114,0.25)', action: 'Review answers'      },
  quote_rejected:           { label: 'Quote Rejected',         color: '#A32D2D', bg: 'rgba(163,45,45,0.06)',   border: 'rgba(163,45,45,0.2)',   action: 'Revise quote'        },
  deposit_paid:             { label: 'Ready to Start',         color: '#C8952A', bg: 'rgba(200,149,42,0.08)',  border: 'rgba(200,149,42,0.25)', action: 'Begin development'   },
  complete_pending_payment: { label: 'Awaiting Final Payment', color: '#C8952A', bg: 'rgba(200,149,42,0.08)',  border: 'rgba(200,149,42,0.25)', action: 'Confirm & close'     },
}

function relativeTime(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function TierBadge({ tier }: { tier: string }) {
  const c: Record<string, [string,string]> = {
    trial:      ['#C8952A', 'rgba(200,149,42,0.1)'],
    paid:       ['#0A5C46', 'rgba(10,92,70,0.1)'],
    enterprise: ['#1A9272', 'rgba(26,146,114,0.1)'],
  }
  const [color, bg] = c[tier] ?? c.trial
  return (
    <span style={{ fontFamily:'var(--font-mono)', fontSize:8, letterSpacing:'0.1em', textTransform:'uppercase', padding:'2px 8px', borderRadius:6, color, background:bg }}>{tier}</span>
  )
}

const TIER_COLORS: Record<string, [string, string]> = {
  assistant: ['#0A5C46', 'rgba(10,92,70,0.1)'],
  manager:   ['#1A9272', 'rgba(26,146,114,0.1)'],
  executive: ['#C8952A', 'rgba(200,149,42,0.1)'],
}

function TierBreakdown({ byTier }: { byTier: Record<string, number> }) {
  const tiers = ['assistant', 'manager', 'executive'].filter(t => (byTier[t] ?? 0) > 0)
  if (tiers.length === 0) return null
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
      {tiers.map(t => {
        const [color, bg] = TIER_COLORS[t] ?? ['var(--slate)', 'var(--fog)']
        return (
          <span key={t} style={{ fontFamily:'var(--font-mono)', fontSize:8, letterSpacing:'0.08em', textTransform:'uppercase', padding:'2px 7px', borderRadius:6, color, background:bg }}>
            {t} · {byTier[t]}
          </span>
        )
      })}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--slate)', marginBottom:12, marginTop:28 }}>{children}</div>
}

export default function SuperAdminDashboard({ onNavigate }: { onNavigate: (tab: string, reqId?: string) => void }) {
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [enquiries,    setEnquiries]    = useState<MigrationEnquiry[]>([])
  const [tenants,      setTenants]      = useState<Tenant[]>([])
  const [signups,      setSignups]      = useState<SignupRequest[]>([])
  const [health,       setHealth]       = useState<Record<string, TenantHealth>>({})
  const [loading,      setLoading]      = useState(true)
  const [billing,      setBilling]      = useState<BillingStats | null>(null)
  const [showTenantDrill, setShowTenantDrill] = useState(false)
  const [showAttentionDrill, setShowAttentionDrill] = useState(false)
  const [financeDrill, setFinanceDrill] = useState<string|null>(null)  // which section is drilled: 'subscriptions'|'reviews'|'deposits'|'balances'|'upgrades'|'downgrades'|'cancellations'

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/requirements').then(r => r.json()),
      fetch('/api/admin/migration-enquiries').then(r => r.json()),
      fetch('/api/admin/tenants').then(r => r.json()),
      fetch('/api/admin/signups').then(r => r.json()),
      fetch('/api/admin/billing-stats').then(r => r.json()),
    ]).then(([reqs, enqs, ten, sigs, bil]) => {
      // Merge top-level + addenda so attention and revenue counts include them
      const addenda = (reqs.allAddenda ?? []).map((a: any) => ({ ...a, addenda: [] }))
      setRequirements([...(reqs.requirements ?? []), ...addenda])
      setEnquiries(enqs.enquiries ?? [])
      setTenants(ten.tenants ?? [])
      setSignups((sigs.signups ?? []).filter((s: SignupRequest) => s.verifiedAt && !s.activatedAt))
      if (!bil.error) setBilling(bil)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const checkHealth = useCallback(async (tenantId: string) => {
    setHealth(prev => ({ ...prev, [tenantId]: { tenantId, status: 'checking' } }))
    try {
      const res  = await fetch(`/api/admin/tenant-health/${tenantId}`)
      const data = await res.json()
      setHealth(prev => ({ ...prev, [tenantId]: { tenantId, status: data.ok ? 'ok' : 'error', latencyMs: data.latencyMs, error: data.error } }))
    } catch {
      setHealth(prev => ({ ...prev, [tenantId]: { tenantId, status: 'error', error: 'Network error' } }))
    }
  }, [])

  useEffect(() => {
    if (tenants.length > 0) tenants.filter(t => t.active).forEach(t => checkHealth(t.id))
  }, [tenants, checkHealth])

  async function updateEnquiryStatus(id: string, status: string) {
    await fetch('/api/admin/migration-enquiries', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setEnquiries(prev => prev.map(e => e.id === id ? { ...e, status } : e))
  }

  const attentionReqs  = requirements.filter(r => r.status in ATTENTION)
  const newEnquiries   = enquiries.filter(e => e.status === 'new')
  const totalAttention = attentionReqs.length + newEnquiries.length + signups.length

  if (loading) {
    return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>Loading dashboard…</div>
  }

  return (
    <div style={{ maxWidth: 1000 }}>

      {/* ── Primary KPIs ─────────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:14 }}>
        {/* Needs Attention */}
        <div
          onClick={() => totalAttention > 0 && setShowAttentionDrill(d => !d)}
          style={{ background:totalAttention>0?'rgba(163,45,45,0.06)':'var(--white)', border:`1px solid ${totalAttention>0?'rgba(163,45,45,0.2)':'var(--fog)'}`, borderRadius:12, padding:'18px 20px', cursor: totalAttention > 0 ? 'pointer' : 'default', transition: 'box-shadow 0.15s', gridColumn: showAttentionDrill ? '1 / -1' : undefined }}
          onMouseEnter={e => { if (totalAttention > 0) e.currentTarget.style.boxShadow = '0 2px 12px rgba(163,45,45,0.12)' }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--slate)', marginBottom:8 }}>Needs attention</div>
              <div style={{ fontFamily:'var(--font-display)', fontSize:42, fontWeight:300, color:totalAttention>0?'#A32D2D':'var(--ink)', lineHeight:1 }}>{totalAttention}</div>
              {totalAttention>0&&<div style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'#A32D2D', marginTop:6, letterSpacing:'0.1em', textTransform:'uppercase' }}>action required · click to {showAttentionDrill ? 'collapse' : 'expand'}</div>}
            </div>
            {totalAttention > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                {Object.entries(
                  attentionReqs.reduce((acc: Record<string, number>, r) => { acc[ATTENTION[r.status]?.label ?? r.status] = (acc[ATTENTION[r.status]?.label ?? r.status] ?? 0) + 1; return acc }, {})
                ).map(([label, count]) => (
                  <span key={label} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#A32D2D', background: 'rgba(163,45,45,0.08)', border: '1px solid rgba(163,45,45,0.15)', borderRadius: 5, padding: '2px 8px' }}>
                    {count} {label}
                  </span>
                ))}
                {newEnquiries.length > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#1A9272', background: 'rgba(26,146,114,0.08)', border: '1px solid rgba(26,146,114,0.2)', borderRadius: 5, padding: '2px 8px' }}>{newEnquiries.length} Migration Enquiry</span>}
                {signups.length > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)', background: 'var(--cream)', border: '1px solid var(--fog)', borderRadius: 5, padding: '2px 8px' }}>{signups.length} Signup Request</span>}
              </div>
            )}
          </div>

          {/* Inline drill-down */}
          {showAttentionDrill && totalAttention > 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid rgba(163,45,45,0.15)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {attentionReqs.map(req => {
                const s = ATTENTION[req.status]
                return (
                  <div key={req.id} onClick={() => onNavigate('requirements', req.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', background: 'rgba(255,255,255,0.6)', borderRadius: 8, border: `1px solid ${s.border}`, cursor: 'pointer' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: s.color, fontWeight: 600 }}>{s.label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)' }}>· {req.tenant.name}</span>
                      </div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{req.title}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', marginTop: 2 }}>{req.user.name || req.user.email} · updated {relativeTime(req.updatedAt)}</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); onNavigate('requirements', req.id) }} style={{ flexShrink: 0, background: 'none', border: `1px solid ${s.border}`, borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, color: s.color, whiteSpace: 'nowrap' }}>
                      {s.action} →
                    </button>
                  </div>
                )
              })}
              {newEnquiries.length > 0 && newEnquiries.map(enq => (
                <div key={enq.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', background: 'rgba(255,255,255,0.6)', borderRadius: 8, border: '1px solid rgba(26,146,114,0.2)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, textTransform: 'uppercase', color: '#1A9272', fontWeight: 600 }}>Migration Enquiry</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--slate)' }}>· {enq.tenant.name}</span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{enq.version} · {enq.users} users</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', marginTop: 2 }}>{enq.contactName || enq.user.email} · {enq.phone} · {relativeTime(enq.createdAt)}</div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); updateEnquiryStatus(enq.id, 'contacted') }} style={{ flexShrink: 0, background: '#1A9272', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9 }}>Mark contacted</button>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* MRR */}
        <div style={{ background:'var(--white)', border:'1px solid var(--fog)', borderRadius:12, padding:'18px 20px' }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--slate)', marginBottom:8 }}>MRR (NZD)</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:42, fontWeight:300, color:'var(--forest)', lineHeight:1, marginBottom:8 }}>${(billing?.mrr??0).toLocaleString()}</div>
          {billing&&<TierBreakdown byTier={billing.byTier} />}
        </div>
        {/* Revenue this month */}
        <div style={{ background:'rgba(10,92,70,0.05)', border:'1px solid rgba(10,92,70,0.18)', borderRadius:12, padding:'18px 20px' }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--slate)', marginBottom:8 }}>Revenue / month</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:42, fontWeight:300, color:'var(--forest)', lineHeight:1 }}>${((billing?.newMonth.valueNZD??0)+(billing?.reviews.thisMonth.revenueNZD??0)+(billing?.dev?.thisMonth.totalNZD??0)).toLocaleString()}</div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)', marginTop:6 }}>subscriptions + spec reviews + development</div>
        </div>
        {/* Registered / Online — split card with drill-down */}
        {(()=>{
          const registered = tenants.filter(t=>t.active).length
          const online     = Object.values(health).filter(h=>h.status==='ok').length
          const checking   = Object.values(health).filter(h=>h.status==='checking').length
          const offline    = registered - online - checking
          return (
            <button
              onClick={()=>setShowTenantDrill(p=>!p)}
              style={{ background:'var(--white)', border:`1px solid ${showTenantDrill?'rgba(10,92,70,0.35)':'var(--fog)'}`, borderRadius:12, padding:'18px 20px', display:'flex', flexDirection:'column', gap:10, cursor:'pointer', textAlign:'left', transition:'border-color 0.15s' }}
            >
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--slate)', marginBottom:4 }}>Registered</div>
                  <div style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:300, color:'var(--ink)', lineHeight:1 }}>{registered}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--slate)', marginBottom:4 }}>Online</div>
                  <div style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:300, color:online>0?'var(--forest)':'#A32D2D', lineHeight:1 }}>{checking>0&&online===0?'…':online}</div>
                </div>
              </div>
              <div style={{ borderTop:'1px solid var(--fog)', paddingTop:8, display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                {online>0&&<span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--jade)', background:'rgba(26,146,114,0.1)', padding:'2px 7px', borderRadius:5 }}>● {online} live</span>}
                {offline>0&&<span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'#E24B4A', background:'rgba(226,75,74,0.08)', padding:'2px 7px', borderRadius:5 }}>● {offline} offline</span>}
                {checking>0&&<span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--slate)', background:'rgba(59,82,73,0.08)', padding:'2px 7px', borderRadius:5 }}>↻ checking</span>}
                <span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)', marginLeft:'auto' }}>{showTenantDrill?'▲':'▼'}</span>
              </div>
            </button>
          )
        })()}
      </div>

      {/* ── Tenant drill-down panel ───────────────────────────────────────── */}
      {showTenantDrill&&(
        <div style={{ background:'var(--white)', border:'1px solid rgba(10,92,70,0.2)', borderRadius:12, overflow:'hidden', marginBottom:8 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--fog)', background:'rgba(10,92,70,0.03)' }}>
                {['Tenant','Plan','Connection','Users','Queries','Custom.','Last active',''].map(h=>(
                  <th key={h} style={{ padding:'9px 14px', textAlign:'left', fontFamily:'var(--font-mono)', fontSize:8, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--slate)', fontWeight:500, whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant,i)=>{
                const h = health[tenant.id]
                const isOnline   = h?.status==='ok'
                const isChecking = h?.status==='checking'
                const isError    = h?.status==='error'
                const isPaid     = tenant.subscriptionStatus==='active'
                const isTrial    = tenant.tier==='trial'||tenant.tier==='free'
                return (
                  <tr key={tenant.id} style={{ borderBottom:i<tenants.length-1?'1px solid var(--fog)':'none', opacity:tenant.active?1:0.5 }}>
                    {/* Tenant name */}
                    <td style={{ padding:'11px 14px' }}>
                      <div style={{ fontFamily:'var(--font-body)', fontSize:13, fontWeight:600, color:'var(--ink)' }}>{tenant.name}</div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--slate)', marginTop:2 }}>{tenant.tunnelSubdomain}</div>
                    </td>
                    {/* Plan / tier */}
                    <td style={{ padding:'11px 14px' }}>
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        <TierBadge tier={tenant.tier} />
                        {!isPaid&&!isTrial&&<span style={{ fontFamily:'var(--font-mono)', fontSize:7, color:'#A32D2D', letterSpacing:'0.1em', textTransform:'uppercase' }}>no active sub</span>}
                        {isTrial&&<span style={{ fontFamily:'var(--font-mono)', fontSize:7, color:'var(--slate)', letterSpacing:'0.1em', textTransform:'uppercase' }}>trial</span>}
                      </div>
                    </td>
                    {/* Connection status */}
                    <td style={{ padding:'11px 14px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <div style={{ width:6, height:6, borderRadius:'50%', flexShrink:0, background:isOnline?'var(--jade)':isChecking?'var(--slate)':'#E24B4A' }} />
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:isOnline?'var(--jade)':isChecking?'var(--slate)':'#E24B4A' }}>
                          {isOnline?`Live · ${h.latencyMs}ms`:isChecking?'Checking…':isError?(h.error??'Offline'):'Offline'}
                        </span>
                        <button onClick={e=>{e.stopPropagation();checkHealth(tenant.id)}} disabled={isChecking} title="Recheck" style={{ background:'none', border:'none', cursor:isChecking?'default':'pointer', color:'var(--slate)', fontSize:11, padding:'0 2px', lineHeight:1 }}>↻</button>
                      </div>
                      {isError&&h.error&&<div style={{ fontFamily:'var(--font-mono)', fontSize:7, color:'#A32D2D', marginTop:3, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{h.error}</div>}
                    </td>
                    {/* Stats */}
                    <td style={{ padding:'11px 14px', fontFamily:'var(--font-mono)', fontSize:12, color:'var(--ink)', textAlign:'center' }}>{tenant._count.users}</td>
                    <td style={{ padding:'11px 14px', fontFamily:'var(--font-mono)', fontSize:12, color:'var(--ink)', textAlign:'center' }}>{tenant._count.queryLogs}</td>
                    <td style={{ padding:'11px 14px', fontFamily:'var(--font-mono)', fontSize:12, color:tenant._count.requirements>0?'var(--forest)':'var(--slate)', textAlign:'center', fontWeight:tenant._count.requirements>0?600:400 }}>{tenant._count.requirements}</td>
                    {/* Last active */}
                    <td style={{ padding:'11px 14px', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--slate)', whiteSpace:'nowrap' }}>
                      {tenant.queryLogs?.[0] ? relativeTime(tenant.queryLogs[0].createdAt) : <span style={{ color:'var(--fog)' }}>never</span>}
                    </td>
                    {/* Upgrade nudge */}
                    <td style={{ padding:'11px 14px' }}>
                      {isTrial&&(
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:7, letterSpacing:'0.08em', textTransform:'uppercase', color:'#9A6A00', background:'rgba(200,149,42,0.1)', border:'1px solid rgba(200,149,42,0.25)', padding:'2px 7px', borderRadius:5, whiteSpace:'nowrap' }}>↑ upgrade opportunity</span>
                      )}
                      {!isOnline&&!isChecking&&!isTrial&&isPaid&&(
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:7, letterSpacing:'0.08em', textTransform:'uppercase', color:'#A32D2D', background:'rgba(163,45,45,0.06)', border:'1px solid rgba(163,45,45,0.18)', padding:'2px 7px', borderRadius:5, whiteSpace:'nowrap' }}>connection issue</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Revenue composition + Monthly activity ───────────────────────── */}
      {billing&&(()=>{
        const subRev      = billing.newMonth.valueNZD
        const revFees     = billing.reviews.thisMonth.revenueNZD
        const devRev      = billing.dev?.thisMonth.totalNZD ?? 0
        const totalMoRev  = subRev + revFees + devRev
        const subPct      = totalMoRev>0 ? (subRev/totalMoRev)*100 : (billing.mrr>0?100:0)
        const revPct      = totalMoRev>0 ? (revFees/totalMoRev)*100 : 0
        const devPct      = totalMoRev>0 ? (devRev/totalMoRev)*100 : 0
        const TMRR: Record<string,number> = {assistant:299,manager:499,executive:999}
        const TC:   Record<string,string> = {assistant:'#0A5C46',manager:'#1A9272',executive:'#C8952A'}
        const activeTiers = ['assistant','manager','executive'].filter(t=>(billing.byTier[t]??0)>0)
        const netMRRChange = (billing.newMonth.count * (billing.newMonth.valueNZD / Math.max(billing.newMonth.count,1)))
          - billing.totalLostMRR

        return (
          <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:24 }}><div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:14 }}>

            {/* Revenue composition */}
            <div style={{ background:'var(--white)', border:'1px solid var(--fog)', borderRadius:12, padding:'20px 24px' }}>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--slate)', marginBottom:18 }}>Revenue composition</div>
              <div style={{ display:'flex', gap:24, alignItems:'center' }}>
                {/* Donut */}
                <div style={{ width:104, height:104, borderRadius:'50%', flexShrink:0,
                  background:`conic-gradient(#0A5C46 0% ${subPct}%, #C8952A ${subPct}% ${subPct+revPct}%, #1A9272 ${subPct+revPct}% ${subPct+revPct+devPct}%, var(--fog) ${subPct+revPct+devPct}% 100%)`,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <div style={{ width:68, height:68, borderRadius:'50%', background:'var(--white)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:1 }}>
                    <span style={{ fontFamily:'var(--font-display)', fontSize:16, color:'var(--forest)', lineHeight:1 }}>${totalMoRev.toLocaleString()}</span>
                    <span style={{ fontFamily:'var(--font-mono)', fontSize:6, color:'var(--slate)', letterSpacing:'0.12em', textTransform:'uppercase' }}>this month</span>
                  </div>
                </div>
                {/* Breakdown */}
                <div style={{ flex:1, display:'flex', flexDirection:'column', gap:12 }}>
                  {/* Subscriptions */}
                  <div>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <div style={{ width:8, height:8, borderRadius:2, background:'#0A5C46' }} />
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>Subscriptions</span>
                      </div>
                      <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--forest)', fontWeight:600 }}>${subRev.toLocaleString()}</span>
                    </div>
                    {activeTiers.map(t=>{
                      const val=(billing.byTier[t]??0)*TMRR[t]
                      const pct=billing.mrr>0?(val/billing.mrr)*100:0
                      return (
                        <div key={t} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--slate)', width:72, flexShrink:0, textTransform:'capitalize' }}>{t} ×{billing.byTier[t]}</span>
                          <div style={{ flex:1, height:4, background:'var(--fog)', borderRadius:2 }}>
                            <div style={{ height:'100%', width:(pct)+'%', background:TC[t], borderRadius:2 }} />
                          </div>
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--slate)', width:36, textAlign:'right' }}>${val}</span>
                        </div>
                      )
                    })}
                    {activeTiers.length===0&&<div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--fog)' }}>No active subscriptions</div>}
                  </div>
                  {/* Spec reviews */}
                  {(revFees>0||billing.reviews.allTime.count>0)&&(
                    <div style={{ borderTop:'1px solid var(--fog)', paddingTop:10 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <div style={{ width:8, height:8, borderRadius:2, background:'#C8952A' }} />
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>Spec reviews ({billing.reviews.thisMonth.count} this mo · {billing.reviews.allTime.count} total)</span>
                        </div>
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'#9A6A00', fontWeight:600 }}>{revFees>0?`$${revFees.toLocaleString()}`:'—'}</span>
                      </div>
                      {billing.reviews.allTime.revenueNZD>0&&(
                        <div style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--slate)' }}>All-time: ${billing.reviews.allTime.revenueNZD.toLocaleString()} NZD</div>
                      )}
                    </div>
                  )}
                  {/* Development payments */}
                  {(devRev>0||(billing.dev?.allTime.totalNZD??0)>0)&&(
                    <div style={{ borderTop:'1px solid var(--fog)', paddingTop:10 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <div style={{ width:8, height:8, borderRadius:2, background:'#1A9272' }} />
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>
                            Development ({(billing.dev?.thisMonth.deposits.count??0)+(billing.dev?.thisMonth.balances.count??0)} payments this mo)
                          </span>
                        </div>
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'#1A9272', fontWeight:600 }}>{devRev>0?`$${devRev.toLocaleString()}`:'—'}</span>
                      </div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--slate)', display:'flex', gap:12 }}>
                        {(billing.dev?.thisMonth.deposits.count??0)>0&&<span>Deposits: ${billing.dev?.thisMonth.deposits.revenueNZD.toLocaleString()}</span>}
                        {(billing.dev?.thisMonth.balances.count??0)>0&&<span>Balances: ${billing.dev?.thisMonth.balances.revenueNZD.toLocaleString()}</span>}
                        {(billing.dev?.allTime.totalNZD??0)>0&&<span style={{marginLeft:'auto'}}>All-time: ${billing.dev?.allTime.totalNZD.toLocaleString()} NZD</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Monthly activity */}
            <div style={{ background:'var(--white)', border:'1px solid var(--fog)', borderRadius:12, padding:'20px 24px' }}>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--slate)', marginBottom:18 }}>This month</div>
              <div style={{ display:'flex', flexDirection:'column' }}>
                {([
                  {label:'New subscriptions',   key:'subscriptions', count:billing.newMonth.count,                         value:billing.newMonth.valueNZD>0?`+$${billing.newMonth.valueNZD.toLocaleString()}`:null,                                   pos:true},
                  {label:'Upgrades',            key:'upgrades',      count:billing.upgrades.count,                         value:null,                                                                                                                   pos:true},
                  {label:'Spec reviews paid',   key:'reviews',       count:billing.reviews.thisMonth.count,                value:billing.reviews.thisMonth.revenueNZD>0?`+$${billing.reviews.thisMonth.revenueNZD.toLocaleString()}`:null,               pos:true},
                  {label:'Dev deposits',        key:'deposits',      count:billing.dev?.thisMonth.deposits.count??0,       value:(billing.dev?.thisMonth.deposits.revenueNZD??0)>0?`+$${billing.dev?.thisMonth.deposits.revenueNZD.toLocaleString()}`:null, pos:true},
                  {label:'Dev balances',        key:'balances',      count:billing.dev?.thisMonth.balances.count??0,       value:(billing.dev?.thisMonth.balances.revenueNZD??0)>0?`+$${billing.dev?.thisMonth.balances.revenueNZD.toLocaleString()}`:null, pos:true},
                  {label:'Downgrades',          key:'downgrades',    count:billing.downgrades.count,                       value:billing.downgrades.lostMRR>0?`−$${billing.downgrades.lostMRR.toLocaleString()} MRR`:null,                              pos:false},
                  {label:'Cancellations',       key:'cancellations', count:billing.cancelled.count,                        value:billing.cancelled.lostMRR>0?`−$${billing.cancelled.lostMRR.toLocaleString()} MRR`:null,                                pos:false},
                ] as {label:string;count:number;value:string|null;pos:boolean;key:string}[]).map((row,i,arr)=>{
                  const isOpen = financeDrill === row.key
                  const hasDetail = row.count > 0
                  return (
                    <div key={row.label}>
                      <div
                        onClick={() => hasDetail && setFinanceDrill(isOpen ? null : row.key)}
                        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', borderBottom:(!isOpen&&i<arr.length-1)?'1px solid var(--fog)':'none', cursor:hasDetail?'pointer':'default', borderRadius:4 }}
                      >
                        <span style={{ fontFamily:'var(--font-body)', fontSize:12, color:hasDetail?'var(--ink)':'var(--slate)' }}>{row.label}</span>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          {row.value&&<span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:row.pos?'var(--forest)':'#A32D2D' }}>{row.value}</span>}
                          <span style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:300, lineHeight:1, color:row.count===0?'var(--fog)':row.pos?'var(--forest)':'#A32D2D', minWidth:22, textAlign:'right' }}>{row.count}</span>
                          {hasDetail&&<span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)', marginLeft:2 }}>{isOpen?'▲':'▼'}</span>}
                        </div>
                      </div>
                      {isOpen&&(
                        <div style={{ background:'rgba(10,92,70,0.03)', border:'1px solid var(--fog)', borderRadius:8, margin:'4px 0 8px', overflow:'hidden' }}>
                          {/* Subscriptions detail */}
                          {row.key==='subscriptions'&&billing.newMonth.list.map((s,si)=>(
                            <div key={si} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px', borderBottom:si<billing.newMonth.list.length-1?'1px solid var(--fog)':'none' }}>
                              <div>
                                <div style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--ink)', fontWeight:500 }}>{s.customer}</div>
                                <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)', textTransform:'capitalize' }}>{s.plan} · started {relativeTime(s.startedAt)}</div>
                              </div>
                              <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--forest)', fontWeight:600 }}>${s.valueNZD.toLocaleString()}/mo</span>
                            </div>
                          ))}
                          {/* Spec reviews detail */}
                          {row.key==='reviews'&&billing.reviews.list.filter(r=>{ const d=new Date(r.paidAt); const m=new Date(); return d.getMonth()===m.getMonth()&&d.getFullYear()===m.getFullYear() }).map((r,ri,arr2)=>(
                            <div key={ri} onClick={()=>r.id&&onNavigate('requirements',r.id)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px', borderBottom:ri<arr2.length-1?'1px solid var(--fog)':'none', cursor:r.id?'pointer':'default' }}>
                              <div>
                                <div style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--ink)', fontWeight:500 }}>{r.title}</div>
                                <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>{r.tenant} · {r.customer} · {relativeTime(r.paidAt)}</div>
                              </div>
                              <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'#9A6A00', fontWeight:600 }}>${r.amountNZD}</span>
                            </div>
                          ))}
                          {/* Dev deposits detail */}
                          {row.key==='deposits'&&(billing.dev?.recentDeposits??[]).filter(r=>{ const d=new Date(r.paidAt); const m=new Date(); return d.getMonth()===m.getMonth()&&d.getFullYear()===m.getFullYear() }).map((r,ri,arr2)=>(
                            <div key={ri} onClick={()=>r.id&&onNavigate('requirements',r.id)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px', borderBottom:ri<arr2.length-1?'1px solid var(--fog)':'none', cursor:r.id?'pointer':'default' }}>
                              <div>
                                <div style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--ink)', fontWeight:500 }}>{r.title}</div>
                                <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>{r.tenant} · {relativeTime(r.paidAt)}</div>
                              </div>
                              <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'#1A9272', fontWeight:600 }}>${r.amountNZD.toLocaleString()}</span>
                            </div>
                          ))}
                          {/* Dev balances detail */}
                          {row.key==='balances'&&(billing.dev?.recentBalances??[]).filter(r=>{ const d=new Date(r.paidAt); const m=new Date(); return d.getMonth()===m.getMonth()&&d.getFullYear()===m.getFullYear() }).map((r,ri,arr2)=>(
                            <div key={ri} onClick={()=>r.id&&onNavigate('requirements',r.id)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px', borderBottom:ri<arr2.length-1?'1px solid var(--fog)':'none', cursor:r.id?'pointer':'default' }}>
                              <div>
                                <div style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--ink)', fontWeight:500 }}>{r.title}</div>
                                <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>{r.tenant} · {relativeTime(r.paidAt)}</div>
                              </div>
                              <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'#1A9272', fontWeight:600 }}>${r.amountNZD.toLocaleString()}</span>
                            </div>
                          ))}
                          {/* Upgrades detail */}
                          {row.key==='upgrades'&&billing.upgrades.list.map((u,ui,arr2)=>(
                            <div key={ui} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px', borderBottom:ui<arr2.length-1?'1px solid var(--fog)':'none' }}>
                              <div>
                                <div style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--ink)', fontWeight:500 }}>{u.customer}</div>
                                <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)', textTransform:'capitalize' }}>{u.from} → {u.to} · {relativeTime(u.changedAt)}</div>
                              </div>
                              {u.mrrDelta>0&&<span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--forest)', fontWeight:600 }}>+${u.mrrDelta}/mo</span>}
                            </div>
                          ))}
                          {/* Downgrades detail */}
                          {row.key==='downgrades'&&billing.downgrades.list.map((d,di,arr2)=>(
                            <div key={di} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px', borderBottom:di<arr2.length-1?'1px solid var(--fog)':'none' }}>
                              <div>
                                <div style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--ink)', fontWeight:500 }}>{d.customer}</div>
                                <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)', textTransform:'capitalize' }}>{d.from} → {d.to} · {relativeTime(d.changedAt)}</div>
                              </div>
                              {d.mrrDelta<0&&<span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'#A32D2D', fontWeight:600 }}>−${Math.abs(d.mrrDelta)}/mo</span>}
                            </div>
                          ))}
                          {/* Cancellations detail */}
                          {row.key==='cancellations'&&billing.cancelled.list.map((c,ci,arr2)=>(
                            <div key={ci} style={{ padding:'8px 14px', borderBottom:ci<arr2.length-1?'1px solid var(--fog)':'none' }}>
                              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                <div style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--ink)', fontWeight:500 }}>{c.customer}</div>
                                <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'#A32D2D', fontWeight:600 }}>−${c.lostMRR}/mo</span>
                              </div>
                              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)', textTransform:'capitalize' }}>{c.plan} · cancelled {relativeTime(c.cancelledAt)}</div>
                              {c.reason&&<div style={{ fontFamily:'var(--font-body)', fontSize:11, color:'var(--slate)', marginTop:4, fontStyle:'italic' }}>"{c.reason}"</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {billing.totalLostMRR>0&&(
                <div style={{ marginTop:12, padding:'8px 12px', background:'rgba(163,45,45,0.05)', border:'1px solid rgba(163,45,45,0.15)', borderRadius:8, fontFamily:'var(--font-mono)', fontSize:9, color:'#A32D2D' }}>
                  Net lost MRR this month: −${billing.totalLostMRR.toLocaleString()}
                </div>
              )}
            </div>
          </div>{/* end grid */}

          {/* ── Customers by value ─────────────────────────────────────── */}
          {billing.byTenant&&billing.byTenant.length>0&&(
            <div style={{ background:'var(--white)', border:'1px solid var(--fog)', borderRadius:12, padding:'20px 24px' }}>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--slate)', marginBottom:16 }}>Customers by value</div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {billing.byTenant.map((t,i)=>{
                  const max=billing.byTenant[0].total
                  const mrrPct  = max>0?(t.mrr/max)*100:0
                  const devPct  = max>0?(t.devRevenue/max)*100:0
                  const revPct  = max>0?(t.reviewRevenue/max)*100:0
                  return (
                    <div key={t.name}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                        <span style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--ink)', fontWeight:i===0?600:400 }}>{t.name}</span>
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--forest)', fontWeight:600 }}>${t.total.toLocaleString()}</span>
                      </div>
                      <div style={{ display:'flex', height:6, borderRadius:3, overflow:'hidden', background:'var(--fog)' }}>
                        {t.mrr>0&&<div style={{ width:mrrPct+'%', background:'#0A5C46' }} title={'MRR: $'+t.mrr+'/mo'} />}
                        {t.devRevenue>0&&<div style={{ width:devPct+'%', background:'#1A9272' }} title={'Dev: $'+t.devRevenue} />}
                        {t.reviewRevenue>0&&<div style={{ width:revPct+'%', background:'#C8952A' }} title={'Reviews: $'+t.reviewRevenue} />}
                      </div>
                      <div style={{ display:'flex', gap:12, marginTop:3 }}>
                        {t.mrr>0&&<span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'#0A5C46' }}>{'$'+t.mrr+'/mo MRR'}</span>}
                        {t.devRevenue>0&&<span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'#1A9272' }}>{'dev $'+t.devRevenue.toLocaleString()}</span>}
                        {t.reviewRevenue>0&&<span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'#9A6A00' }}>{'reviews $'+t.reviewRevenue.toLocaleString()}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ display:'flex', gap:16, marginTop:14, paddingTop:12, borderTop:'1px solid var(--fog)' }}>
                {[['#0A5C46','MRR'],['#1A9272','Development'],['#C8952A','Spec reviews']].map(([col,lbl])=>(
                  <div key={lbl} style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:8, height:8, borderRadius:2, background:col }} />
                    <span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--slate)' }}>{lbl}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>{/* end outer flex col */}
        )
      })()}

      {/* ── Needs attention ─────────────────────────────────────────────── */}
      <SectionLabel>Needs attention</SectionLabel>

      {totalAttention === 0 && (
        <div style={{ background:'var(--white)', border:'1px solid var(--fog)', borderRadius:10, padding:'20px 24px', color:'var(--slate)', fontSize:13, display:'flex', alignItems:'center', gap:10, fontFamily:'var(--font-body)' }}>
          ✅ Nothing needs attention right now — you&apos;re all caught up.
        </div>
      )}

      {attentionReqs.map(req => {
        const s = ATTENTION[req.status]
        return (
          <div key={req.id} onClick={() => onNavigate('requirements', req.id)} style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:10, padding:'14px 18px', marginBottom:8, display:'flex', alignItems:'center', gap:16, cursor:'pointer' }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:8, letterSpacing:'0.1em', textTransform:'uppercase', color:s.color, fontWeight:600 }}>{s.label}</span>
                {(req as any).parentId ? <span style={{ fontFamily:'var(--font-mono)', fontSize:7, letterSpacing:'0.08em', textTransform:'uppercase', color:'#9A6A00', background:'rgba(200,149,42,0.1)', border:'1px solid rgba(200,149,42,0.2)', borderRadius:4, padding:'1px 6px' }}>Addendum</span> : null}
                <span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--slate)' }}>· {req.tenant.name}</span>
              </div>
              <div style={{ fontFamily:'var(--font-body)', fontSize:13, fontWeight:600, color:'var(--ink)', marginBottom:2 }}>{req.title}</div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>{req.user.name||req.user.email} · updated {relativeTime(req.updatedAt)}</div>
            </div>
            <button onClick={() => onNavigate('requirements', req.id)} style={{ flexShrink:0, background:'none', border:`1px solid ${s.border}`, borderRadius:7, padding:'6px 14px', cursor:'pointer', fontFamily:'var(--font-mono)', fontSize:9, color:s.color, whiteSpace:'nowrap' }}>
              {s.action} →
            </button>
          </div>
        )
      })}

      {newEnquiries.map(enq => (
        <div key={enq.id} style={{ background:'rgba(26,146,114,0.05)', border:'1px solid rgba(26,146,114,0.2)', borderRadius:10, padding:'14px 18px', marginBottom:8, display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ fontSize:20, flexShrink:0 }}>🏗️</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
              <span style={{ fontFamily:'var(--font-mono)', fontSize:8, letterSpacing:'0.1em', textTransform:'uppercase', color:'#1A9272', fontWeight:600 }}>Migration Enquiry</span>
              <span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--slate)' }}>· {enq.tenant.name}</span>
            </div>
            <div style={{ fontFamily:'var(--font-body)', fontSize:13, fontWeight:600, color:'var(--ink)', marginBottom:2 }}>{enq.version} · {enq.users}</div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>{enq.contactName||enq.user.email} · {enq.phone} · {enq.urgency||'urgency not specified'} · {relativeTime(enq.createdAt)}</div>
            {enq.notes && <div style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--slate)', marginTop:4, fontStyle:'italic' }}>"{enq.notes}"</div>}
          </div>
          <button onClick={() => updateEnquiryStatus(enq.id,'contacted')} style={{ flexShrink:0, background:'#1A9272', color:'#fff', border:'none', borderRadius:7, padding:'6px 14px', cursor:'pointer', fontFamily:'var(--font-mono)', fontSize:9 }}>
            Mark contacted
          </button>
        </div>
      ))}

      {signups.map(sig => (
        <div key={sig.id} style={{ background:'rgba(200,149,42,0.05)', border:'1px solid rgba(200,149,42,0.2)', borderRadius:10, padding:'14px 18px', marginBottom:8, display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ fontSize:20, flexShrink:0 }}>📋</div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:8, letterSpacing:'0.1em', textTransform:'uppercase', color:'#C8952A', fontWeight:600, marginBottom:4 }}>Signup Awaiting Activation</div>
            <div style={{ fontFamily:'var(--font-body)', fontSize:13, fontWeight:600, color:'var(--ink)', marginBottom:2 }}>{sig.companyName}</div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>{sig.email} · verified {relativeTime(sig.verifiedAt!)}</div>
          </div>
          <button onClick={() => onNavigate('signups')} style={{ flexShrink:0, background:'none', border:'1px solid rgba(200,149,42,0.3)', borderRadius:7, padding:'6px 14px', cursor:'pointer', fontFamily:'var(--font-mono)', fontSize:9, color:'#C8952A' }}>
            Activate →
          </button>
        </div>
      ))}

      {/* ── All migration enquiries table ───────────────────────────────── */}
      {enquiries.length > 0 && (
        <>
          <SectionLabel>All migration enquiries</SectionLabel>
          <div style={{ background:'var(--white)', border:'1px solid var(--fog)', borderRadius:12, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--fog)' }}>
                  {['Tenant','Contact','Version','Users','Urgency','Status','Received'].map(h => (
                    <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--slate)', fontWeight:500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enquiries.map(enq => (
                  <tr key={enq.id} style={{ borderBottom:'1px solid var(--fog)' }}>
                    <td style={{ padding:'10px 14px', fontFamily:'var(--font-body)', color:'var(--ink)' }}>{enq.tenant.name}</td>
                    <td style={{ padding:'10px 14px' }}>
                      <div style={{ fontFamily:'var(--font-body)', fontSize:12 }}>{enq.contactName||enq.user.name||'—'}</div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>{enq.phone}</div>
                    </td>
                    <td style={{ padding:'10px 14px', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--slate)' }}>{enq.version}</td>
                    <td style={{ padding:'10px 14px', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--slate)' }}>{enq.users}</td>
                    <td style={{ padding:'10px 14px', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--slate)' }}>{enq.urgency||'—'}</td>
                    <td style={{ padding:'10px 14px' }}>
                      <select value={enq.status} onChange={e=>updateEnquiryStatus(enq.id,e.target.value)} style={{ fontFamily:'var(--font-mono)', fontSize:9, border:'1px solid var(--fog)', borderRadius:6, padding:'3px 6px', background:'var(--cream)', color:'var(--ink)', cursor:'pointer' }}>
                        {['new','contacted','quoted','closed'].map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:'10px 14px', fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>{relativeTime(enq.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
