'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

type Tenant = {
  id: string
  name: string
  tunnelSubdomain: string
  tunnelId: string | null
  active: boolean
}

type PartnerAccount = {
  id: string
  name: string
  slug: string
  brandName: string | null
  _count: { tenants: number; users: number }
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      background: 'var(--rb-surface)',
      border: '1px solid var(--rb-border)',
      borderRadius: 8,
      padding: '20px 24px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--rb-text-bright)', lineHeight: 1 }}>
        {value}
      </div>
      {sub ? (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text-muted)', marginTop: 4 }}>{sub}</div>
      ) : null}
    </div>
  )
}

export default function PartnerDashboard() {
  const { data: session } = useSession()
  const router = useRouter()
  const [account, setAccount] = useState<PartnerAccount | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)

  const user = session?.user as any
  const isAdmin = user?.partnerRole === 'partner_admin'

  useEffect(() => {
    async function load() {
      try {
        const [accRes, tenantsRes] = await Promise.all([
          fetch('/api/partner/account'),
          fetch('/api/partner/tenants'),
        ])
        if (accRes.ok) setAccount(await accRes.json())
        if (tenantsRes.ok) setTenants(await tenantsRes.json())
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const displayName = user?.preferredName ?? user?.firstName ?? ''
  const activeCount = tenants.filter(t => t.active).length

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          color: 'var(--rb-text-bright)',
          fontWeight: 400,
          margin: 0,
          marginBottom: 4,
        }}>
          {'Welcome back' + (displayName ? ', ' + displayName : '')}
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--rb-text-muted)', margin: 0 }}>
          {account ? account.name + ' Partner Portal' : 'Partner Portal'}
        </p>
      </div>

      {/* Summary cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
        marginBottom: 40,
      }}>
        <StatCard label="Client Tenants" value={loading ? '—' : tenants.length} sub={activeCount + ' active'} />
        <StatCard label="Team Members" value={loading ? '—' : (account?._count.users ?? '—')} />
      </div>

      {/* Tenant table */}
      <div style={{
        background: 'var(--rb-surface)',
        border: '1px solid var(--rb-border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        {/* Table header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--rb-border)',
        }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--rb-text)' }}>
            Client Tenants
          </span>
          {isAdmin ? (
            <button
              onClick={() => router.push('/partner/tenants/new')}
              style={{
                background: 'var(--rb-primary)',
                border: 'none',
                borderRadius: 6,
                color: '#ffffff',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 600,
                padding: '6px 14px',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--rb-primary-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--rb-primary)' }}
            >
              + Add Client
            </button>
          ) : null}
        </div>

        {loading ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--rb-text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            Loading...
          </div>
        ) : tenants.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--rb-text-muted)', marginBottom: 8 }}>
              No client tenants yet
            </div>
            {isAdmin ? (
              <button
                onClick={() => router.push('/partner/tenants/new')}
                style={{
                  background: 'none',
                  border: '1px solid var(--rb-border-strong)',
                  borderRadius: 6,
                  color: 'var(--rb-accent)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  padding: '8px 16px',
                  cursor: 'pointer',
                }}
              >
                Add your first client
              </button>
            ) : null}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rb-border)' }}>
                {['Client', 'Subdomain', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{
                    padding: '10px 20px',
                    textAlign: 'left',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--rb-text-muted)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontWeight: 500,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant, i) => (
                <tr
                  key={tenant.id}
                  style={{
                    borderBottom: i < tenants.length - 1 ? '1px solid var(--rb-border)' : 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--rb-surface-2)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ padding: '12px 20px', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--rb-text)', fontWeight: 500 }}>
                    {tenant.name}
                  </td>
                  <td style={{ padding: '12px 20px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--rb-text-muted)' }}>
                    {tenant.tunnelSubdomain}
                  </td>
                  <td style={{ padding: '12px 20px' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        background: tenant.active ? 'rgba(35,134,54,0.2)' : 'rgba(139,148,158,0.15)',
                        color: tenant.active ? 'var(--rb-success)' : 'var(--rb-text-muted)',
                        border: '1px solid ' + (tenant.active ? 'rgba(63,185,80,0.3)' : 'rgba(139,148,158,0.3)'),
                      }}>
                        {tenant.active ? 'Active' : 'Inactive'}
                      </span>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        background: tenant.tunnelId ? 'rgba(56,139,253,0.15)' : 'rgba(139,148,158,0.1)',
                        color: tenant.tunnelId ? 'var(--rb-accent)' : 'var(--rb-text-muted)',
                        border: '1px solid ' + (tenant.tunnelId ? 'rgba(56,139,253,0.35)' : 'rgba(139,148,158,0.25)'),
                      }}>
                        {tenant.tunnelId ? 'Connected' : 'Not Connected'}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 20px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => router.push('/partner/tenants/' + tenant.id)}
                        style={{
                          background: 'none',
                          border: '1px solid var(--rb-border-strong)',
                          borderRadius: 4,
                          color: 'var(--rb-accent)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          padding: '4px 10px',
                          cursor: 'pointer',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--rb-accent)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--rb-border-strong)' }}
                      >
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
