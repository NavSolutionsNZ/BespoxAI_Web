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
    list: { tenant: string; customer: string; title: string; paidAt: string; amountNZD: number }[]
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

export default function SuperAdminDashboard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [enquiries,    setEnquiries]    = useState<MigrationEnquiry[]>([])
  const [tenants,      setTenants]      = useState<Tenant[]>([])
  const [signups,      setSignups]      = useState<SignupRequest[]>([])
  const [health,       setHealth]       = useState<Record<string, TenantHealth>>({})
  const [loading,      setLoading]      = useState(true)
  const [billing,      setBilling]      = useState<BillingStats | null>(null)
  const [showTenantDrill, setShowTenantDrill] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/requirements').then(r => r.json()),
      fetch('/api/admin/migration-enquiries').then(r => r.json()),
      fetch('/api/admin/tenants').then(r => r.json()),
      fetch('/api/admin/signups').then(r => r.json()),
      fetch('/api/admin/billing-stats').then(r => r.json()),
    ]).then(([reqs, enqs, ten, sigs, bil]) => {
      setRequirements(reqs.requirements ?? [])
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
        <div style={{ background:totalAttention>0?'rgba(163,45,45,0.06)':'var(--white)', border:`1px solid ${totalAttention>0?'rgba(163,45,45,0.2)':'var(--fog)'}`, borderRadius:12, padding:'18px 20px' }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--slate)', marginBottom:8 }}>Needs attention</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:42, fontWeight:300, color:totalAttention>0?'#A32D2D':'var(--ink)', lineHeight:1 }}>{totalAttention}</div>
          {totalAttention>0&&<div style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'#A32D2D', marginTop:6, letterSpacing:'0.1em', textTransform:'uppercase' }}>action required</div>}
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
          <div style={{ fontFamily:'var(--font-display)', fontSize:42, fontWeight:300, color:'var(--forest)', lineHeight:1 }}>${((billing?.newMonth.valueNZD??0)+(billing?.reviews.thisMonth.revenueNZD??0)).toLocaleString()}</div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)', marginTop:6 }}>subscriptions + spec reviews</div>
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
        const totalMoRev  = subRev + revFees
        const subPct      = totalMoRev>0 ? (subRev/totalMoRev)*100 : (billing.mrr>0?100:0)
        const revPct      = totalMoRev>0 ? (revFees/totalMoRev)*100 : 0
        const TMRR: Record<string,number> = {assistant:299,manager:499,executive:999}
        const TC:   Record<string,string> = {assistant:'#0A5C46',manager:'#1A9272',executive:'#C8952A'}
        const activeTiers = ['assistant','manager','executive'].filter(t=>(billing.byTier[t]??0)>0)
        const netMRRChange = (billing.newMonth.count * (billing.newMonth.valueNZD / Math.max(billing.newMonth.count,1)))
          - billing.totalLostMRR

        return (
          <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:14, marginBottom:24 }}>

            {/* Revenue composition */}
            <div style={{ background:'var(--white)', border:'1px solid var(--fog)', borderRadius:12, padding:'20px 24px' }}>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--slate)', marginBottom:18 }}>Revenue composition</div>
              <div style={{ display:'flex', gap:24, alignItems:'center' }}>
                {/* Donut */}
                <div style={{ width:104, height:104, borderRadius:'50%', flexShrink:0,
                  background:`conic-gradient(#0A5C46 0% ${subPct}%, #C8952A ${subPct}% ${subPct+revPct}%, var(--fog) ${subPct+revPct}% 100%)`,
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
                            <div style={{ height:'100%', width:`${pct}%`, background:TC[t], borderRadius:2 }} />
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
                </div>
              </div>
            </div>

            {/* Monthly activity */}
            <div style={{ background:'var(--white)', border:'1px solid var(--fog)', borderRadius:12, padding:'20px 24px' }}>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--slate)', marginBottom:18 }}>This month</div>
              <div style={{ display:'flex', flexDirection:'column' }}>
                {([
                  {label:'New subscriptions', count:billing.newMonth.count,      value:billing.newMonth.valueNZD>0?`+$${billing.newMonth.valueNZD.toLocaleString()}`:null, pos:true},
                  {label:'Upgrades',          count:billing.upgrades.count,      value:null, pos:true},
                  {label:'Spec reviews paid', count:billing.reviews.thisMonth.count, value:billing.reviews.thisMonth.revenueNZD>0?`+$${billing.reviews.thisMonth.revenueNZD.toLocaleString()}`:null, pos:true},
                  {label:'Downgrades',        count:billing.downgrades.count,    value:billing.downgrades.lostMRR>0?`−$${billing.downgrades.lostMRR.toLocaleString()} MRR`:null, pos:false},
                  {label:'Cancellations',     count:billing.cancelled.count,     value:billing.cancelled.lostMRR>0?`−$${billing.cancelled.lostMRR.toLocaleString()} MRR`:null, pos:false},
                ] as {label:string;count:number;value:string|null;pos:boolean}[]).map((row,i,arr)=>(
                  <div key={row.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', borderBottom:i<arr.length-1?'1px solid var(--fog)':'none' }}>
                    <span style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--slate)' }}>{row.label}</span>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      {row.value&&<span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:row.pos?'var(--forest)':'#A32D2D' }}>{row.value}</span>}
                      <span style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:300, lineHeight:1, color:row.count===0?'var(--fog)':row.pos?'var(--forest)':'#A32D2D', minWidth:22, textAlign:'right' }}>{row.count}</span>
                    </div>
                  </div>
                ))}
              </div>
              {billing.totalLostMRR>0&&(
                <div style={{ marginTop:12, padding:'8px 12px', background:'rgba(163,45,45,0.05)', border:'1px solid rgba(163,45,45,0.15)', borderRadius:8, fontFamily:'var(--font-mono)', fontSize:9, color:'#A32D2D' }}>
                  Net lost MRR this month: −${billing.totalLostMRR.toLocaleString()}
                </div>
              )}
            </div>
          </div>
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
          <div key={req.id} style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:10, padding:'14px 18px', marginBottom:8, display:'flex', alignItems:'center', gap:16 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:8, letterSpacing:'0.1em', textTransform:'uppercase', color:s.color, fontWeight:600 }}>{s.label}</span>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--slate)' }}>· {req.tenant.name}</span>
              </div>
              <div style={{ fontFamily:'var(--font-body)', fontSize:13, fontWeight:600, color:'var(--ink)', marginBottom:2 }}>{req.title}</div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--slate)' }}>{req.user.name||req.user.email} · updated {relativeTime(req.updatedAt)}</div>
            </div>
            <button onClick={() => onNavigate('requirements')} style={{ flexShrink:0, background:'none', border:`1px solid ${s.border}`, borderRadius:7, padding:'6px 14px', cursor:'pointer', fontFamily:'var(--font-mono)', fontSize:9, color:s.color, whiteSpace:'nowrap' }}>
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

      {/* ── Tenant connection status ─────────────────────────────────────── */}
      {/* ── Spec review payments ────────────────────────────────────────── */}
      {billing && billing.reviews.list.length > 0 && (<>
        <SectionLabel>Specification review payments</SectionLabel>
        <div style={{ background:'var(--white)', border:'1px solid rgba(10,92,70,0.18)', borderRadius:12, overflow:'hidden', marginBottom:8 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--fog)' }}>
                {['Tenant','Customer','Requirement','Paid','Amount'].map(h => (
                  <th key={h} style={{ padding:'8px 14px', textAlign:'left', fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--slate)', fontWeight:500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {billing.reviews.list.map((r,i) => (
                <tr key={i} style={{ borderBottom: i < billing.reviews.list.length-1 ? '1px solid var(--fog)' : 'none' }}>
                  <td style={{ padding:'10px 14px', color:'var(--ink)', fontWeight:500 }}>{r.tenant}</td>
                  <td style={{ padding:'10px 14px', color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>{r.customer}</td>
                  <td style={{ padding:'10px 14px', color:'var(--slate)', maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.title}</td>
                  <td style={{ padding:'10px 14px', color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>{relativeTime(r.paidAt)}</td>
                  <td style={{ padding:'10px 14px', color:'var(--forest)', fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600 }}>${r.amountNZD}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {/* ── New subscriptions this month ──────────────────────────────── */}
      {billing && billing.newMonth.list.length > 0 && (<>
        <SectionLabel>New subscriptions this month</SectionLabel>
        <div style={{ background:'var(--white)', border:'1px solid var(--fog)', borderRadius:12, overflow:'hidden', marginBottom:8 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--fog)' }}>
                {['Customer','Plan','Started','Value (NZD)'].map(h => (
                  <th key={h} style={{ padding:'8px 14px', textAlign:'left', fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--slate)', fontWeight:500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {billing.newMonth.list.map((s,i) => (
                <tr key={i} style={{ borderBottom: i < billing.newMonth.list.length-1 ? '1px solid var(--fog)' : 'none' }}>
                  <td style={{ padding:'10px 14px', color:'var(--ink)' }}>{s.customer}</td>
                  <td style={{ padding:'10px 14px', color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>{s.plan}</td>
                  <td style={{ padding:'10px 14px', color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>{relativeTime(s.startedAt)}</td>
                  <td style={{ padding:'10px 14px', color:'var(--forest)', fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600 }}>${s.valueNZD.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {/* ── Upgrades this month ─────────────────────────────────────────── */}
      {billing && billing.upgrades.list.length > 0 && (<>
        <SectionLabel>Upgrades this month</SectionLabel>
        <div style={{ background:'var(--white)', border:'1px solid rgba(10,92,70,0.2)', borderRadius:12, overflow:'hidden', marginBottom:8 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead><tr style={{ borderBottom:'1px solid var(--fog)' }}>
              {['Customer','From','To','MRR Delta','When'].map(h => (
                <th key={h} style={{ padding:'8px 14px', textAlign:'left', fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--slate)', fontWeight:500 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>{billing.upgrades.list.map((u,i) => (
              <tr key={i} style={{ borderBottom: i < billing.upgrades.list.length-1 ? '1px solid var(--fog)' : 'none' }}>
                <td style={{ padding:'10px 14px', color:'var(--ink)' }}>{u.customer}</td>
                <td style={{ padding:'10px 14px', color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>{u.from}</td>
                <td style={{ padding:'10px 14px', color:'var(--forest)', fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600 }}>{u.to}</td>
                <td style={{ padding:'10px 14px', color:'var(--forest)', fontFamily:'var(--font-mono)', fontSize:11 }}>+${u.mrrDelta}/mo</td>
                <td style={{ padding:'10px 14px', color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>{relativeTime(u.changedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>)}

      {/* ── Downgrades this month ────────────────────────────────────────── */}
      {billing && billing.downgrades.list.length > 0 && (<>
        <SectionLabel>Downgrades this month</SectionLabel>
        <div style={{ background:'var(--white)', border:'1px solid rgba(163,45,45,0.2)', borderRadius:12, overflow:'hidden', marginBottom:8 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead><tr style={{ borderBottom:'1px solid var(--fog)' }}>
              {['Customer','From','To','Lost MRR','When'].map(h => (
                <th key={h} style={{ padding:'8px 14px', textAlign:'left', fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--slate)', fontWeight:500 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>{billing.downgrades.list.map((d,i) => (
              <tr key={i} style={{ borderBottom: i < billing.downgrades.list.length-1 ? '1px solid var(--fog)' : 'none' }}>
                <td style={{ padding:'10px 14px', color:'var(--ink)' }}>{d.customer}</td>
                <td style={{ padding:'10px 14px', color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>{d.from}</td>
                <td style={{ padding:'10px 14px', color:'#A32D2D', fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600 }}>{d.to}</td>
                <td style={{ padding:'10px 14px', color:'#A32D2D', fontFamily:'var(--font-mono)', fontSize:11 }}>−${d.mrrDelta}/mo</td>
                <td style={{ padding:'10px 14px', color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>{relativeTime(d.changedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>)}

      {/* ── Cancellations this month ─────────────────────────────────────── */}
      {billing && billing.cancelled.list.length > 0 && (<>
        <SectionLabel>Cancellations this month</SectionLabel>
        <div style={{ background:'var(--white)', border:'1px solid rgba(163,45,45,0.2)', borderRadius:12, overflow:'hidden', marginBottom:8 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--fog)' }}>
                {['Customer','Plan','Cancelled','Lost MRR','Reason','Feedback'].map(h => (
                  <th key={h} style={{ padding:'8px 14px', textAlign:'left', fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--slate)', fontWeight:500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {billing.cancelled.list.map((s,i) => (
                <tr key={i} style={{ borderBottom: i < billing.cancelled.list.length-1 ? '1px solid var(--fog)' : 'none' }}>
                  <td style={{ padding:'10px 14px', color:'var(--ink)' }}>{s.customer}</td>
                  <td style={{ padding:'10px 14px', color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>{s.plan}</td>
                  <td style={{ padding:'10px 14px', color:'var(--slate)', fontFamily:'var(--font-mono)', fontSize:11 }}>{relativeTime(s.cancelledAt)}</td>
                  <td style={{ padding:'10px 14px', fontFamily:'var(--font-mono)', fontSize:11, color: s.reason ? '#A32D2D' : 'var(--fog)' }}>{s.reason?.replace(/_/g,' ') ?? '—'}</td>
                  <td style={{ padding:'10px 14px', fontFamily:'var(--font-mono)', fontSize:11, color:'#A32D2D', fontWeight:600 }}>${s.lostMRR.toLocaleString()}</td>
                  <td style={{ padding:'10px 14px', color:'var(--slate)', fontSize:12, maxWidth:220 }}>{[s.feedback?.replace(/_/g,' '), s.comment].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

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
