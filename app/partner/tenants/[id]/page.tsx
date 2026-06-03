'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'

// ── Types ────────────────────────────────────────────────────────────────────

type Tenant = {
  id: string; name: string; tunnelSubdomain: string; active: boolean
  navProduct: string | null; navVersion: string | null; lastCU: string | null
  tier: string; tunnelId: string | null; bcCompany: string | null
  bcInstance: string | null; agentPort: number; bcPort: number
  navDatabaseServer: string | null; navDatabaseName: string | null
  createdAt: string
  users: TenantUser[]
}

type TenantUser = {
  id: string; name: string | null; firstName: string | null
  email: string; role: string; createdAt: string
}

type Requirement = {
  id: string; tenantId: string; userId: string; title: string
  description: string; bcArea: string; priority: string
  aiSpec: string | null; status: string; quote: string | null
  quoteApprovedAt: string | null; consultantNote: string | null
  depositAmount: string | null; depositPaidAt: string | null
  balancePaidAt: string | null; adminQuestions: string | null
  customerAnswers: string | null; adminQALog: string | null
  quoteRejectedAt: string | null; quoteRejectionReason: string | null
  feasibility: string | null; feasibilityNotes: string | null
  feasibilityCostRange: string | null
  submittedAt: string | null; inReviewAt: string | null
  quotedAt: string | null; depositRequiredAt: string | null
  inDevelopmentAt: string | null; completePendingPaymentAt: string | null
  testDeployedAt: string | null; uatApprovedAt: string | null
  uatRejectedAt: string | null; uatRejectionReason: string | null
  prodDeployedAt: string | null; createdAt: string; updatedAt: string
  user: { name: string | null; email: string }
  tenant: { name: string; country: string | null; paymentTermsKey: string | null }
  parentId: string | null
  addenda: { id: string; title: string; status: string; quote: string | null; createdAt: string; parentId: string }[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const BC_AREAS = ['Sales','Purchase','Finance','Inventory','Manufacturing','Project','HR','Fixed Assets','Warehouse','Service','Other']
const PRIORITIES = [
  { value: 'nice_to_have', label: 'Nice to have', color: '#3B5249' },
  { value: 'important',    label: 'Important',    color: '#9A6A00' },
  { value: 'critical',     label: 'Critical',     color: '#A32D2D' },
]

const STATUS_PIPELINE = [
  {key:'draft',label:'Draft'},{key:'submitted',label:'Submitted'},
  {key:'in_review',label:'In Review'},{key:'quoted',label:'Quoted'},
  {key:'deposit_required',label:'Deposit Required'},{key:'deposit_paid',label:'Deposit Paid'},
  {key:'in_development',label:'In Development'},{key:'in_uat',label:'In UAT'},
  {key:'uat_confirmed',label:'UAT Confirmed'},{key:'complete_pending_payment',label:'Balance Due'},
  {key:'fully_paid',label:'Complete'},
]

const STATUS_COLOR: Record<string,{bg:string;border:string;text:string}> = {
  draft:                    {bg:'rgba(59,82,73,0.06)',   border:'rgba(59,82,73,0.15)',   text:'#3B5249'},
  submitted:                {bg:'rgba(200,149,42,0.08)', border:'rgba(200,149,42,0.25)', text:'#C8952A'},
  needs_clarification:      {bg:'rgba(200,60,60,0.1)',   border:'rgba(200,60,60,0.35)',  text:'#A32D2D'},
  in_review:                {bg:'rgba(200,149,42,0.12)', border:'rgba(200,149,42,0.35)', text:'#9A6A00'},
  quoted:                   {bg:'rgba(10,92,70,0.08)',   border:'rgba(10,92,70,0.2)',    text:'#0A5C46'},
  quote_rejected:           {bg:'rgba(163,45,45,0.14)', border:'rgba(163,45,45,0.45)',  text:'#8B1A1A'},
  deposit_required:         {bg:'rgba(200,149,42,0.12)',border:'rgba(200,149,42,0.4)',   text:'#7A5200'},
  deposit_paid:             {bg:'rgba(26,146,114,0.1)',  border:'rgba(26,146,114,0.3)', text:'#0F6E56'},
  in_development:           {bg:'rgba(14,110,86,0.1)',   border:'rgba(14,110,86,0.25)', text:'#0A5C46'},
  in_uat:                   {bg:'rgba(200,149,42,0.12)', border:'rgba(200,149,42,0.4)', text:'#7A5200'},
  uat_confirmed:            {bg:'rgba(26,146,114,0.12)', border:'rgba(26,146,114,0.35)',text:'#0A5240'},
  uat_rejected:             {bg:'rgba(163,45,45,0.14)',  border:'rgba(163,45,45,0.45)', text:'#8B1A1A'},
  complete_pending_payment: {bg:'rgba(200,149,42,0.1)',  border:'rgba(200,149,42,0.3)', text:'#7A5200'},
  fully_paid:               {bg:'rgba(26,146,114,0.12)', border:'rgba(26,146,114,0.35)',text:'#0A5240'},
  rejected:                 {bg:'rgba(163,45,45,0.14)', border:'rgba(163,45,45,0.45)',  text:'#8B1A1A'},
}

function statusLabel(s: string) {
  const map: Record<string,string> = {
    needs_clarification:'Needs Clarification', quote_rejected:'Quote Rejected',
    deposit_required:'Deposit Required', deposit_paid:'Deposit Paid',
    in_development:'In Development', in_uat:'In UAT',
    uat_confirmed:'UAT Confirmed ✓', uat_rejected:'UAT Rejected',
    complete_pending_payment:'Balance Due', fully_paid:'Complete ✓',
  }
  return map[s] ?? STATUS_PIPELINE.find(p => p.key === s)?.label ?? s.replace(/_/g,' ')
}

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-NZ', { day:'numeric', month:'short', year:'numeric' })
}

function parseSpec(aiSpec: string | null) {
  if (!aiSpec) return null
  try { return JSON.parse(aiSpec) } catch { return null }
}

function readQALog(raw: string | null): any[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

// ── Sub-components (defined outside main component — SWC rule) ───────────────

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none', borderBottom: active ? '2px solid #58A6FF' : '2px solid transparent',
        color: active ? '#F0F6FC' : '#8B949E', fontFamily: 'var(--font-body)', fontSize: 13,
        fontWeight: active ? 600 : 400, padding: '10px 16px', cursor: 'pointer',
        transition: 'color 0.15s, border-color 0.15s',
      }}
    >
      {label}
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  const sc = STATUS_COLOR[status] ?? STATUS_COLOR.draft
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12,
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
      textTransform: 'uppercase', background: sc.bg, color: sc.text, border: '1px solid ' + sc.border,
    }}>
      {statusLabel(status)}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #21262D' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8B949E', letterSpacing: '0.06em', minWidth: 160 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: value ? '#C9D1D9' : '#4A5568' }}>{value ?? '—'}</span>
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#161B22', border: '1px solid #21262D', borderRadius: 8,
      padding: '20px 24px', ...style,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>
      {children}
    </div>
  )
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ tenant }: { tenant: Tenant }) {
  const connected = !!tenant.tunnelId
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <Card style={{ gridColumn: '1 / -1' }}>
        <SectionLabel>Connection Status</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: connected ? '#3FB950' : '#8B949E',
            display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: connected ? '#3FB950' : '#8B949E' }}>
            {connected ? 'BCAgent Connected' : 'Not Connected — installer not yet run'}
          </span>
        </div>
      </Card>
      <Card>
        <SectionLabel>Client Details</SectionLabel>
        <InfoRow label="Company Name"  value={tenant.name} />
        <InfoRow label="Subdomain"     value={tenant.tunnelSubdomain} />
        <InfoRow label="Plan Tier"     value={tenant.tier.charAt(0).toUpperCase() + tenant.tier.slice(1)} />
        <InfoRow label="Active Since"  value={fmtDate(tenant.createdAt)} />
      </Card>
      <Card>
        <SectionLabel>BC / NAV Configuration</SectionLabel>
        <InfoRow label="Product"       value={tenant.navProduct ?? null} />
        <InfoRow label="Version"       value={tenant.navVersion ?? null} />
        <InfoRow label="Last CU"       value={tenant.lastCU ?? null} />
        <InfoRow label="BC Instance"   value={tenant.bcInstance ?? null} />
        <InfoRow label="BC Company"    value={tenant.bcCompany ?? null} />
        <InfoRow label="Agent Port"    value={tenant.agentPort ? String(tenant.agentPort) : null} />
      </Card>
      <Card style={{ gridColumn: '1 / -1' }}>
        <SectionLabel>Users ({''+tenant.users.length})</SectionLabel>
        {tenant.users.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E', margin: 0 }}>No users yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name','Email','Role','Joined'].map(h => (
                  <th key={h} style={{ padding: '6px 0', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.08em', textTransform: 'uppercase', paddingRight: 24 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenant.users.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid #21262D' }}>
                  <td style={{ padding: '8px 0', paddingRight: 24, fontFamily: 'var(--font-body)', fontSize: 13, color: '#C9D1D9' }}>{u.name ?? u.firstName ?? '—'}</td>
                  <td style={{ padding: '8px 0', paddingRight: 24, fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E' }}>{u.email}</td>
                  <td style={{ padding: '8px 0', paddingRight: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8B949E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{u.role.replace('tenant_','')}</td>
                  <td style={{ padding: '8px 0', fontFamily: 'var(--font-body)', fontSize: 12, color: '#8B949E' }}>{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

// ── New Requirement Form ──────────────────────────────────────────────────────

function NewRequirementForm({ tenantId, onCreated, onCancel }: {
  tenantId: string
  onCreated: (req: Requirement) => void
  onCancel: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const titleRef       = useRef<HTMLInputElement>(null)
  const descRef        = useRef<HTMLTextAreaElement>(null)
  const bcAreaRef      = useRef<HTMLSelectElement>(null)
  const priorityRef    = useRef<HTMLSelectElement>(null)

  async function handleSubmit() {
    const title       = titleRef.current?.value.trim() ?? ''
    const description = descRef.current?.value.trim() ?? ''
    const bcArea      = bcAreaRef.current?.value ?? ''
    const priority    = priorityRef.current?.value ?? ''
    if (!title || !description || !bcArea || !priority) {
      setError('All fields are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/requirements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, bcArea, priority }),
      })
      if (!res.ok) { setError('Failed to create requirement.'); return }
      const req = await res.json()
      onCreated(req)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6,
    color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13,
    padding: '8px 12px', outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E',
    letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6,
  }

  return (
    <Card>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 16, fontWeight: 600, color: '#F0F6FC', marginBottom: 20 }}>
        New Requirement
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>Title</label>
          <input ref={titleRef} style={inputStyle} placeholder="Brief title for this requirement" />
        </div>
        <div>
          <label style={labelStyle}>Description</label>
          <textarea ref={descRef} rows={5} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Describe the requirement in detail — what the customer needs and why" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>BC / NAV Area</label>
            <select ref={bcAreaRef} style={inputStyle}>
              <option value="">Select area</option>
              {BC_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select ref={priorityRef} style={inputStyle}>
              <option value="">Select priority</option>
              {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
        {error ? <p style={{ color: '#F85149', fontFamily: 'var(--font-body)', fontSize: 13, margin: 0 }}>{error}</p> : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{ background: 'none', border: '1px solid #30363D', borderRadius: 6, color: '#8B949E', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 16px', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{ background: '#238636', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, padding: '8px 20px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Creating…' : 'Create Requirement'}
          </button>
        </div>
      </div>
    </Card>
  )
}

// ── Requirement Detail ────────────────────────────────────────────────────────

function RequirementDetail({ req, tenantId, onBack, onUpdated }: {
  req: Requirement
  tenantId: string
  onBack: () => void
  onUpdated: (updated: Requirement) => void
}) {
  const [saving, setSaving] = useState(false)
  const [answersText, setAnswersText] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const spec = parseSpec(req.aiSpec)
  const qaLog = readQALog(req.adminQALog)
  const sc = STATUS_COLOR[req.status] ?? STATUS_COLOR.draft
  const pipelineIndex = STATUS_PIPELINE.findIndex(s => s.key === req.status)

  async function patch(body: object) {
    setSaving(true)
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/requirements/' + req.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        onUpdated(data.requirement)
      }
    } finally {
      setSaving(false)
    }
  }

  function handleSubmit() { patch({ status: 'submitted' }) }
  function handleApproveQuote() { patch({ status: 'deposit_required' }) }
  function handleRejectQuote() {
    if (!rejectReason.trim()) return
    patch({ status: 'quote_rejected', quoteRejectionReason: rejectReason })
    setShowRejectForm(false)
  }
  function handleAnswerSubmit() {
    if (!answersText.trim()) return
    patch({ status: 'submitted', customerAnswers: answersText })
    setAnswersText('')
  }

  const btnPrimary: React.CSSProperties = {
    background: '#238636', border: 'none', borderRadius: 6, color: '#fff',
    fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
    padding: '8px 20px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
  }
  const btnSecondary: React.CSSProperties = {
    background: 'none', border: '1px solid #30363D', borderRadius: 6, color: '#8B949E',
    fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 16px', cursor: 'pointer',
  }
  const btnDanger: React.CSSProperties = {
    background: 'none', border: '1px solid rgba(163,45,45,0.5)', borderRadius: 6, color: '#F85149',
    fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 16px', cursor: 'pointer',
  }

  return (
    <div>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
        <button onClick={onBack} style={{ ...btnSecondary, padding: '6px 12px', flexShrink: 0 }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: '#F0F6FC', fontWeight: 400, margin: 0 }}>{req.title}</h2>
            <StatusBadge status={req.status} />
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#8B949E', marginTop: 4 }}>
            {req.bcArea} · {PRIORITIES.find(p => p.value === req.priority)?.label ?? req.priority} · Raised {fmtDate(req.createdAt)}
          </div>
        </div>
      </div>

      {/* Pipeline graphic */}
      <Card style={{ marginBottom: 16, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 600 }}>
          {STATUS_PIPELINE.map((s, i) => {
            const done = pipelineIndex >= i && req.status !== 'quote_rejected' && req.status !== 'uat_rejected'
            const current = req.status === s.key
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: i < STATUS_PIPELINE.length - 1 ? 1 : 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: current ? sc.text : (done ? '#3FB950' : '#30363D'),
                    border: current ? '2px solid ' + sc.text : (done ? '2px solid #3FB950' : '2px solid #30363D'),
                  }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: done ? '#C9D1D9' : '#8B949E', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4, whiteSpace: 'nowrap' }}>{s.label}</span>
                </div>
                {i < STATUS_PIPELINE.length - 1 ? (
                  <div style={{ flex: 1, height: 2, background: done ? '#3FB950' : '#30363D', margin: '0 2px', marginBottom: 18 }} />
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Description */}
      <Card style={{ marginBottom: 16 }}>
        <SectionLabel>Description</SectionLabel>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#C9D1D9', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{req.description}</p>
      </Card>

      {/* AI Spec */}
      {spec ? (
        <Card style={{ marginBottom: 16 }}>
          <SectionLabel>AI Specification</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>User Story</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#C9D1D9', lineHeight: 1.6, margin: 0 }}>{spec.userStory}</p>
            </div>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>Complexity</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#C9D1D9', margin: 0 }}>{spec.complexity} · Est. {spec.estimatedDays} day{spec.estimatedDays !== 1 ? 's' : ''}</p>
            </div>
            {spec.acceptanceCriteria?.length > 0 ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>Acceptance Criteria</p>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {spec.acceptanceCriteria.map((c: string, i: number) => (
                    <li key={i} style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#C9D1D9', lineHeight: 1.6 }}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {spec.bcObjects?.length > 0 ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>BC Objects Affected</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {spec.bcObjects.map((o: string, i: number) => (
                    <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#58A6FF', background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.2)', borderRadius: 4, padding: '2px 8px' }}>{o}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Consultant note */}
      {req.consultantNote ? (
        <Card style={{ marginBottom: 16, borderColor: 'rgba(10,92,70,0.4)', background: 'rgba(10,92,70,0.06)' }}>
          <SectionLabel>Note from BespoxAI</SectionLabel>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#C9D1D9', lineHeight: 1.6, margin: 0 }}>{req.consultantNote}</p>
        </Card>
      ) : null}

      {/* Quote */}
      {req.status === 'quoted' || req.status === 'deposit_required' || req.status === 'quote_rejected' || req.status === 'deposit_paid' || req.status === 'in_development' || req.status === 'complete_pending_payment' || req.status === 'fully_paid' ? (
        req.quote ? (
          <Card style={{ marginBottom: 16 }}>
            <SectionLabel>Quote</SectionLabel>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: '#F0F6FC', marginBottom: 4 }}>
              {'$' + parseFloat(req.quote).toLocaleString('en-NZ', { minimumFractionDigits: 2 }) + ' NZD'}
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#8B949E', margin: 0 }}>plus GST · 20% deposit on acceptance</p>
            {req.status === 'quoted' ? (
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={handleApproveQuote} disabled={saving} style={btnPrimary}>Accept Quote</button>
                <button onClick={() => setShowRejectForm(true)} style={btnDanger}>Reject Quote</button>
              </div>
            ) : null}
            {showRejectForm ? (
              <div style={{ marginTop: 16 }}>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Reason for rejecting this quote…"
                  style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 12px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button onClick={handleRejectQuote} disabled={saving} style={{ ...btnDanger, background: 'rgba(163,45,45,0.15)' }}>Confirm Rejection</button>
                  <button onClick={() => setShowRejectForm(false)} style={btnSecondary}>Cancel</button>
                </div>
              </div>
            ) : null}
          </Card>
        ) : null
      ) : null}

      {/* Q&A Log */}
      {qaLog.length > 0 ? (
        <Card style={{ marginBottom: 16 }}>
          <SectionLabel>Clarification Q&A</SectionLabel>
          {qaLog.map((round: any, i: number) => (
            <div key={i} style={{ marginBottom: i < qaLog.length - 1 ? 20 : 0 }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8, marginTop: 0 }}>Round {round.round}</p>
              <div style={{ background: 'rgba(200,149,42,0.06)', border: '1px solid rgba(200,149,42,0.2)', borderRadius: 6, padding: '12px 16px', marginBottom: 10 }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#C8952A', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>Questions from BespoxAI</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#C9D1D9', whiteSpace: 'pre-wrap', margin: 0 }}>{round.questions}</p>
              </div>
              {round.answers ? (
                <div style={{ background: 'rgba(26,146,114,0.06)', border: '1px solid rgba(26,146,114,0.2)', borderRadius: 6, padding: '12px 16px' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#3FB950', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>Your Answers</p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#C9D1D9', whiteSpace: 'pre-wrap', margin: 0 }}>{round.answers}</p>
                </div>
              ) : null}
            </div>
          ))}
        </Card>
      ) : null}

      {/* Answer panel — shown when needs_clarification */}
      {req.status === 'needs_clarification' ? (
        <Card style={{ marginBottom: 16, borderColor: 'rgba(200,60,60,0.3)', background: 'rgba(200,60,60,0.04)' }}>
          <SectionLabel>Action Required — Answer Clarification Questions</SectionLabel>
          <textarea
            value={answersText}
            onChange={e => setAnswersText(e.target.value)}
            rows={5}
            placeholder="Type your answers to the questions above…"
            style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 12px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
          />
          <div style={{ marginTop: 12 }}>
            <button onClick={handleAnswerSubmit} disabled={saving || !answersText.trim()} style={{ ...btnPrimary, opacity: (saving || !answersText.trim()) ? 0.5 : 1 }}>
              Submit Answers
            </button>
          </div>
        </Card>
      ) : null}

      {/* Submit draft */}
      {(req.status === 'draft' || req.status === 'quote_rejected') ? (
        <Card style={{ marginBottom: 16 }}>
          <SectionLabel>{req.status === 'draft' ? 'Ready to Submit?' : 'Resubmit Requirement'}</SectionLabel>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E', margin: '0 0 12px' }}>
            {req.status === 'draft' ? 'Submit this requirement for BespoxAI to review and provide a quote.' : 'You can revise and resubmit this requirement.'}
          </p>
          <button onClick={handleSubmit} disabled={saving} style={btnPrimary}>
            {req.status === 'draft' ? 'Submit for Review' : 'Resubmit Requirement'}
          </button>
        </Card>
      ) : null}
    </div>
  )
}

// ── Requirements Tab ─────────────────────────────────────────────────────────

function RequirementsTab({ tenantId }: { tenantId: string }) {
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<Requirement | null>(null)

  useEffect(() => {
    fetch('/api/partner/tenants/' + tenantId + '/requirements')
      .then(r => r.json())
      .then(d => { if (d.requirements) setRequirements(d.requirements) })
      .finally(() => setLoading(false))
  }, [tenantId])

  function handleCreated(req: Requirement) {
    setRequirements(prev => [req, ...prev])
    setShowNew(false)
    setSelected(req)
  }

  function handleUpdated(updated: Requirement) {
    setRequirements(prev => prev.map(r => r.id === updated.id ? updated : r))
    setSelected(updated)
  }

  if (selected) {
    return (
      <RequirementDetail
        req={selected}
        tenantId={tenantId}
        onBack={() => setSelected(null)}
        onUpdated={handleUpdated}
      />
    )
  }

  if (showNew) {
    return (
      <NewRequirementForm
        tenantId={tenantId}
        onCreated={handleCreated}
        onCancel={() => setShowNew(false)}
      />
    )
  }

  const topLevel = requirements.filter(r => !r.parentId)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          onClick={() => setShowNew(true)}
          style={{ background: '#238636', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, padding: '8px 16px', cursor: 'pointer' }}
        >
          + New Requirement
        </button>
      </div>

      {loading ? (
        <Card><p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#8B949E', margin: 0, textAlign: 'center' }}>Loading…</p></Card>
      ) : topLevel.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#8B949E', margin: '0 0 12px' }}>No requirements yet for this client.</p>
            <button onClick={() => setShowNew(true)} style={{ background: 'none', border: '1px solid #30363D', borderRadius: 6, color: '#58A6FF', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 16px', cursor: 'pointer' }}>
              Raise first requirement
            </button>
          </div>
        </Card>
      ) : (
        <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #21262D' }}>
                {['Title','Area','Priority','Status','Raised'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topLevel.map((req, i) => {
                const pm = PRIORITIES.find(p => p.value === req.priority)
                return (
                  <tr
                    key={req.id}
                    onClick={() => setSelected(req)}
                    style={{ borderBottom: i < topLevel.length - 1 ? '1px solid #21262D' : 'none', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1C2128' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <td style={{ padding: '12px 20px', fontFamily: 'var(--font-body)', fontSize: 14, color: '#C9D1D9', fontWeight: 500 }}>
                      {req.title}
                      {req.addenda.length > 0 ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#C8952A', background: 'rgba(200,149,42,0.12)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 10, padding: '1px 6px', marginLeft: 8 }}>
                          {'+' + req.addenda.length + ' addend' + (req.addenda.length === 1 ? 'um' : 'a')}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: '12px 20px', fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E' }}>{req.bcArea}</td>
                    <td style={{ padding: '12px 20px' }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: pm?.color ?? '#8B949E' }}>{pm?.label ?? req.priority}</span>
                    </td>
                    <td style={{ padding: '12px 20px' }}><StatusBadge status={req.status} /></td>
                    <td style={{ padding: '12px 20px', fontFamily: 'var(--font-body)', fontSize: 12, color: '#8B949E' }}>{fmtDate(req.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PartnerTenantPage() {
  const params = useParams()
  const router = useRouter()
  const tenantId = params.id as string

  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'requirements' | 'users' | 'settings'>('overview')

  useEffect(() => {
    fetch('/api/partner/tenants/' + tenantId)
      .then(r => {
        if (r.status === 404) { router.push('/partner/dashboard'); return null }
        return r.json()
      })
      .then(d => { if (d) setTenant(d) })
      .finally(() => setLoading(false))
  }, [tenantId, router])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#8B949E', letterSpacing: '0.1em' }}>LOADING</span>
      </div>
    )
  }

  if (!tenant) return null

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.push('/partner/dashboard')}
          style={{ background: 'none', border: 'none', color: '#8B949E', fontFamily: 'var(--font-body)', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          ← All Clients
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: '#F0F6FC', fontWeight: 400, margin: 0 }}>{tenant.name}</h1>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '3px 10px', borderRadius: 12,
            background: tenant.active ? 'rgba(35,134,54,0.2)' : 'rgba(139,148,158,0.15)',
            color: tenant.active ? '#3FB950' : '#8B949E',
            border: '1px solid ' + (tenant.active ? 'rgba(63,185,80,0.3)' : 'rgba(139,148,158,0.3)'),
          }}>
            {tenant.active ? 'Active' : 'Inactive'}
          </span>
          {tenant.navProduct ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#58A6FF', background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.2)', borderRadius: 4, padding: '2px 8px', letterSpacing: '0.06em' }}>
              {tenant.navProduct}
            </span>
          ) : null}
        </div>
        {tenant.navVersion ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E', margin: '4px 0 0' }}>{tenant.navVersion}</p>
        ) : null}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #21262D', marginBottom: 24, display: 'flex' }}>
        <TabBtn label="Overview"     active={tab === 'overview'}     onClick={() => setTab('overview')} />
        <TabBtn label="Requirements" active={tab === 'requirements'} onClick={() => setTab('requirements')} />
        <TabBtn label="Users"        active={tab === 'users'}        onClick={() => setTab('users')} />
        <TabBtn label="Settings"     active={tab === 'settings'}     onClick={() => setTab('settings')} />
      </div>

      {/* Tab content */}
      {tab === 'overview' ? <OverviewTab tenant={tenant} /> : null}
      {tab === 'requirements' ? <RequirementsTab tenantId={tenantId} /> : null}
      {tab === 'users' ? (
        <Card>
          <SectionLabel>Tenant Users</SectionLabel>
          {tenant.users.length === 0 ? (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E', margin: 0 }}>No users on this tenant yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name','Email','Role','Joined'].map(h => (
                    <th key={h} style={{ padding: '6px 0', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.08em', textTransform: 'uppercase', paddingRight: 24 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenant.users.map(u => (
                  <tr key={u.id} style={{ borderTop: '1px solid #21262D' }}>
                    <td style={{ padding: '10px 0', paddingRight: 24, fontFamily: 'var(--font-body)', fontSize: 13, color: '#C9D1D9' }}>{u.name ?? u.firstName ?? '—'}</td>
                    <td style={{ padding: '10px 0', paddingRight: 24, fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E' }}>{u.email}</td>
                    <td style={{ padding: '10px 0', paddingRight: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8B949E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{u.role.replace('tenant_','')}</td>
                    <td style={{ padding: '10px 0', fontFamily: 'var(--font-body)', fontSize: 12, color: '#8B949E' }}>{fmtDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}
      {tab === 'settings' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <SectionLabel>Production Environment</SectionLabel>
            <InfoRow label="NAV Server Instance"  value={tenant.navDatabaseServer} />
            <InfoRow label="NAV Database"         value={tenant.navDatabaseName} />
            <InfoRow label="BC Instance"          value={tenant.bcInstance} />
            <InfoRow label="BC Company"           value={tenant.bcCompany} />
            <InfoRow label="OData Port"           value={tenant.bcPort ? String(tenant.bcPort) : null} />
            <InfoRow label="Agent Port"           value={tenant.agentPort ? String(tenant.agentPort) : null} />
          </Card>
          <div style={{ background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.15)', borderRadius: 8, padding: '12px 16px' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E', margin: 0 }}>
              Connection settings are managed by BespoxAI. Contact support if changes are needed.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
