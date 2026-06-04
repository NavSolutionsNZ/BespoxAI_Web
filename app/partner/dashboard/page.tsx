'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

type Tenant = {
  id: string
  name: string
  tunnelSubdomain: string
  active: boolean
}

type PartnerAccount = {
  id: string
  name: string
  slug: string
  paymentMode: string
  isWhiteLabel: boolean
  brandName: string | null
  _count: { tenants: number; users: number }
}

type TeamMember = {
  id: string
  role: string
  createdAt: string
  user: { id: string; email: string; name: string; firstName: string | null; lastName: string | null }
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      background: '#161B22',
      border: '1px solid #21262D',
      borderRadius: 8,
      padding: '20px 24px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: '#F0F6FC', lineHeight: 1 }}>
        {value}
      </div>
      {sub ? (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#8B949E', marginTop: 4 }}>{sub}</div>
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
  const [tab, setTab] = useState<'clients' | 'team'>('clients')
  const [team, setTeam] = useState<TeamMember[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFirst, setInviteFirst] = useState('')
  const [inviteLast, setInviteLast] = useState('')
  const [inviteRole, setInviteRole] = useState<'partner_admin' | 'partner_developer'>('partner_developer')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')

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

  useEffect(() => {
    if (tab !== 'team') return
    setTeamLoading(true)
    fetch('/api/partner/users')
      .then(r => r.ok ? r.json() : [])
      .then(data => setTeam(data))
      .finally(() => setTeamLoading(false))
  }, [tab])

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteError('')
    setInviteSuccess('')
    try {
      const res = await fetch('/api/partner/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), firstName: inviteFirst.trim(), lastName: inviteLast.trim(), role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) { setInviteError(data.error ?? 'Invite failed'); return }
      setInviteSuccess('Invitation sent to ' + inviteEmail.trim())
      setInviteEmail('')
      setInviteFirst('')
      setInviteLast('')
      fetch('/api/partner/users').then(r => r.ok ? r.json() : []).then(setTeam)
    } catch { setInviteError('Network error') }
    finally { setInviting(false) }
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm('Remove this team member?')) return
    const res = await fetch('/api/partner/users/' + memberId, { method: 'DELETE' })
    if (res.ok) setTeam(prev => prev.filter(m => m.id !== memberId))
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    const res = await fetch('/api/partner/users/' + memberId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    if (res.ok) setTeam(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m))
  }

  const displayName = user?.preferredName ?? user?.firstName ?? ''
  const activeCount = tenants.filter(t => t.active).length

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          color: '#F0F6FC',
          fontWeight: 400,
          margin: 0,
          marginBottom: 4,
        }}>
          {'Welcome back' + (displayName ? ', ' + displayName : '')}
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#8B949E', margin: 0 }}>
          {account ? account.name + ' Partner Portal' : 'Partner Portal'}
        </p>
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid #21262D' }}>
        {(['clients', 'team'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #58A6FF' : '2px solid transparent',
              color: tab === t ? '#F0F6FC' : '#8B949E',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              padding: '8px 16px',
              cursor: 'pointer',
              textTransform: 'capitalize',
              marginBottom: -1,
              transition: 'color 0.15s',
            }}
          >
            {t === 'clients' ? 'Clients' : 'Team'}
          </button>
        ))}
      </div>

      {tab === 'clients' ? (
        <div>
          {/* Summary cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 16,
            marginBottom: 40,
          }}>
            <StatCard label="Client Tenants" value={loading ? '\u2014' : tenants.length} sub={activeCount + ' active'} />
            <StatCard label="Team Members" value={loading ? '\u2014' : (account?._count.users ?? '\u2014')} />
            <StatCard label="Payment Mode" value={loading ? '\u2014' : (account?.paymentMode === 'partner_collected' ? 'Self-managed' : 'BespoxAI')} sub="billing" />
            <StatCard label="Portal" value={account?.isWhiteLabel ? 'White Label' : 'BespoxAI Branded'} />
          </div>

          {/* Tenant table */}
          <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #21262D' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: '#C9D1D9' }}>
                Client Tenants
              </span>
              {isAdmin ? (
                <button
                  onClick={() => router.push('/partner/tenants/new')}
                  style={{ background: '#238636', border: 'none', borderRadius: 6, color: '#ffffff', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, padding: '6px 14px', cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#2EA043' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#238636' }}
                >
                  + Add Client
                </button>
              ) : null}
            </div>

            {loading ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#8B949E', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading...</div>
            ) : tenants.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#8B949E', marginBottom: 8 }}>No client tenants yet</div>
                {isAdmin ? (
                  <button
                    onClick={() => router.push('/partner/tenants/new')}
                    style={{ background: 'none', border: '1px solid #30363D', borderRadius: 6, color: '#58A6FF', fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 16px', cursor: 'pointer' }}
                  >
                    Add your first client
                  </button>
                ) : null}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #21262D' }}>
                    {['Client', 'Subdomain', 'Status', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant, i) => (
                    <tr
                      key={tenant.id}
                      style={{ borderBottom: i < tenants.length - 1 ? '1px solid #21262D' : 'none', transition: 'background 0.1s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1C2128' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ padding: '12px 20px', fontFamily: 'var(--font-body)', fontSize: 14, color: '#C9D1D9', fontWeight: 500 }}>{tenant.name}</td>
                      <td style={{ padding: '12px 20px', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#8B949E' }}>{tenant.tunnelSubdomain}</td>
                      <td style={{ padding: '12px 20px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          background: tenant.active ? 'rgba(35,134,54,0.2)' : 'rgba(139,148,158,0.15)',
                          color: tenant.active ? '#3FB950' : '#8B949E',
                          border: '1px solid ' + (tenant.active ? 'rgba(63,185,80,0.3)' : 'rgba(139,148,158,0.3)'),
                        }}>
                          {tenant.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 20px' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => router.push('/partner/tenants/' + tenant.id)}
                            style={{ background: 'none', border: '1px solid #30363D', borderRadius: 4, color: '#58A6FF', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px', cursor: 'pointer', transition: 'border-color 0.15s' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#58A6FF' }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363D' }}
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
      ) : (
        <div>
          {/* Invite form — admin only */}
          {isAdmin ? (
            <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, padding: '20px 24px', marginBottom: 24 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16 }}>
                Invite Team Member
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: 10, alignItems: 'end' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#8B949E', marginBottom: 4 }}>First name</div>
                  <input
                    value={inviteFirst}
                    onChange={e => setInviteFirst(e.target.value)}
                    placeholder="First"
                    style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 10px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#8B949E', marginBottom: 4 }}>Last name</div>
                  <input
                    value={inviteLast}
                    onChange={e => setInviteLast(e.target.value)}
                    placeholder="Last"
                    style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 10px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#8B949E', marginBottom: 4 }}>Email</div>
                  <input
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="email@company.com"
                    type="email"
                    style={{ width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 10px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#8B949E', marginBottom: 4 }}>Role</div>
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as any)}
                    style={{ background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#C9D1D9', fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 10px', cursor: 'pointer' }}
                  >
                    <option value="partner_developer">Developer</option>
                    <option value="partner_admin">Admin</option>
                  </select>
                </div>
                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  style={{ background: inviting ? '#21262D' : '#238636', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, padding: '7px 16px', cursor: inviting ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
                >
                  {inviting ? 'Sending...' : 'Send invite'}
                </button>
              </div>
              {inviteError ? (
                <div style={{ marginTop: 10, fontFamily: 'var(--font-body)', fontSize: 12, color: '#F85149' }}>{inviteError}</div>
              ) : null}
              {inviteSuccess ? (
                <div style={{ marginTop: 10, fontFamily: 'var(--font-body)', fontSize: 12, color: '#3FB950' }}>{inviteSuccess}</div>
              ) : null}
            </div>
          ) : null}

          {/* Team member table */}
          <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #21262D' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: '#C9D1D9' }}>Team Members</span>
            </div>
            {teamLoading ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#8B949E', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading...</div>
            ) : team.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 14, color: '#8B949E' }}>No team members yet</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #21262D' }}>
                    {(['Name', 'Email', 'Role', 'Joined'] as string[]).concat(isAdmin ? ['Actions'] : []).map(h => (
                      <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {team.map((m, i) => (
                    <tr key={m.id} style={{ borderBottom: i < team.length - 1 ? '1px solid #21262D' : 'none' }}>
                      <td style={{ padding: '12px 20px', fontFamily: 'var(--font-body)', fontSize: 14, color: '#C9D1D9', fontWeight: 500 }}>{m.user.name}</td>
                      <td style={{ padding: '12px 20px', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#8B949E' }}>{m.user.email}</td>
                      <td style={{ padding: '12px 20px' }}>
                        {isAdmin ? (
                          <select
                            value={m.role}
                            onChange={e => handleRoleChange(m.id, e.target.value)}
                            style={{ background: '#0D1117', border: '1px solid #30363D', borderRadius: 4, color: '#C9D1D9', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}
                          >
                            <option value="partner_developer">Developer</option>
                            <option value="partner_admin">Admin</option>
                          </select>
                        ) : (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8B949E' }}>{m.role === 'partner_admin' ? 'Admin' : 'Developer'}</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 20px', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8B949E' }}>
                        {new Date(m.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      {isAdmin ? (
                        <td style={{ padding: '12px 20px' }}>
                          <button
                            onClick={() => handleRemoveMember(m.id)}
                            style={{ background: 'none', border: '1px solid #30363D', borderRadius: 4, color: '#F85149', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px', cursor: 'pointer' }}
                          >
                            Remove
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
