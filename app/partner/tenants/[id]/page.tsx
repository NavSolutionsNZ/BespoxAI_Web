'use client'

import React, { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useParams, useSearchParams, usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useBranding } from '@/app/branding-provider'
import { DevPlanPanel } from '@/components/DevPlanPanel'

// ── Types ────────────────────────────────────────────────────────────────────

type Tenant = {
  id: string; name: string; tunnelSubdomain: string; active: boolean
  navProduct: string | null; navVersion: string | null; lastCU: string | null
  tier: string; tunnelId: string | null; bcCompany: string | null
  bcInstance: string | null; agentPort: number; bcPort: number
  bcUsername: string | null
  navDatabaseServer: string | null; navDatabaseName: string | null
  navServerInstance: string | null; navManagementPort: number | null
  testNavDatabaseServer: string | null; testNavDatabaseName: string | null
  testNavServerInstance: string | null; testNavManagementPort: number | null
  testBcInstance: string | null; testBcCompany: string | null; testBcPort: number | null
  rdpPassword: string | null
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
  feasibilityCostRange: string | null; feasibilityCheckedAt: string | null
  devPlan: string | null; githubBranch: string | null
  submittedAt: string | null; inReviewAt: string | null
  quotedAt: string | null; depositRequiredAt: string | null
  inDevelopmentAt: string | null; completePendingPaymentAt: string | null
  testDeployedAt: string | null; uatApprovedAt: string | null
  uatRejectedAt: string | null; uatRejectionReason: string | null
  prodDeployedAt: string | null; createdAt: string; updatedAt: string
  user: { name: string | null; email: string }
  tenant: { name: string; country: string | null; paymentTermsKey: string | null }
  assignedDeveloper: { id: string; name: string | null; email: string; firstName: string | null; preferredName: string | null } | null
  parentId: string | null
  addenda: { id: string; title: string; status: string; quote: string | null; createdAt: string; parentId: string }[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const BC_AREAS = ['Sales','Purchase','Finance','Inventory','Manufacturing','Project','HR','Fixed Assets','Warehouse','Service','Other']
const PRIORITIES = [
  { value: 'nice_to_have', label: 'Nice to have', color: 'var(--rb-text-muted)' },
  { value: 'important',    label: 'Important',    color: 'var(--rb-warning)' },
  { value: 'critical',     label: 'Critical',     color: 'var(--rb-danger)' },
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
  draft:                    {bg:'rgba(59,82,73,0.06)',   border:'rgba(59,82,73,0.15)',   text:'var(--rb-text-muted)'},
  submitted:                {bg:'rgba(200,149,42,0.08)', border:'rgba(200,149,42,0.25)', text:'var(--rb-warning)'},
  needs_clarification:      {bg:'rgba(200,60,60,0.1)',   border:'rgba(200,60,60,0.35)',  text:'var(--rb-danger)'},
  in_review:                {bg:'rgba(200,149,42,0.12)', border:'rgba(200,149,42,0.35)', text:'var(--rb-warning)'},
  quoted:                   {bg:'rgba(10,92,70,0.08)',   border:'rgba(10,92,70,0.2)',    text:'var(--rb-success)'},
  quote_rejected:           {bg:'rgba(163,45,45,0.14)', border:'rgba(163,45,45,0.45)',  text:'var(--rb-danger)'},
  deposit_required:         {bg:'rgba(200,149,42,0.12)',border:'rgba(200,149,42,0.4)',   text:'var(--rb-warning)'},
  deposit_paid:             {bg:'rgba(26,146,114,0.1)',  border:'rgba(26,146,114,0.3)', text:'var(--rb-primary-hover)'},
  in_development:           {bg:'rgba(14,110,86,0.1)',   border:'rgba(14,110,86,0.25)', text:'var(--rb-success)'},
  in_uat:                   {bg:'rgba(200,149,42,0.12)', border:'rgba(200,149,42,0.4)', text:'var(--rb-warning)'},
  uat_confirmed:            {bg:'rgba(26,146,114,0.12)', border:'rgba(26,146,114,0.35)',text:'var(--rb-success)'},
  uat_rejected:             {bg:'rgba(163,45,45,0.14)',  border:'rgba(163,45,45,0.45)', text:'var(--rb-danger)'},
  complete_pending_payment: {bg:'rgba(200,149,42,0.1)',  border:'rgba(200,149,42,0.3)', text:'var(--rb-warning)'},
  fully_paid:               {bg:'rgba(26,146,114,0.12)', border:'rgba(26,146,114,0.35)',text:'var(--rb-success)'},
  rejected:                 {bg:'rgba(163,45,45,0.14)', border:'rgba(163,45,45,0.45)',  text:'var(--rb-danger)'},
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
        background: 'none', border: 'none', borderBottom: active ? '2px solid var(--rb-accent)' : '2px solid transparent',
        color: active ? 'var(--rb-text-bright)' : 'var(--rb-text-muted)', fontFamily: 'var(--font-body)', fontSize: 13,
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
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--rb-border)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--rb-text-muted)', letterSpacing: '0.06em', minWidth: 160 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: value ? 'var(--rb-text)' : 'var(--rb-text-muted)' }}>{value ?? '—'}</span>
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--rb-surface)', border: '1px solid var(--rb-border)', borderRadius: 8,
      padding: '20px 24px', ...style,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>
      {children}
    </div>
  )
}

// ── BCAgent Tab ──────────────────────────────────────────────────────────────

