'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const BC_VERSIONS = [
  { value: 'BC25', label: 'Business Central 2025 (BC25)' },
  { value: 'BC24', label: 'Business Central 2024 Wave 2 (BC24)' },
  { value: 'BC23', label: 'Business Central 2024 Wave 1 (BC23)' },
  { value: 'BC22', label: 'Business Central 2023 Wave 2 (BC22)' },
  { value: 'BC21', label: 'Business Central 2023 Wave 1 (BC21)' },
  { value: 'BC20', label: 'Business Central 2022 Wave 2 (BC20)' },
  { value: 'BC19', label: 'Business Central 2022 Wave 1 (BC19)' },
  { value: 'BC18', label: 'Business Central 2021 Wave 2 (BC18)' },
  { value: 'BC17', label: 'Business Central 2021 Wave 1 (BC17)' },
  { value: 'BC16', label: 'Business Central 2020 Wave 2 (BC16)' },
  { value: 'BC15', label: 'Business Central 2020 Wave 1 (BC15)' },
  { value: 'BC14', label: 'Business Central 2019 Wave 1 (BC14)' },
]
const NAV_VERSIONS = [
  { value: 'NAV2018',   label: 'Microsoft NAV 2018' },
  { value: 'NAV2017',   label: 'Microsoft NAV 2017' },
  { value: 'NAV2016',   label: 'Microsoft NAV 2016' },
  { value: 'NAV2015',   label: 'Microsoft NAV 2015' },
  { value: 'NAV2013R2', label: 'Microsoft NAV 2013 R2' },
  { value: 'NAV2013',   label: 'Microsoft NAV 2013' },
  { value: 'NAV2009R2', label: 'Microsoft NAV 2009 R2' },
  { value: 'NAV2009',   label: 'Microsoft NAV 2009' },
]

// ── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--rb-inset)', border: '1px solid var(--rb-border-strong)', borderRadius: 6,
  color: 'var(--rb-text)', fontFamily: 'var(--font-body)', fontSize: 13,
  padding: '8px 12px', outline: 'none', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)',
  letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5,
}
const sectionHeadStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-accent)',
  letterSpacing: '0.14em', textTransform: 'uppercase',
  borderBottom: '1px solid var(--rb-border)', paddingBottom: 10, marginBottom: 20, marginTop: 0,
}
const hintStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--rb-text-muted)', marginTop: 4,
}