function BCAgentTab({ tenant, onTunnelProvisioned }: { tenant: Tenant; onTunnelProvisioned: () => void }) {
  const tenantId = tenant.id
  const hasTunnel = !!tenant.tunnelId
  const erpLabel  = tenant.navProduct === 'NAV' ? 'NAV' : 'BC'

  // Form state — refs pattern (no controlled inputs)
  const refs = {
    navDatabaseServer:     React.useRef<HTMLInputElement>(null),
    navDatabaseName:       React.useRef<HTMLInputElement>(null),
    navServerInstance:     React.useRef<HTMLInputElement>(null),
    navManagementPort:     React.useRef<HTMLInputElement>(null),
    bcInstance:            React.useRef<HTMLInputElement>(null),
    bcCompany:             React.useRef<HTMLInputElement>(null),
    bcPort:                React.useRef<HTMLInputElement>(null),
    agentPort:             React.useRef<HTMLInputElement>(null),
    bcUsername:            React.useRef<HTMLInputElement>(null),
    bcPassword:            React.useRef<HTMLInputElement>(null),
    testNavDatabaseName:   React.useRef<HTMLInputElement>(null),
    testNavServerInstance: React.useRef<HTMLInputElement>(null),
    testBcInstance:        React.useRef<HTMLInputElement>(null),
    testBcCompany:         React.useRef<HTMLInputElement>(null),
    testNavManagementPort: React.useRef<HTMLInputElement>(null),
  }

  const [testSeparate, setTestSeparate]   = useState(false)
  const [instLoading,  setInstLoading]    = useState(false)
  const [syncLoading,  setSyncLoading]    = useState(false)
  const [rdpLoading,   setRdpLoading]     = useState(false)
  const [agentVersion, setAgentVersion]   = useState<string | null>(null)
  const [feedback,     setFeedback]       = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  React.useEffect(() => {
    fetch('/api/partner/tenants/' + tenantId + '/installer')
      .then(r => r.json()).then(d => { if (d.version) setAgentVersion(d.version) }).catch(() => {})
  }, [tenantId])

  function showFeedback(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 4000)
  }

  async function downloadInstaller() {
    const bcUsername = refs.bcUsername.current?.value || ''
    const bcPassword = refs.bcPassword.current?.value || ''
    if (!bcUsername) { showFeedback('err', 'BC service account username is required'); return }
    setInstLoading(true)
    try {
      const r = await fetch('/api/partner/tenants/' + tenantId + '/installer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bcUsername, bcPassword,
          bcPort:            parseInt(refs.bcPort.current?.value            || '8048', 10),
          agentPort:         parseInt(refs.agentPort.current?.value         || '9099', 10),
          bcInstance:        refs.bcInstance.current?.value                 || '',
          bcCompany:         refs.bcCompany.current?.value                  || '',
          navDatabaseServer: refs.navDatabaseServer.current?.value          || 'localhost',
          navDatabaseName:   refs.navDatabaseName.current?.value            || '',
          navServerInstance: refs.navServerInstance.current?.value          || '',
          navManagementPort: parseInt(refs.navManagementPort.current?.value || '7045', 10),
          testNavDatabaseServer: '',
          testNavDatabaseName:   refs.testNavDatabaseName.current?.value   || '',
          testNavServerInstance: refs.testNavServerInstance.current?.value || '',
          testBcInstance:        refs.testBcInstance.current?.value        || '',
          testBcCompany:         refs.testBcCompany.current?.value         || '',
          testNavManagementPort: parseInt(refs.testNavManagementPort.current?.value || '7045', 10),
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        showFeedback('err', j.error || 'Failed to generate installer')
        return
      }
      const blob = await r.blob()
      const url  = URL.createObjectURL(blob)
      const cd   = r.headers.get('content-disposition') || ''
      const match = cd.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : ('Install-BespoxAI-v' + (agentVersion || '3.2') + '.zip')
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      if (!hasTunnel) onTunnelProvisioned()
      showFeedback('ok', 'Installer downloaded — tunnel provisioned if this was the first download')
    } catch (e: any) {
      showFeedback('err', e.message || 'Download failed')
    } finally {
      setInstLoading(false)
    }
  }

  async function syncConfig() {
    setSyncLoading(true)
    try {
      const r = await fetch('/api/partner/tenants/' + tenantId + '/sync-config', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.ok) showFeedback('ok', 'Config synced to agent successfully')
      else showFeedback('err', j.error || 'Sync failed')
    } catch (e: any) {
      showFeedback('err', e.message || 'Sync failed')
    } finally {
      setSyncLoading(false)
    }
  }

  async function provisionRdp() {
    setRdpLoading(true)
    try {
      const r = await fetch('/api/partner/tenants/' + tenantId + '/provision-rdp', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.ok) showFeedback('ok', 'RDP provisioned: ' + j.rdpHostname)
      else showFeedback('err', j.error || 'RDP provisioning failed')
    } catch (e: any) {
      showFeedback('err', e.message || 'RDP provisioning failed')
    } finally {
      setRdpLoading(false)
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', background: 'var(--rb-inset)', border: '1px solid var(--rb-border-strong)', borderRadius: 6,
    color: 'var(--rb-text)', fontFamily: 'var(--font-body)', fontSize: 13,
    padding: '8px 12px', outline: 'none', boxSizing: 'border-box',
  }
  const lbl = (t: string) => (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>{t}</div>
  )
  const hint = (t: string) => (
    <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--rb-text-muted)', marginTop: 4 }}>{t}</p>
  )
  const sectionHead = (t: string) => (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-accent)', letterSpacing: '0.14em', textTransform: 'uppercase', borderBottom: '1px solid var(--rb-border)', paddingBottom: 10, marginBottom: 20 }}>{t}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Production environment */}
      <Card style={{ background: 'rgba(200,149,42,0.04)', border: '1px solid rgba(200,149,42,0.2)' }}>
        {sectionHead('Production Environment')}
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text-muted)', marginBottom: 18, lineHeight: 1.6 }}>
          {erpLabel + ' connection details. Instance, company and database fields are saved — credentials are embedded in the installer only and never stored.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              {lbl('BC Service Account Username *')}
              <input ref={refs.bcUsername} style={inp} type="text" defaultValue={tenant.bcUsername || ''}
                placeholder="e.g. DOMAIN\BCServiceUser" autoComplete="off" />
              {hint('Windows account used to authenticate with BC OData.')}
            </div>
            <div>
              {lbl('BC Service Account Password *')}
              <input ref={refs.bcPassword} style={inp} type="password" defaultValue=""
                placeholder="Not stored — embedded in installer only" autoComplete="new-password" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              {lbl('SQL Database Server')}
              <input ref={refs.navDatabaseServer} style={inp} type="text" defaultValue={tenant.navDatabaseServer || 'localhost'}
                placeholder="localhost" autoComplete="off" />
              {hint('SQL Server hostname or IP. Used for finsql object export.')}
            </div>
            <div>
              {lbl('SQL Database Name')}
              <input ref={refs.navDatabaseName} style={inp} type="text" defaultValue={tenant.navDatabaseName || ''}
                placeholder="e.g. Dynamics NAV 2017" autoComplete="off" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              {lbl('NAV Server Instance')}
              <input ref={refs.navServerInstance} style={inp} type="text" defaultValue={tenant.navServerInstance || ''}
                placeholder="e.g. DynamicsNAV110" autoComplete="off" />
              {hint('Windows service instance name.')}
            </div>
            <div>
              {lbl(erpLabel + ' Instance')}
              <input ref={refs.bcInstance} style={inp} type="text" defaultValue={tenant.bcInstance || ''}
                placeholder="e.g. BC or NAV" autoComplete="off" />
            </div>
            <div>
              {lbl(erpLabel + ' Company')}
              <input ref={refs.bcCompany} style={inp} type="text" defaultValue={tenant.bcCompany || ''}
                placeholder="e.g. CRONUS International Ltd." autoComplete="off" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              {lbl('OData Port')}
              <input ref={refs.bcPort} style={inp} type="number" defaultValue={tenant.bcPort || 8048}
                placeholder="8048" autoComplete="off" />
            </div>
            <div>
              {lbl('Agent Port')}
              <input ref={refs.agentPort} style={inp} type="number" defaultValue={tenant.agentPort || 9099}
                placeholder="9099" autoComplete="off" />
              {hint('Port BCAgent listens on. Default 9099.')}
            </div>
            <div>
              {lbl('NAV Management Port')}
              <input ref={refs.navManagementPort} style={inp} type="number" defaultValue={tenant.navManagementPort || 7045}
                placeholder="7045" autoComplete="off" />
              {hint('Used for schema sync. Default 7045.')}
            </div>
          </div>
        </div>
      </Card>

      {/* Test environment */}
      <Card style={{ background: 'rgba(14,110,86,0.04)', border: '1px solid rgba(14,110,86,0.2)' }}>
        {sectionHead('Test Environment')}
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text-muted)', marginBottom: 16, lineHeight: 1.55 }}>
          Used for pre-production deployment and UAT. Shares credentials with production — only configure what differs.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            {lbl('Test Database Name')}
            <input ref={refs.testNavDatabaseName} style={inp} type="text" defaultValue={tenant.testNavDatabaseName || ''}
              placeholder="e.g. Dynamics NAV 2017 Test" autoComplete="off" />
            {hint('SQL database used for test deployments.')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              {lbl('Test Server Instance')}
              <input ref={refs.testNavServerInstance} style={inp} type="text" defaultValue={tenant.testNavServerInstance || ''}
                placeholder="e.g. DynamicsNAV110_Test" autoComplete="off" />
            </div>
            <div>
              {lbl('Test ' + erpLabel + ' Instance')}
              <input ref={refs.testBcInstance} style={inp} type="text" defaultValue={tenant.testBcInstance || ''}
                placeholder="e.g. DynamicsNAV110_Test" autoComplete="off" />
            </div>
            <div>
              {lbl('Test ' + erpLabel + ' Company')}
              <input ref={refs.testBcCompany} style={inp} type="text" defaultValue={tenant.testBcCompany || ''}
                placeholder="e.g. Cronus Test" autoComplete="off" />
            </div>
            <div>
              {lbl('Test NAV Management Port')}
              <input ref={refs.testNavManagementPort} style={inp} type="number" defaultValue={tenant.testNavManagementPort || 7045}
                placeholder="7045" autoComplete="off" />
            </div>
          </div>
        </div>
      </Card>

      {/* Separate test server */}
      <Card>
        {sectionHead('Separate Test Server')}
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text-muted)', marginBottom: 16, lineHeight: 1.55 }}>
          If the test environment is on a separate server, enable this to note that a dedicated BCAgent is needed.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={testSeparate} onChange={e => setTestSeparate(e.target.checked)}
            style={{ accentColor: 'var(--rb-accent)', width: 14, height: 14 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)' }}>Test environment is on a separate server</span>
        </label>
        {testSeparate ? (
          <div style={{ marginTop: 16, background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.25)', borderRadius: 8, padding: '12px 16px' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-warning)', margin: 0 }}>
              Separate test server installer generation coming soon. Contact BespoxAI once details are confirmed.
            </p>
          </div>
        ) : null}
      </Card>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Sync config — only if tunnel exists */}
        {hasTunnel ? (
          <button onClick={syncConfig} disabled={syncLoading} style={{
            width: '100%', background: syncLoading ? 'var(--rb-border)' : 'var(--rb-surface)',
            color: syncLoading ? 'var(--rb-text-muted)' : 'var(--rb-text)',
            border: '1px solid var(--rb-border-strong)', borderRadius: 8, padding: '11px',
            cursor: syncLoading ? 'default' : 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
          }}>
            {syncLoading ? 'Syncing…' : '↑ Sync Config to Agent'}
          </button>
        ) : null}
        {hasTunnel ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--rb-text-muted)', textAlign: 'center', marginTop: -4, lineHeight: 1.5 }}>
            Pushes current settings to the running agent immediately — no reinstall needed. Credentials stay unchanged on the server.
          </p>
        ) : null}

        {/* Provision RDP — only if tunnel exists */}
        {hasTunnel ? (
          <button onClick={provisionRdp} disabled={rdpLoading} style={{
            width: '100%', background: rdpLoading ? 'var(--rb-border)' : 'var(--rb-surface)',
            color: rdpLoading ? 'var(--rb-text-muted)' : 'var(--rb-text)',
            border: '1px solid var(--rb-border-strong)', borderRadius: 8, padding: '11px',
            cursor: rdpLoading ? 'default' : 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
          }}>
            {rdpLoading ? 'Provisioning…' : '⧉ Provision RDP Access'}
          </button>
        ) : null}
        {hasTunnel ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--rb-text-muted)', textAlign: 'center', marginTop: -4, lineHeight: 1.5 }}>
            {'Adds remote desktop access via ' + (tenant.tunnelSubdomain || '') + '-rdp.bespoxai.com — run once after installer.'}
          </p>
        ) : null}

        {/* Download installer */}
        <button onClick={downloadInstaller} disabled={instLoading} style={{
          width: '100%', background: instLoading ? 'var(--rb-active)' : 'var(--rb-primary)',
          color: '#fff', border: 'none', borderRadius: 8, padding: '12px',
          cursor: instLoading ? 'default' : 'pointer',
          fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
          opacity: instLoading ? 0.7 : 1,
        }}>
          {instLoading ? 'Generating…' : ('⬇ Download Installer' + (agentVersion ? ' v' + agentVersion : '') + ' (.zip)')}
        </button>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--rb-text-muted)', textAlign: 'center', marginTop: -4 }}>
          {erpLabel + ' credentials are embedded in the installer and never stored by BespoxAI.'}
        </p>

        {/* Feedback banner */}
        {feedback ? (
          <div style={{
            padding: '10px 16px', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: 13,
            background: feedback.type === 'ok' ? 'rgba(35,134,54,0.15)' : 'rgba(163,45,45,0.15)',
            border: '1px solid ' + (feedback.type === 'ok' ? 'rgba(63,185,80,0.3)' : 'rgba(163,45,45,0.4)'),
            color: feedback.type === 'ok' ? 'var(--rb-success)' : 'var(--rb-danger)',
          }}>
            {feedback.msg}
          </div>
        ) : null}

      </div>
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
            background: connected ? 'var(--rb-success)' : 'var(--rb-text-muted)',
            display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: connected ? 'var(--rb-success)' : 'var(--rb-text-muted)' }}>
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
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: 0 }}>No users yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name','Email','Role','Joined'].map(h => (
                  <th key={h} style={{ padding: '6px 0', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', paddingRight: 24 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenant.users.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--rb-border)' }}>
                  <td style={{ padding: '8px 0', paddingRight: 24, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)' }}>{u.name ?? u.firstName ?? '—'}</td>
                  <td style={{ padding: '8px 0', paddingRight: 24, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)' }}>{u.email}</td>
                  <td style={{ padding: '8px 0', paddingRight: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--rb-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{u.role.replace('tenant_','')}</td>
                  <td style={{ padding: '8px 0', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text-muted)' }}>{fmtDate(u.createdAt)}</td>
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
    width: '100%', background: 'var(--rb-inset)', border: '1px solid var(--rb-border-strong)', borderRadius: 6,
    color: 'var(--rb-text)', fontFamily: 'var(--font-body)', fontSize: 13,
    padding: '8px 12px', outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)',
    letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6,
  }

  return (
    <Card>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 16, fontWeight: 600, color: 'var(--rb-text-bright)', marginBottom: 20 }}>
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
        {error ? <p style={{ color: 'var(--rb-danger)', fontFamily: 'var(--font-body)', fontSize: 13, margin: 0 }}>{error}</p> : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{ background: 'none', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-text-muted)', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 16px', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, padding: '8px 20px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Creating…' : 'Create Requirement'}
          </button>
        </div>
      </div>
    </Card>
  )
}

// ── Collapsible card (partner detail) ────────────────────────────────────────
function CollapsibleCard({ label, accessory, collapsed, onToggle, children, style }: {
  label: React.ReactNode
  accessory?: React.ReactNode
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <Card style={{ marginBottom: 16, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed ? 0 : 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {accessory ?? null}
          <button onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--rb-text-muted)', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center' }}>
            {collapsed ? '\u25be' : '\u25b4'}
          </button>
        </div>
      </div>
      <div style={{ overflow: 'hidden', maxHeight: collapsed ? 0 : '99999px', transition: 'max-height 0.25s ease' }}>
        {children}
      </div>
    </Card>
  )
}

function parseDevPlan(raw: string | null): Record<string, any> | null {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// Extract C/AL OBJECT blocks from an AI coding-assistant response.
function extractCalObjects(text: string): { filename: string; content: string }[] {
  const results: { filename: string; content: string }[] = []
  const fenceRe = /```(?:cal|txt|nav|c\/al)?\n(OBJECT [^\n]+[\s\S]*?)```/gi
  let m
  while ((m = fenceRe.exec(text)) !== null) {
    const block  = m[1].trim()
    const header = block.split('\n')[0]
    const parts  = header.match(/^OBJECT\s+(\w+)\s+(\d+)\s+(.+)$/)
    if (parts) {
      const objType = parts[1]
      const objId   = parts[2]
      const objName = parts[3].trim().replace(/[^a-zA-Z0-9_\-. ]/g, '_')
      results.push({ filename: objType + '_' + objId + '_' + objName + '.txt', content: block })
    } else {
      results.push({ filename: 'object.txt', content: block })
    }
  }
  return results
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
  const [editForm, setEditForm] = useState({ title: req.title, description: req.description, bcArea: req.bcArea, priority: req.priority })

  // Developer assignment (partner is the deliverer for its own tenants)
  const { data: _sess } = useSession()
  const partnerRole = (_sess?.user as any)?.partnerRole ?? ''
  const isPartnerAdmin = partnerRole === 'partner_admin'

  // Brand label for client-facing content — white-label partners show their own brand
  const branding = useBranding()
  const brandLabel = branding.isWhiteLabel && branding.brandName ? branding.brandName : 'BespoxAI'
  const [team, setTeam] = useState<any[]>([])
  const [assigning, setAssigning] = useState(false)
  useEffect(() => {
    if (!isPartnerAdmin) return
    fetch('/api/partner/users')
      .then(r => r.ok ? r.json() : [])
      .then(d => setTeam(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [isPartnerAdmin])

  async function assignDeveloper(userId: string) {
    if (!userId) return
    setAssigning(true)
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/requirements/' + req.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedDeveloperId: userId }),
      })
      const data = await res.json()
      if (res.ok && data.requirement) onUpdated(data.requirement)
    } catch {
      // swallow — UI stays on previous assignment
    } finally {
      setAssigning(false)
    }
  }

  // Deliverer panel state
  const [showQuoteForm, setShowQuoteForm]     = useState(false)
  const [showQuestionForm, setShowQuestionForm] = useState(false)
  const [delivQuote, setDelivQuote]           = useState('')
  const [delivNote, setDelivNote]             = useState('')
  const [delivQuestions, setDelivQuestions]   = useState('')
  const [showUatReject, setShowUatReject]     = useState(false)
  const [uatRejectReason, setUatRejectReason] = useState('')
  const [uatScopeCreep, setUatScopeCreep]     = useState<{ explanation: string; suggestedAmendment?: string } | null>(null)
  const [genSpec, setGenSpec] = useState(false)
  const [specErr, setSpecErr] = useState('')
  const spec = parseSpec(req.aiSpec)
  const qaLog = readQALog(req.adminQALog)
  const sc = STATUS_COLOR[req.status] ?? STATUS_COLOR.draft
  const pipelineIndex = STATUS_PIPELINE.findIndex(s => s.key === req.status)

  // ── Feasibility ───────────────────────────────────────────────────────────
  const [feasLoading, setFeasLoading] = useState(false)
  const [feasErr, setFeasErr] = useState('')
  const feasAutoRun = useRef(false)

  // ── Dev plan ──────────────────────────────────────────────────────────────
  const [devPlanData, setDevPlanData] = useState<Record<string, any> | null>(parseDevPlan(req.devPlan))
  const [genPlan, setGenPlan] = useState(false)
  const [planErr, setPlanErr] = useState('')

  // ── Dev notes (streaming AI dev assistant) ────────────────────────────────
  const [devHistory, setDevHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [devQuestion, setDevQuestion] = useState('')
  const [devStreaming, setDevStreaming] = useState(false)

  // ── Coding assistant (streaming + commit) ─────────────────────────────────
  const [codingHistory, setCodingHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [codingMessage, setCodingMessage] = useState('')
  const [codingStreaming, setCodingStreaming] = useState(false)
  const [codingCommitting, setCodingCommitting] = useState<number | null>(null)
  const [codingCommitErr, setCodingCommitErr] = useState('')
  const [codingCommitted, setCodingCommitted] = useState<Record<string, boolean>>({})

  // ── Collapsible cards — status-based defaults (mirrors admin) ─────────────
  // A card collapses by default once the requirement has moved past the stage
  // where that card is the focus of attention.
  const devStages = ['in_development', 'in_uat', 'uat_confirmed', 'complete_pending_payment', 'fully_paid']
  const isDevStage = devStages.includes(req.status)
  function defaultCollapsed(cardKey: string): boolean {
    switch (cardKey) {
      case 'description': return isDevStage
      case 'feasibility': return isDevStage
      case 'spec':        return req.status === 'fully_paid'
      case 'devplan':     return false
      case 'devnotes':    return true
      case 'coding':      return false
      case 'qa':          return isDevStage
      default:            return false
    }
  }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  function isCollapsed(cardKey: string): boolean {
    return cardKey in collapsed ? collapsed[cardKey] : defaultCollapsed(cardKey)
  }
  function toggleCard(cardKey: string) {
    setCollapsed(prev => ({ ...prev, [cardKey]: !isCollapsed(cardKey) }))
  }

  async function runFeasibility() {
    setFeasLoading(true)
    setFeasErr('')
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/requirements/' + req.id + '/feasibility', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setFeasErr(data.error || 'Feasibility check failed'); return }
      onUpdated(data.requirement)
    } catch {
      setFeasErr('Feasibility check failed — please try again.')
    } finally {
      setFeasLoading(false)
    }
  }

  // Mirror BespoxAI: feasibility runs automatically the moment a requirement
  // exists. If a pre-quote requirement has no feasibility verdict yet, fire it
  // once on open (covers both freshly-created and pre-existing requirements).
  useEffect(() => {
    const preQuote = ['draft', 'submitted', 'in_review', 'needs_clarification', 'quote_rejected'].includes(req.status)
    if (preQuote && !req.feasibility && !feasAutoRun.current && !feasLoading) {
      feasAutoRun.current = true
      runFeasibility()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.id, req.status, req.feasibility])

  async function generateDevPlan() {
    setGenPlan(true)
    setPlanErr('')
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/requirements/' + req.id + '/dev-plan', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setPlanErr(data.error || 'Dev plan generation failed'); return }
      setDevPlanData(data.devPlan)
      onUpdated({ ...req, devPlan: JSON.stringify(data.devPlan) })
    } catch {
      setPlanErr('Dev plan generation failed — please try again.')
    } finally {
      setGenPlan(false)
    }
  }

  async function sendDevNote() {
    const question = devQuestion.trim()
    if (!question || devStreaming) return
    setDevQuestion('')
    setDevStreaming(true)
    const historyToSend = devHistory.map(h => ({ role: h.role, content: h.content }))
    setDevHistory(prev => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }])
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/requirements/' + req.id + '/dev-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: historyToSend }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as any))
        setDevHistory(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: 'Error: ' + ((d as any).error ?? 'Request failed') }; return u })
        return
      }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let answer = ''
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue
          try {
            const data = JSON.parse(raw)
            if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
              answer += data.delta.text ?? ''
              setDevHistory(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: answer }; return u })
            }
          } catch { /* skip malformed chunk */ }
        }
      }
    } catch {
      setDevHistory(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: 'Error contacting AI — please try again.' }; return u })
    } finally {
      setDevStreaming(false)
    }
  }

  async function sendCodingMessage() {
    const msg = codingMessage.trim()
    if (!msg || codingStreaming) return
    setCodingMessage('')
    setCodingStreaming(true)
    const historyToSend = codingHistory.map(h => ({ role: h.role, content: h.content }))
    setCodingHistory(prev => [...prev, { role: 'user', content: msg }, { role: 'assistant', content: '' }])
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/requirements/' + req.id + '/coding-assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: historyToSend }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as any))
        throw new Error((d as any).error ?? 'Request failed')
      }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
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
              setCodingHistory(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: answer }; return u })
            }
          } catch { /* skip */ }
        }
      }
    } catch (e: any) {
      setCodingHistory(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: 'Error: ' + (e.message ?? 'Could not reach AI') }; return u })
    } finally {
      setCodingStreaming(false)
    }
  }

  async function commitCalObject(key: string, filename: string, content: string, idx: number) {
    setCodingCommitting(idx)
    setCodingCommitErr('')
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/requirements/' + req.id + '/coding-assistant/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Commit failed')
      setCodingCommitted(prev => ({ ...prev, [key]: true }))
    } catch (e: any) {
      setCodingCommitErr(e.message ?? 'Commit failed')
    } finally {
      setCodingCommitting(null)
    }
  }

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

  function handleSubmitWithEdits() {
    if (!editForm.title.trim() || !editForm.description.trim()) return
    patch({
      status: 'submitted',
      title: editForm.title,
      description: editForm.description,
      bcArea: editForm.bcArea,
      priority: editForm.priority,
    })
  }
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

  // ── Deliverer handlers (partner acting as delivery role) ──────────────────
  function handleMoveToReview() { patch({ status: 'in_review' }) }
  function handleSendQuestions() {
    if (!delivQuestions.trim()) return
    patch({ status: 'needs_clarification', adminQuestions: delivQuestions })
    setDelivQuestions('')
    setShowQuestionForm(false)
  }
  function handleIssueQuote() {
    const amt = parseFloat(delivQuote)
    if (!delivQuote.trim() || isNaN(amt) || amt <= 0) return
    patch({ status: 'quoted', quote: amt, consultantNote: delivNote || undefined })
    setShowQuoteForm(false)
  }
  function handleMarkDepositPaid()  { patch({ status: 'deposit_paid' }) }
  function handleStartDevelopment() { patch({ status: 'in_development' }) }
  function handleMarkComplete()     { patch({ status: 'complete_pending_payment' }) }
  function handleMarkBalancePaid()  { patch({ status: 'fully_paid' }) }

  async function handleUatApprove() {
    setSaving(true)
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/requirements/' + req.id + '/uat-approve', { method: 'POST' })
      if (res.ok) { const d = await res.json(); onUpdated({ ...req, status: 'uat_confirmed', uatApprovedAt: d.approvedAt }) }
    } finally { setSaving(false) }
  }
  async function handleUatReject(confirmReject: boolean) {
    if (!uatRejectReason.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/requirements/' + req.id + '/uat-reject', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: uatRejectReason, confirm: confirmReject }),
      })
      const d = await res.json()
      if (d.isScopeCreep && !confirmReject) {
        setUatScopeCreep({ explanation: d.explanation, suggestedAmendment: d.suggestedAmendment })
      } else if (d.rejected) {
        setUatScopeCreep(null)
        setShowUatReject(false)
        setUatRejectReason('')
        onUpdated({ ...req, status: 'uat_rejected' })
      }
    } finally { setSaving(false) }
  }

  async function generateSpec() {
    setGenSpec(true)
    setSpecErr('')
    const res = await fetch(`/api/partner/tenants/${tenantId}/requirements/${req.id}/ai-spec`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json()
      setSpecErr(data.error || 'Failed to generate spec')
      setGenSpec(false)
      return
    }
    const data = await res.json()
    onUpdated(data.requirement)
    setGenSpec(false)
  }

  const btnPrimary: React.CSSProperties = {
    background: 'var(--rb-primary)', border: 'none', borderRadius: 6, color: '#fff',
    fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
    padding: '8px 20px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
  }
  const btnSecondary: React.CSSProperties = {
    background: 'none', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-text-muted)',
    fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 16px', cursor: 'pointer',
  }
  const btnDanger: React.CSSProperties = {
    background: 'none', border: '1px solid rgba(163,45,45,0.5)', borderRadius: 6, color: 'var(--rb-danger)',
    fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 16px', cursor: 'pointer',
  }
  const editLabel: React.CSSProperties = {
    display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)',
    letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6,
  }
  const editInput: React.CSSProperties = {
    width: '100%', background: 'var(--rb-inset)', border: '1px solid var(--rb-border-strong)', borderRadius: 6,
    color: 'var(--rb-text)', fontFamily: 'var(--font-body)', fontSize: 14, padding: '8px 12px',
    boxSizing: 'border-box',
  }

  return (
    <div>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
        <button onClick={onBack} style={{ ...btnSecondary, padding: '6px 12px', flexShrink: 0 }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--rb-text-bright)', fontWeight: 400, margin: 0 }}>{req.title}</h2>
            <StatusBadge status={req.status} />
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text-muted)', marginTop: 4 }}>
            {req.bcArea} · {PRIORITIES.find(p => p.value === req.priority)?.label ?? req.priority} · Raised {fmtDate(req.createdAt)}
          </div>
          {/* Developer assignment — partner is the deliverer; partner_admin assigns own staff */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Assigned developer</span>
            {isPartnerAdmin ? (
              <select
                value={req.assignedDeveloper?.id ?? ''}
                disabled={assigning}
                onChange={e => assignDeveloper(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--rb-border-strong)', background: 'var(--rb-surface)', color: 'var(--rb-text)', cursor: assigning ? 'wait' : 'pointer' }}
              >
                <option value="">Assign developer…</option>
                {team.map((m: any) => (
                  <option key={m.user.id} value={m.user.id}>{m.user.name}{m.role === 'partner_admin' ? ' (admin)' : ''}</option>
                ))}
              </select>
            ) : (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--rb-text)' }}>
                {req.assignedDeveloper ? (req.assignedDeveloper.preferredName ?? req.assignedDeveloper.firstName ?? req.assignedDeveloper.name ?? req.assignedDeveloper.email) : 'Unassigned'}
              </span>
            )}
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
                    background: current ? sc.text : (done ? 'var(--rb-success)' : 'var(--rb-border-strong)'),
                    border: current ? '2px solid ' + sc.text : (done ? '2px solid var(--rb-success)' : '2px solid var(--rb-border-strong)'),
                  }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: done ? 'var(--rb-text)' : 'var(--rb-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4, whiteSpace: 'nowrap' }}>{s.label}</span>
                </div>
                {i < STATUS_PIPELINE.length - 1 ? (
                  <div style={{ flex: 1, height: 2, background: done ? 'var(--rb-success)' : 'var(--rb-border-strong)', margin: '0 2px', marginBottom: 18 }} />
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Description */}
      <CollapsibleCard label="Description" collapsed={isCollapsed('description')} onToggle={() => toggleCard('description')}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--rb-text)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{req.description}</p>
      </CollapsibleCard>

      {/* Feasibility */}
      {(feasLoading || req.feasibility) ? (
        <CollapsibleCard
          label={brandLabel + ' Feasibility Check'}
          collapsed={isCollapsed('feasibility')}
          onToggle={() => toggleCard('feasibility')}
          accessory={
            ['draft','submitted','in_review','needs_clarification','quote_rejected'].includes(req.status)
              ? <button onClick={runFeasibility} disabled={feasLoading} style={{ background: 'none', border: 'none', cursor: feasLoading ? 'not-allowed' : 'pointer', color: 'var(--rb-accent)', fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>{feasLoading ? '\u2026' : '\u21ba Recheck'}</button>
              : null
          }
        >
          {feasLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)' }}>Checking feasibility\u2026</span>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                {req.feasibility === 'cfo_assistant' ? (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-warning)', background: 'rgba(200,149,42,0.1)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 20, padding: '3px 12px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>\ud83d\udca1 No development needed</span>
                ) : null}
                {req.feasibility === 'development' ? (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-success)', background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)', borderRadius: 20, padding: '3px 12px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Development required</span>
                ) : null}
                {req.feasibility === 'infeasible' ? (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-danger)', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 20, padding: '3px 12px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>\u26a0 Constrained</span>
                ) : null}
                {req.feasibility === 'development' && req.feasibilityCostRange ? (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-success)', background: 'rgba(10,92,70,0.1)', border: '1px solid rgba(10,92,70,0.3)', borderRadius: 20, padding: '3px 12px' }}>Indicative: {req.feasibilityCostRange}</span>
                ) : null}
                {req.feasibilityCheckedAt ? (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-text-muted)' }}>{fmtDate(req.feasibilityCheckedAt)}</span>
                ) : null}
              </div>
              {req.feasibilityNotes ? (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', lineHeight: 1.65, margin: 0 }}>{req.feasibilityNotes}</p>
              ) : null}

              {/* Verdict-driven CTAs — mirror BespoxAI */}
              {req.feasibility === 'development' && !spec && ['draft','submitted','in_review','needs_clarification','quote_rejected'].includes(req.status) ? (
                <div style={{ paddingTop: 12, marginTop: 12, borderTop: '1px solid var(--rb-border)' }}>
                  <button onClick={() => generateSpec()} disabled={genSpec} style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--rb-bg)', background: 'var(--rb-primary)', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: genSpec ? 'not-allowed' : 'pointer', opacity: genSpec ? 0.7 : 1 }}>{genSpec ? 'Generating spec\u2026' : 'Generate Full Specification \u2192'}</button>
                  {specErr ? <p style={{ color: 'var(--rb-danger)', fontSize: 12, marginTop: 8 }}>{specErr}</p> : null}
                </div>
              ) : null}

              {req.feasibility === 'cfo_assistant' && !spec && ['draft','submitted','in_review','needs_clarification','quote_rejected'].includes(req.status) ? (
                <div style={{ paddingTop: 12, marginTop: 12, borderTop: '1px solid var(--rb-border)' }}>
                  <button onClick={() => generateSpec()} disabled={genSpec} style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--rb-text)', background: 'var(--rb-surface-2)', border: '1px solid var(--rb-border-strong)', borderRadius: 6, padding: '8px 16px', cursor: genSpec ? 'not-allowed' : 'pointer', opacity: genSpec ? 0.7 : 1 }}>{genSpec ? 'Generating\u2026' : 'Scope as development anyway'}</button>
                  {specErr ? <p style={{ color: 'var(--rb-danger)', fontSize: 12, marginTop: 8 }}>{specErr}</p> : null}
                </div>
              ) : null}

              {feasErr ? <p style={{ color: 'var(--rb-danger)', fontSize: 12, marginTop: 10 }}>{feasErr}</p> : null}
            </div>
          )}
        </CollapsibleCard>
      ) : null}

      {/* AI Spec */}
      {spec ? (
        <CollapsibleCard
          label="AI Specification"
          collapsed={isCollapsed('spec')}
          onToggle={() => toggleCard('spec')}
          accessory={
            ['draft','submitted','in_review','needs_clarification','quote_rejected'].includes(req.status)
              ? <button onClick={() => generateSpec()} disabled={genSpec} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rb-accent)', fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>{genSpec ? '\u2026' : '\u21ba Regen'}</button>
              : null
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>User Story</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', lineHeight: 1.6, margin: 0 }}>{spec.userStory}</p>
            </div>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>Complexity</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', margin: 0 }}>{spec.complexity} · Est. {spec.estimatedDays} day{spec.estimatedDays !== 1 ? 's' : ''}</p>
            </div>
            {spec.acceptanceCriteria?.length > 0 ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>Acceptance Criteria</p>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {spec.acceptanceCriteria.map((c: string, i: number) => (
                    <li key={i} style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', lineHeight: 1.6 }}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {spec.bcObjects?.length > 0 ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>BC Objects Affected</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {spec.bcObjects.map((o: string, i: number) => (
                    <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--rb-accent)', background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.2)', borderRadius: 4, padding: '2px 8px' }}>{o}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {specErr && <p style={{ color: 'var(--rb-danger)', fontSize: 12, marginTop: 12 }}>{specErr}</p>}
        </CollapsibleCard>
      ) : null}

      {/* Consultant note */}
      {req.consultantNote ? (
        <Card style={{ marginBottom: 16, borderColor: 'rgba(10,92,70,0.4)', background: 'rgba(10,92,70,0.06)' }}>
          <SectionLabel>{'Note from ' + brandLabel}</SectionLabel>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--rb-text)', lineHeight: 1.6, margin: 0 }}>{req.consultantNote}</p>
        </Card>
      ) : null}

      {/* ── Dev Plan (shared component) ─────────────────────────────────────── */}
      {['quoted','deposit_required','deposit_paid','in_development','in_uat','uat_confirmed','complete_pending_payment','fully_paid'].includes(req.status) ? (
        <DevPlanPanel
          data={devPlanData}
          generating={genPlan}
          error={planErr}
          onGenerate={generateDevPlan}
          collapsed={isCollapsed('devplan')}
          onToggle={() => toggleCard('devplan')}
          showPricing={false}
        />
      ) : null}

      {/* ── AI Dev Assistant (streaming notes) ──────────────────────────────── */}
      {['quoted','deposit_required','deposit_paid','in_development','in_uat','uat_confirmed','complete_pending_payment','fully_paid'].includes(req.status) ? (
        <CollapsibleCard label="AI Dev Assistant" collapsed={isCollapsed('devnotes')} onToggle={() => toggleCard('devnotes')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {devHistory.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: 0 }}>
                Ask the assistant to draft client-facing notes, explain an approach, or help with quoting and review. Responses are written as your consultancy.
              </p>
            ) : null}
            {devHistory.map((m, i) => (
              <div key={i} style={{ background: m.role === 'user' ? 'var(--rb-bg)' : 'rgba(56,139,253,0.06)', border: '1px solid ' + (m.role === 'user' ? 'var(--rb-border)' : 'rgba(56,139,253,0.25)'), borderRadius: 6, padding: '10px 14px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: m.role === 'user' ? 'var(--rb-text-muted)' : 'var(--rb-accent)', margin: '0 0 6px' }}>{m.role === 'user' ? 'You' : 'Assistant'}</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{m.content || (devStreaming && i === devHistory.length - 1 ? '\u2026' : '')}</p>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea value={devQuestion} onChange={e => setDevQuestion(e.target.value)} rows={2} placeholder="Ask the dev assistant\u2026" style={{ flex: 1, background: 'var(--rb-inset)', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-text)', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 12px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
              <button onClick={sendDevNote} disabled={devStreaming || !devQuestion.trim()} style={{ ...btnPrimary, alignSelf: 'flex-end', opacity: (devStreaming || !devQuestion.trim()) ? 0.5 : 1 }}>{devStreaming ? '\u2026' : 'Send'}</button>
            </div>
          </div>
        </CollapsibleCard>
      ) : null}

      {/* ── Coding Assistant (C/AL + commit) ────────────────────────────────── */}
      {['quoted','deposit_required','deposit_paid','in_development','in_uat','uat_confirmed','complete_pending_payment','fully_paid'].includes(req.status) ? (
        <CollapsibleCard
          label="Coding Assistant"
          collapsed={isCollapsed('coding')}
          onToggle={() => toggleCard('coding')}
          accessory={req.githubBranch ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-text-muted)' }}>{req.githubBranch}</span> : null}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!req.githubBranch ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-warning)', margin: 0 }}>
                No GitHub branch is linked to this requirement yet. Fetch and save objects first so the assistant can read the C/AL source.
              </p>
            ) : null}
            {codingHistory.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: 0 }}>
                The assistant reads the C/AL on this branch. Ask it to write or modify objects; commit accepted objects back to GitHub.
              </p>
            ) : null}
            {codingHistory.map((m, i) => {
              const calObjects = m.role === 'assistant' ? extractCalObjects(m.content) : []
              return (
                <div key={i} style={{ background: m.role === 'user' ? 'var(--rb-bg)' : 'rgba(10,92,70,0.06)', border: '1px solid ' + (m.role === 'user' ? 'var(--rb-border)' : 'rgba(10,92,70,0.25)'), borderRadius: 6, padding: '10px 14px' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: m.role === 'user' ? 'var(--rb-text-muted)' : 'var(--rb-success)', margin: '0 0 6px' }}>{m.role === 'user' ? 'You' : 'Assistant'}</p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{m.content || (codingStreaming && i === codingHistory.length - 1 ? '\u2026' : '')}</p>
                  {calObjects.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                      {calObjects.map((obj, j) => {
                        const key = i + '-' + j
                        const committed = !!codingCommitted[key]
                        return (
                          <div key={j} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--rb-inset)', border: '1px solid var(--rb-border)', borderRadius: 5, padding: '6px 10px' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-accent)' }}>{obj.filename}</span>
                            <button onClick={() => commitCalObject(key, obj.filename, obj.content, i)} disabled={!req.githubBranch || codingCommitting === i || committed} style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11, opacity: (!req.githubBranch || committed) ? 0.5 : 1, color: committed ? 'var(--rb-success)' : 'var(--rb-text-muted)' }}>
                              {committed ? '\u2713 Committed' : (codingCommitting === i ? 'Committing\u2026' : 'Commit to GitHub')}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
            {codingCommitErr ? <p style={{ color: 'var(--rb-danger)', fontSize: 12, margin: 0 }}>{codingCommitErr}</p> : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea value={codingMessage} onChange={e => setCodingMessage(e.target.value)} rows={2} placeholder="Ask the coding assistant\u2026" style={{ flex: 1, background: 'var(--rb-inset)', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-text)', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 12px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
              <button onClick={sendCodingMessage} disabled={codingStreaming || !codingMessage.trim()} style={{ ...btnPrimary, alignSelf: 'flex-end', opacity: (codingStreaming || !codingMessage.trim()) ? 0.5 : 1 }}>{codingStreaming ? '\u2026' : 'Send'}</button>
            </div>
          </div>
        </CollapsibleCard>
      ) : null}

      {/* ── Deliverer action panel (partner acts as delivery role) ──────────── */}
      {['submitted', 'in_review', 'deposit_required', 'deposit_paid', 'in_development', 'in_uat', 'complete_pending_payment'].includes(req.status) ? (
        <Card style={{ marginBottom: 16, borderColor: 'rgba(56,139,253,0.35)', background: 'rgba(56,139,253,0.04)' }}>
          <SectionLabel>Delivery Actions</SectionLabel>

          {(req.status === 'submitted' || req.status === 'in_review') ? (
            <div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: '0 0 14px' }}>
                Review this requirement, ask the client for clarification, or issue a quote.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {req.status === 'submitted' ? (
                  <button onClick={handleMoveToReview} disabled={saving} style={btnSecondary}>Move to Review</button>
                ) : null}
                <button onClick={() => setShowQuestionForm(!showQuestionForm)} style={btnSecondary}>Send Back with Questions</button>
                <button onClick={() => setShowQuoteForm(!showQuoteForm)} style={btnPrimary}>Issue Quote</button>
              </div>
              {showQuestionForm ? (
                <div style={{ marginTop: 14 }}>
                  <label style={editLabel}>Questions for the client</label>
                  <textarea value={delivQuestions} onChange={e => setDelivQuestions(e.target.value)} rows={4} style={{ ...editInput, resize: 'vertical' }} placeholder="What do you need clarified before quoting?" />
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    <button onClick={handleSendQuestions} disabled={saving || !delivQuestions.trim()} style={{ ...btnPrimary, opacity: (saving || !delivQuestions.trim()) ? 0.5 : 1 }}>Send Questions</button>
                    <button onClick={() => setShowQuestionForm(false)} style={btnSecondary}>Cancel</button>
                  </div>
                </div>
              ) : null}
              {showQuoteForm ? (
                <div style={{ marginTop: 14 }}>
                  <label style={editLabel}>Quote amount (NZD, excl. GST)</label>
                  <input value={delivQuote} onChange={e => setDelivQuote(e.target.value)} type="number" min="0" step="0.01" style={editInput} placeholder="0.00" />
                  <label style={{ ...editLabel, marginTop: 12 }}>Note to client (optional)</label>
                  <textarea value={delivNote} onChange={e => setDelivNote(e.target.value)} rows={3} style={{ ...editInput, resize: 'vertical' }} placeholder="Anything the client should know about this quote" />
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    <button onClick={handleIssueQuote} disabled={saving || !delivQuote.trim()} style={{ ...btnPrimary, opacity: (saving || !delivQuote.trim()) ? 0.5 : 1 }}>Send Quote</button>
                    <button onClick={() => setShowQuoteForm(false)} style={btnSecondary}>Cancel</button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {req.status === 'deposit_required' ? (
            <div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: '0 0 14px' }}>Client has accepted the quote. Mark the deposit as received to begin development.</p>
              <button onClick={handleMarkDepositPaid} disabled={saving} style={btnPrimary}>Mark Deposit Paid</button>
            </div>
          ) : null}

          {req.status === 'deposit_paid' ? (
            <div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: '0 0 14px' }}>Deposit received. Start development when you are ready.</p>
              <button onClick={handleStartDevelopment} disabled={saving} style={btnPrimary}>Start Development</button>
            </div>
          ) : null}

          {req.status === 'in_development' ? (
            <div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: '0 0 14px' }}>Mark the work complete once it has been deployed and is ready for the client to pay the balance.</p>
              <button onClick={handleMarkComplete} disabled={saving} style={btnPrimary}>Mark Work Complete</button>
            </div>
          ) : null}

          {req.status === 'in_uat' ? (
            <div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: '0 0 14px' }}>Sign off UAT on behalf of the client, or reject if the delivered work needs changes.</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleUatApprove} disabled={saving} style={btnPrimary}>Approve UAT</button>
                <button onClick={() => setShowUatReject(!showUatReject)} style={btnDanger}>Reject UAT</button>
              </div>
              {showUatReject ? (
                <div style={{ marginTop: 14 }}>
                  <label style={editLabel}>Reason for rejection</label>
                  <textarea value={uatRejectReason} onChange={e => setUatRejectReason(e.target.value)} rows={3} style={{ ...editInput, resize: 'vertical' }} placeholder="What needs to change?" />
                  {uatScopeCreep ? (
                    <div style={{ marginTop: 12, background: 'rgba(200,149,42,0.08)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 6, padding: '12px 16px' }}>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-warning)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 6px' }}>Possible scope change</p>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', margin: '0 0 8px' }}>{uatScopeCreep.explanation}</p>
                      {uatScopeCreep.suggestedAmendment ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: 0 }}>{uatScopeCreep.suggestedAmendment}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    <button onClick={() => handleUatReject(!!uatScopeCreep)} disabled={saving || !uatRejectReason.trim()} style={{ ...btnDanger, background: 'rgba(163,45,45,0.15)', opacity: (saving || !uatRejectReason.trim()) ? 0.5 : 1 }}>
                      {uatScopeCreep ? 'Reject Anyway' : 'Confirm Rejection'}
                    </button>
                    <button onClick={() => { setShowUatReject(false); setUatScopeCreep(null) }} style={btnSecondary}>Cancel</button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {req.status === 'complete_pending_payment' ? (
            <div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: '0 0 14px' }}>Work complete. Mark the balance as paid once the client has settled the final invoice.</p>
              <button onClick={handleMarkBalancePaid} disabled={saving} style={btnPrimary}>Mark Balance Paid</button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Quote */}
      {req.status === 'quoted' || req.status === 'deposit_required' || req.status === 'quote_rejected' || req.status === 'deposit_paid' || req.status === 'in_development' || req.status === 'complete_pending_payment' || req.status === 'fully_paid' ? (
        req.quote ? (
          <Card style={{ marginBottom: 16 }}>
            <SectionLabel>Quote</SectionLabel>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--rb-text-bright)', marginBottom: 4 }}>
              {'$' + parseFloat(req.quote).toLocaleString('en-NZ', { minimumFractionDigits: 2 }) + ' NZD'}
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text-muted)', margin: 0 }}>plus GST · 20% deposit on acceptance</p>
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
                  style={{ width: '100%', background: 'var(--rb-inset)', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-text)', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 12px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
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
        <CollapsibleCard label="Clarification Q&A" collapsed={isCollapsed('qa')} onToggle={() => toggleCard('qa')}>
          {qaLog.map((round: any, i: number) => (
            <div key={i} style={{ marginBottom: i < qaLog.length - 1 ? 20 : 0 }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8, marginTop: 0 }}>Round {round.round}</p>
              <div style={{ background: 'rgba(200,149,42,0.06)', border: '1px solid rgba(200,149,42,0.2)', borderRadius: 6, padding: '12px 16px', marginBottom: 10 }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-warning)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>{'Questions from ' + brandLabel}</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', whiteSpace: 'pre-wrap', margin: 0 }}>{round.questions}</p>
              </div>
              {round.answers ? (
                <div style={{ background: 'rgba(26,146,114,0.06)', border: '1px solid rgba(26,146,114,0.2)', borderRadius: 6, padding: '12px 16px' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-success)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 0 }}>Your Answers</p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', whiteSpace: 'pre-wrap', margin: 0 }}>{round.answers}</p>
                </div>
              ) : null}
            </div>
          ))}
        </CollapsibleCard>
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
            style={{ width: '100%', background: 'var(--rb-inset)', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-text)', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 12px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
          />
          <div style={{ marginTop: 12 }}>
            <button onClick={handleAnswerSubmit} disabled={saving || !answersText.trim()} style={{ ...btnPrimary, opacity: (saving || !answersText.trim()) ? 0.5 : 1 }}>
              Submit Answers
            </button>
          </div>
        </Card>
      ) : null}

      {/* Submit draft / resubmit — field-editable, mirrors BespoxAI customer flow */}
      {(req.status === 'draft' || req.status === 'quote_rejected') ? (
        <Card style={{ marginBottom: 16 }}>
          <SectionLabel>{req.status === 'draft' ? 'Review & Submit' : 'Revise & Resubmit'}</SectionLabel>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: '0 0 16px' }}>
            {req.status === 'draft' ? 'Review the details below, edit if needed, then submit for review and a quote.' : 'Revise the requirement below before resubmitting for a new quote.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={editLabel}>Title</label>
              <input
                value={editForm.title}
                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                style={editInput}
                placeholder="Brief title for this requirement"
              />
            </div>
            <div>
              <label style={editLabel}>Description</label>
              <textarea
                value={editForm.description}
                onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                rows={5}
                style={{ ...editInput, resize: 'vertical' }}
                placeholder="Describe the requirement in detail"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={editLabel}>BC Area</label>
                <select value={editForm.bcArea} onChange={e => setEditForm({ ...editForm, bcArea: e.target.value })} style={editInput}>
                  {BC_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label style={editLabel}>Priority</label>
                <select value={editForm.priority} onChange={e => setEditForm({ ...editForm, priority: e.target.value })} style={editInput}>
                  {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>
          </div>
          <button
            onClick={handleSubmitWithEdits}
            disabled={saving || !editForm.title.trim() || !editForm.description.trim()}
            style={{ ...btnPrimary, marginTop: 16, opacity: (saving || !editForm.title.trim() || !editForm.description.trim()) ? 0.5 : 1 }}
          >
            {req.status === 'draft' ? 'Submit for Review' : 'Resubmit Requirement'}
          </button>
        </Card>
      ) : null}
    </div>
  )
}

// ── Requirements Tab ─────────────────────────────────────────────────────────

function RequirementsTab({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  // Open requirement lives in the URL (?req=) so Back returns to the list, not out of the page.
  const reqId = searchParams.get('req')
  const selected = reqId ? requirements.find(r => r.id === reqId) ?? null : null

  function openReq(id: string | null) {
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('tab', 'requirements')
    if (id) sp.set('req', id); else sp.delete('req')
    router.push(pathname + '?' + sp.toString(), { scroll: false })
  }

  useEffect(() => {
    fetch('/api/partner/tenants/' + tenantId + '/requirements')
      .then(r => r.json())
      .then(d => { if (d.requirements) setRequirements(d.requirements) })
      .finally(() => setLoading(false))
  }, [tenantId])

  function handleCreated(req: Requirement) {
    setRequirements(prev => [req, ...prev])
    setShowNew(false)
    openReq(req.id)
  }

  function handleUpdated(updated: Requirement) {
    setRequirements(prev => prev.map(r => r.id === updated.id ? updated : r))
  }

  if (selected) {
    return (
      <RequirementDetail
        req={selected}
        tenantId={tenantId}
        onBack={() => openReq(null)}
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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--rb-text-muted)', letterSpacing: '0.1em' }}>LOADING</span>
      </div>
    )
  }

  const topLevel = requirements.filter(r => !r.parentId)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          onClick={() => setShowNew(true)}
          style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, padding: '8px 16px', cursor: 'pointer' }}
        >
          + New Requirement
        </button>
      </div>

      {loading ? (
        <Card><p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--rb-text-muted)', margin: 0, textAlign: 'center' }}>Loading…</p></Card>
      ) : topLevel.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--rb-text-muted)', margin: '0 0 12px' }}>No requirements yet for this client.</p>
            <button onClick={() => setShowNew(true)} style={{ background: 'none', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-accent)', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 16px', cursor: 'pointer' }}>
              Raise first requirement
            </button>
          </div>
        </Card>
      ) : (
        <div style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rb-border)' }}>
                {['Title','Area','Priority','Status','Raised'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topLevel.map((req, i) => {
                const pm = PRIORITIES.find(p => p.value === req.priority)
                return (
                  <tr
                    key={req.id}
                    onClick={() => openReq(req.id)}
                    style={{ borderBottom: i < topLevel.length - 1 ? '1px solid var(--rb-border)' : 'none', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--rb-surface-2)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <td style={{ padding: '12px 20px', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--rb-text)', fontWeight: 500 }}>
                      {req.title}
                      {req.addenda.length > 0 ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-warning)', background: 'rgba(200,149,42,0.12)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 10, padding: '1px 6px', marginLeft: 8 }}>
                          {'+' + req.addenda.length + ' addend' + (req.addenda.length === 1 ? 'um' : 'a')}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: '12px 20px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)' }}>{req.bcArea}</td>
                    <td style={{ padding: '12px 20px' }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: pm?.color ?? 'var(--rb-text-muted)' }}>{pm?.label ?? req.priority}</span>
                    </td>
                    <td style={{ padding: '12px 20px' }}><StatusBadge status={req.status} /></td>
                    <td style={{ padding: '12px 20px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text-muted)' }}>{fmtDate(req.createdAt)}</td>
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
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--rb-text-muted)', letterSpacing: '0.1em' }}>LOADING</span></div>}>
      <PartnerTenantPageInner />
    </Suspense>
  )
}