// ── Field component ───────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint ? <p style={hintStyle}>{hint}</p> : null}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AddClientPage() {
  const router = useRouter()
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [product, setProduct]   = useState<'BC' | 'NAV'>('BC')
  const [showTest, setShowTest] = useState(false)

  // Client details
  const nameRef       = useRef<HTMLInputElement>(null)
  const subdomainRef  = useRef<HTMLInputElement>(null)
  const versionRef    = useRef<HTMLSelectElement>(null)
  const lastCURef     = useRef<HTMLInputElement>(null)

  // Production environment
  const bcInstanceRef        = useRef<HTMLInputElement>(null)
  const bcCompanyRef         = useRef<HTMLInputElement>(null)
  const bcPortRef            = useRef<HTMLInputElement>(null)
  const agentPortRef         = useRef<HTMLInputElement>(null)
  const bcUsernameRef        = useRef<HTMLInputElement>(null)
  const bcPasswordRef        = useRef<HTMLInputElement>(null)
  const navDbServerRef       = useRef<HTMLInputElement>(null)
  const navDbNameRef         = useRef<HTMLInputElement>(null)
  const navServerInstanceRef = useRef<HTMLInputElement>(null)
  const navMgmtPortRef       = useRef<HTMLInputElement>(null)

  // Test environment
  const testNavDbServerRef       = useRef<HTMLInputElement>(null)
  const testNavDbNameRef         = useRef<HTMLInputElement>(null)
  const testNavServerInstanceRef = useRef<HTMLInputElement>(null)
  const testBcInstanceRef        = useRef<HTMLInputElement>(null)
  const testBcCompanyRef         = useRef<HTMLInputElement>(null)
  const testBcPortRef            = useRef<HTMLInputElement>(null)
  const testNavMgmtPortRef       = useRef<HTMLInputElement>(null)

  // Auto-generate subdomain from company name
  function handleNameBlur() {
    const name = nameRef.current?.value ?? ''
    if (subdomainRef.current && !subdomainRef.current.value) {
      subdomainRef.current.value = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
    }
  }

  async function handleSubmit() {
    const name      = nameRef.current?.value.trim() ?? ''
    const subdomain = subdomainRef.current?.value.trim() ?? ''
    if (!name || !subdomain) {
      setError('Company name and subdomain are required.')
      return
    }

    setSaving(true)
    setError('')

    const body: Record<string, any> = {
      name,
      tunnelSubdomain:    subdomain,
      navProduct:         product,
      navVersion:         versionRef.current?.value || null,
      lastCU:             lastCURef.current?.value.trim() || null,
      bcInstance:         bcInstanceRef.current?.value.trim() || null,
      bcCompany:          bcCompanyRef.current?.value.trim() || null,
      bcPort:             bcPortRef.current?.value ? parseInt(bcPortRef.current.value) : 7048,
      agentPort:          agentPortRef.current?.value ? parseInt(agentPortRef.current.value) : 9099,
      bcUsername:         bcUsernameRef.current?.value.trim() || null,
      bcPassword:         bcPasswordRef.current?.value || null,
      navDatabaseServer:  navDbServerRef.current?.value.trim() || null,
      navDatabaseName:    navDbNameRef.current?.value.trim() || null,
      navServerInstance:  navServerInstanceRef.current?.value.trim() || null,
      navManagementPort:  navMgmtPortRef.current?.value ? parseInt(navMgmtPortRef.current.value) : 7045,
    }

    if (showTest) {
      body.testNavDatabaseServer = testNavDbServerRef.current?.value.trim() || null
      body.testNavDatabaseName   = testNavDbNameRef.current?.value.trim() || null
      body.testNavServerInstance = testNavServerInstanceRef.current?.value.trim() || null
      body.testBcInstance        = testBcInstanceRef.current?.value.trim() || null
      body.testBcCompany         = testBcCompanyRef.current?.value.trim() || null
      body.testBcPort            = testBcPortRef.current?.value ? parseInt(testBcPortRef.current.value) : null
      body.testNavManagementPort = testNavMgmtPortRef.current?.value ? parseInt(testNavMgmtPortRef.current.value) : 7045
    }

    try {
      const res = await fetch('/api/partner/tenants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create client.')
        return
      }
      router.push('/partner/tenants/' + data.id)
    } finally {
      setSaving(false)
    }
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--rb-surface)', border: '1px solid var(--rb-border)', borderRadius: 8, padding: '24px 28px', marginBottom: 16,
  }
  const gridTwo: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }
  const gridThree: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }

  return (
    <div style={{ maxWidth: 820 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <button
          onClick={() => router.push('/partner/dashboard')}
          style={{ background: 'none', border: 'none', color: 'var(--rb-text-muted)', fontFamily: 'var(--font-body)', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}
        >
          ← All Clients
        </button>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--rb-text-bright)', fontWeight: 400, margin: 0 }}>
          Add Client
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: '6px 0 0' }}>
          Create a new client tenant. The BCAgent tunnel is provisioned automatically on the first installer download.
        </p>
      </div>

      {/* ── Section 1: Client details ── */}
      <div style={cardStyle}>
        <p style={sectionHeadStyle}>Client Details</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="rb-grid-2" style={gridTwo}>
            <Field label="Company Name">
              <input ref={nameRef} style={inputStyle} placeholder="Acme Distribution Ltd" onBlur={handleNameBlur} />
            </Field>
            <Field label="Subdomain" hint="Used for the BCAgent tunnel URL. Lowercase letters and numbers only.">
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <input
                  ref={subdomainRef}
                  style={{ ...inputStyle, borderRadius: '6px 0 0 6px', borderRight: 'none' }}
                  placeholder="acmedist"
                  onChange={e => { if (subdomainRef.current) subdomainRef.current.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }}
                />
                <span style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border-strong)', borderLeft: 'none', borderRadius: '0 6px 6px 0', padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--rb-text-muted)', whiteSpace: 'nowrap' }}>
                  -agent.bespoxai.com
                </span>
              </div>
            </Field>
          </div>

          {/* Product toggle */}
          <div>
            <label style={labelStyle}>Product</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['BC', 'NAV'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setProduct(p)}
                  style={{
                    background: product === p ? 'rgba(88,166,255,0.15)' : 'var(--rb-bg)',
                    border: '1px solid ' + (product === p ? 'var(--rb-accent)' : 'var(--rb-border-strong)'),
                    borderRadius: 6, color: product === p ? 'var(--rb-accent)' : 'var(--rb-text-muted)',
                    fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em',
                    padding: '7px 20px', cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {p === 'BC' ? 'Business Central' : 'Microsoft NAV'}
                </button>
              ))}
            </div>
          </div>

          <div className="rb-grid-2" style={gridTwo}>
            <Field label="Version">
              <select ref={versionRef} style={inputStyle}>
                <option value="">Select version</option>
                {product === 'BC' ? (
                  BC_VERSIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)
                ) : (
                  NAV_VERSIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)
                )}
              </select>
            </Field>
            <Field label="Last CU (optional)" hint="e.g. CU3">
              <input ref={lastCURef} style={inputStyle} placeholder="CU3" />
            </Field>
          </div>
        </div>
      </div>

      {/* ── Section 2: Production environment ── */}
      <div style={cardStyle}>
        <p style={sectionHeadStyle}>Production Environment</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="rb-grid-2" style={gridTwo}>
            <Field label="BC Instance Name" hint="e.g. BC_Prod or DynamicsNAV">
              <input ref={bcInstanceRef} style={inputStyle} placeholder="BC_Prod" />
            </Field>
            <Field label="BC Company" hint="Company name as it appears in BC">
              <input ref={bcCompanyRef} style={inputStyle} placeholder="ACME" />
            </Field>
          </div>
          <div className="rb-grid-2" style={gridTwo}>
            <Field label="BC Service Account Username" hint="DOMAIN\username or .\localuser — stored, used in installer">
              <input ref={bcUsernameRef} style={inputStyle} placeholder="DOMAIN\BCServiceAccount" autoComplete="off" />
            </Field>
            <Field label="BC Service Account Password" hint="Baked into installer only — never stored. You will re-enter this at installer download.">
              <input ref={bcPasswordRef} style={{ ...inputStyle }} type="password" placeholder="••••••••" autoComplete="new-password" />
            </Field>
          </div>
          <div className="rb-grid-3" style={gridThree}>
            <Field label="SQL Server / Host" hint="e.g. localhost or 10.0.0.5">
              <input ref={navDbServerRef} style={inputStyle} placeholder="localhost" />
            </Field>
            <Field label="NAV Database Name">
              <input ref={navDbNameRef} style={inputStyle} placeholder="CRONUS_NZ" />
            </Field>
            <Field label="NAV Server Instance" hint="Optional">
              <input ref={navServerInstanceRef} style={inputStyle} placeholder="DynamicsNAV" />
            </Field>
          </div>
          <div className="rb-grid-3" style={gridThree}>
            <Field label="OData Port" hint="Default: 7048">
              <input ref={bcPortRef} style={inputStyle} placeholder="7048" defaultValue="7048" />
            </Field>
            <Field label="Agent Port" hint="Default: 9099">
              <input ref={agentPortRef} style={inputStyle} placeholder="9099" defaultValue="9099" />
            </Field>
            <Field label="Management Port" hint="Default: 7045">
              <input ref={navMgmtPortRef} style={inputStyle} placeholder="7045" defaultValue="7045" />
            </Field>
          </div>
        </div>
      </div>

      {/* ── Section 3: Test environment (toggle) ── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showTest ? 20 : 0 }}>
          <p style={{ ...sectionHeadStyle, margin: 0, borderBottom: 'none', paddingBottom: 0 }}>Test Environment</p>
          <button
            onClick={() => setShowTest(!showTest)}
            style={{
              background: showTest ? 'rgba(88,166,255,0.1)' : 'none',
              border: '1px solid ' + (showTest ? 'var(--rb-accent)' : 'var(--rb-border-strong)'),
              borderRadius: 6, color: showTest ? 'var(--rb-accent)' : 'var(--rb-text-muted)',
              fontFamily: 'var(--font-body)', fontSize: 12,
              padding: '5px 14px', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {showTest ? 'Remove test environment' : '+ Add test environment'}
          </button>
        </div>

        {showTest ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="rb-grid-2" style={gridTwo}>
              <Field label="Test BC Instance">
                <input ref={testBcInstanceRef} style={inputStyle} placeholder="BC_Test" />
              </Field>
              <Field label="Test BC Company">
                <input ref={testBcCompanyRef} style={inputStyle} placeholder="ACME_TEST" />
              </Field>
            </div>
            <div className="rb-grid-3" style={gridThree}>
              <Field label="Test SQL Server / Host">
                <input ref={testNavDbServerRef} style={inputStyle} placeholder="localhost" />
              </Field>
              <Field label="Test NAV Database">
                <input ref={testNavDbNameRef} style={inputStyle} placeholder="CRONUS_NZ_TEST" />
              </Field>
              <Field label="Test NAV Server Instance" hint="Optional">
                <input ref={testNavServerInstanceRef} style={inputStyle} placeholder="DynamicsNAV_Test" />
              </Field>
            </div>
            <div className="rb-grid-3" style={gridThree}>
              <Field label="Test OData Port" hint="Default: 7048">
                <input ref={testBcPortRef} style={inputStyle} placeholder="7048" />
              </Field>
              <Field label="Test Management Port" hint="Default: 7045">
                <input ref={testNavMgmtPortRef} style={inputStyle} placeholder="7045" defaultValue="7045" />
              </Field>
            </div>
          </div>
        ) : (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: '12px 0 0' }}>
            Add test environment details if this client has a separate test BC/NAV instance.
          </p>
        )}
      </div>

      {/* ── Actions ── */}
      {error ? (
        <p style={{ color: 'var(--rb-danger)', fontFamily: 'var(--font-body)', fontSize: 13, margin: '0 0 16px' }}>{error}</p>
      ) : null}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button
          onClick={() => router.push('/partner/dashboard')}
          style={{ background: 'none', border: '1px solid var(--rb-border-strong)', borderRadius: 6, color: 'var(--rb-text-muted)', fontFamily: 'var(--font-body)', fontSize: 14, padding: '10px 20px', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, padding: '10px 28px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Creating client…' : 'Create Client'}
        </button>
      </div>
    </div>
  )
}