// ── Client Users Tab ─────────────────────────────────────────────────────────

function ClientUsersTab({ tenantId, initialUsers, isPartnerAdmin, currentUserId }: {
  tenantId: string
  initialUsers: { id: string; name?: string | null; firstName?: string | null; email: string; role: string; createdAt: string; active?: boolean }[]
  isPartnerAdmin: boolean
  currentUserId: string
}) {
  const [users, setUsers] = useState<any[]>(initialUsers ?? [])
  const [rowErr, setRowErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const roleRef = useRef<HTMLSelectElement>(null)

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--rb-inset)', border: '1px solid var(--rb-border-strong)', borderRadius: 6,
    color: 'var(--rb-text)', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 12px', outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)',
    letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6,
  }

  async function submit() {
    setErr('')
    const email = emailRef.current?.value?.trim() ?? ''
    if (!email) { setErr('Email is required.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: nameRef.current?.value?.trim() || null, userRole: roleRef.current?.value || 'tenant_admin' }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || 'Failed to invite user'); setSaving(false); return }
      setUsers(prev => [...prev, data.user])
      setTempPassword(data.tempPassword)
      setShowInvite(false)
    } catch {
      setErr('Failed to invite user — please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function setActive(u: any, active: boolean) {
    setRowErr('')
    setBusyId(u.id)
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/users/' + u.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: active ? 'enable' : 'disable' }),
      })
      const data = await res.json()
      if (!res.ok) { setRowErr(data.error || 'Action failed'); return }
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, active } : x))
    } catch {
      setRowErr('Action failed — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function resend(u: any) {
    if (!window.confirm('Resend the invite to ' + u.email + '?\n\nThis will RESET their password — any existing temporary or chosen password will stop working, and a new welcome email will be sent.')) return
    setRowErr('')
    setBusyId(u.id)
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/users/' + u.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend' }),
      })
      const data = await res.json()
      if (!res.ok) { setRowErr(data.error || 'Resend failed'); return }
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, active: true } : x))
      setTempPassword(data.tempPassword)
    } catch {
      setRowErr('Resend failed — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function resetPw(u: any) {
    if (!window.confirm('Reset the password for ' + u.email + '?\n\nA new temporary password will be generated and shown to you (no email is sent). Their current password will stop working.')) return
    setRowErr('')
    setBusyId(u.id)
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/users/' + u.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      })
      const data = await res.json()
      if (!res.ok) { setRowErr(data.error || 'Reset failed'); return }
      setTempPassword(data.tempPassword)
    } catch {
      setRowErr('Reset failed — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(u: any) {
    if (!window.confirm('Remove ' + u.email + '?\n\nThis permanently deletes their login. This cannot be undone.')) return
    setRowErr('')
    setBusyId(u.id)
    try {
      const res = await fetch('/api/partner/tenants/' + tenantId + '/users/' + u.id, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { setRowErr(data.error || 'Remove failed'); return }
      setUsers(prev => prev.filter(x => x.id !== u.id))
    } catch {
      setRowErr('Remove failed — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <SectionLabel>Tenant Users</SectionLabel>
        {isPartnerAdmin && !showInvite ? (
          <button onClick={() => { setShowInvite(true); setTempPassword(null); setErr('') }}
            style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, padding: '7px 14px', cursor: 'pointer' }}>
            + Invite client user
          </button>
        ) : null}
      </div>

      {tempPassword ? (
        <div style={{ background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.3)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', margin: '0 0 8px' }}>
            Temporary password generated. Share it with the client — they'll be asked to set a new password on first sign-in.
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--rb-text-muted)', margin: 0 }}>
            Temporary password: <code style={{ background: 'var(--rb-code)', padding: '2px 6px', borderRadius: 4, color: 'var(--rb-text-bright)' }}>{tempPassword}</code>
          </p>
        </div>
      ) : null}

      {showInvite ? (
        <div style={{ background: 'var(--rb-surface-2)', border: '1px solid var(--rb-border)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input ref={nameRef} style={inputStyle} placeholder="Client contact name" />
            </div>
            <div>
              <label style={labelStyle}>Role</label>
              <select ref={roleRef} defaultValue="tenant_admin" style={inputStyle}>
                <option value="tenant_admin">Administrator</option>
                <option value="user">User</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Email</label>
            <input ref={emailRef} type="email" style={inputStyle} placeholder="client@company.com" />
          </div>
          {err ? <p style={{ color: 'var(--rb-danger)', fontFamily: 'var(--font-body)', fontSize: 12, margin: '0 0 10px' }}>{err}</p> : null}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowInvite(false); setErr('') }} style={{ background: 'none', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-text-muted)', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>
            <button onClick={submit} disabled={saving} style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, padding: '8px 20px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? 'Inviting…' : 'Send invite'}</button>
          </div>
        </div>
      ) : null}

      {rowErr ? <p style={{ color: 'var(--rb-danger)', fontFamily: 'var(--font-body)', fontSize: 12, margin: '0 0 10px' }}>{rowErr}</p> : null}

      {users.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: 0 }}>No users on this tenant yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Name','Email','Role','Status','Joined'].map(h => (
                <th key={h} style={{ padding: '6px 0', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', paddingRight: 24 }}>{h}</th>
              ))}
              {isPartnerAdmin ? <th style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const isActive = u.active !== false
              const isSelf = u.id === currentUserId
              const busy = busyId === u.id
              return (
                <tr key={u.id} style={{ borderTop: '1px solid var(--rb-border)', opacity: isActive ? 1 : 0.55 }}>
                  <td style={{ padding: '10px 0', paddingRight: 24, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)' }}>{u.name ?? u.firstName ?? '—'}</td>
                  <td style={{ padding: '10px 0', paddingRight: 24, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)' }}>{u.email}</td>
                  <td style={{ padding: '10px 0', paddingRight: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--rb-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{u.role.replace('tenant_','')}</td>
                  <td style={{ padding: '10px 0', paddingRight: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: isActive ? 'var(--rb-success)' : 'var(--rb-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{isActive ? 'Active' : 'Inactive'}</td>
                  <td style={{ padding: '10px 0', paddingRight: isPartnerAdmin ? 24 : 0, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text-muted)' }}>{fmtDate(u.createdAt)}</td>
                  {isPartnerAdmin ? (
                    <td style={{ padding: '10px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => resend(u)} disabled={busy}
                        style={{ background: 'none', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-text-muted)', fontFamily: 'var(--font-body)', fontSize: 12, padding: '4px 10px', marginLeft: 6, cursor: busy ? 'wait' : 'pointer' }}>Resend</button>
                      <button onClick={() => resetPw(u)} disabled={busy}
                        style={{ background: 'none', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-text-muted)', fontFamily: 'var(--font-body)', fontSize: 12, padding: '4px 10px', marginLeft: 6, cursor: busy ? 'wait' : 'pointer' }}>Reset pw</button>
                      <button onClick={() => setActive(u, !isActive)} disabled={busy || isSelf}
                        title={isSelf ? 'You cannot deactivate your own account' : ''}
                        style={{ background: 'none', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: isSelf ? 'var(--rb-text-muted)' : (isActive ? 'var(--rb-warning)' : 'var(--rb-success)'), fontFamily: 'var(--font-body)', fontSize: 12, padding: '4px 10px', marginLeft: 6, cursor: (busy || isSelf) ? 'not-allowed' : 'pointer', opacity: isSelf ? 0.5 : 1 }}>{isActive ? 'Deactivate' : 'Reactivate'}</button>
                      <button onClick={() => remove(u)} disabled={busy || isSelf}
                        title={isSelf ? 'You cannot remove your own account' : ''}
                        style={{ background: 'none', border: '1px solid var(--rb-danger-soft)', borderRadius: 6, color: 'var(--rb-danger)', fontFamily: 'var(--font-body)', fontSize: 12, padding: '4px 10px', marginLeft: 6, cursor: (busy || isSelf) ? 'not-allowed' : 'pointer', opacity: isSelf ? 0.5 : 1 }}>Remove</button>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function PartnerTenantPageInner() {
  const params = useParams()
  const { data: _session } = useSession()
  const tenantIsPartnerAdmin = (_session?.user as any)?.partnerRole === 'partner_admin'
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tenantId = params.id as string

  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)

  // Tab state lives in the URL (?tab=) so the browser Back button steps through tabs.
  const TABS = ['overview', 'requirements', 'users', 'settings', 'bcagent'] as const
  type TabKey = typeof TABS[number]
  const tabParam = searchParams.get('tab')
  const tab: TabKey = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as TabKey) : 'overview'

  // Seed a default ?tab=overview when none present (no spurious history entry)
  useEffect(() => {
    if (!searchParams.get('tab')) {
      router.replace(pathname + '?tab=overview', { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, pathname])

  function goTab(next: TabKey) {
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('tab', next)
    sp.delete('req') // leaving a tab clears any open requirement
    router.push(pathname + '?' + sp.toString(), { scroll: false })
  }

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
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--rb-text-muted)', letterSpacing: '0.1em' }}>LOADING</span>
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
          style={{ background: 'none', border: 'none', color: 'var(--rb-text-muted)', fontFamily: 'var(--font-body)', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          ← All Clients
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--rb-text-bright)', fontWeight: 400, margin: 0 }}>{tenant.name}</h1>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '3px 10px', borderRadius: 12,
            background: tenant.active ? 'rgba(35,134,54,0.2)' : 'rgba(139,148,158,0.15)',
            color: tenant.active ? 'var(--rb-success)' : 'var(--rb-text-muted)',
            border: '1px solid ' + (tenant.active ? 'rgba(63,185,80,0.3)' : 'rgba(139,148,158,0.3)'),
          }}>
            {tenant.active ? 'Active' : 'Inactive'}
          </span>
          {tenant.navProduct ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-accent)', background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.2)', borderRadius: 4, padding: '2px 8px', letterSpacing: '0.06em' }}>
              {tenant.navProduct}
            </span>
          ) : null}
        </div>
        {tenant.navVersion ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: '4px 0 0' }}>{tenant.navVersion}</p>
        ) : null}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--rb-border)', marginBottom: 24, display: 'flex' }}>
        <TabBtn label="Overview"     active={tab === 'overview'}     onClick={() => goTab('overview')} />
        <TabBtn label="Requirements" active={tab === 'requirements'} onClick={() => goTab('requirements')} />
        <TabBtn label="Users"        active={tab === 'users'}        onClick={() => goTab('users')} />
        <TabBtn label="Settings"     active={tab === 'settings'}     onClick={() => goTab('settings')} />
        <TabBtn label="BCAgent"      active={tab === 'bcagent'}      onClick={() => goTab('bcagent')} />
      </div>

      {/* Tab content */}
      {tab === 'overview' ? <OverviewTab tenant={tenant} /> : null}
      {tab === 'requirements' ? <RequirementsTab tenantId={tenantId} /> : null}
      {tab === 'users' ? (
        <ClientUsersTab tenantId={tenantId} initialUsers={tenant.users} isPartnerAdmin={tenantIsPartnerAdmin} currentUserId={(_session?.user as any)?.id ?? ''} />
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
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: 0 }}>
              To update connection settings or download the installer, use the BCAgent tab.
            </p>
          </div>
        </div>
      ) : null}
      {tab === 'bcagent' ? (
        <BCAgentTab tenant={tenant} onTunnelProvisioned={() => { fetch('/api/partner/tenants/' + tenantId).then(r => r.json()).then(d => { if (d) setTenant(d) }) }} />
      ) : null}
    </div>
  )
}
