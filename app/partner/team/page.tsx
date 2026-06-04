'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'

type TeamMember = {
  id: string
  role: string
  createdAt: string
  user: { id: string; email: string; name: string; firstName: string | null; lastName: string | null }
}

export default function PartnerTeam() {
  const { data: session } = useSession()
  const user = session?.user as any
  const isAdmin = user?.partnerRole === 'partner_admin'

  const [team, setTeam] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFirst, setInviteFirst] = useState('')
  const [inviteLast, setInviteLast] = useState('')
  const [inviteRole, setInviteRole] = useState<'partner_admin' | 'partner_developer'>('partner_developer')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')

  useEffect(() => {
    fetch('/api/partner/users')
      .then(r => r.ok ? r.json() : [])
      .then(data => setTeam(data))
      .finally(() => setLoading(false))
  }, [])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
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

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: '#F0F6FC', fontWeight: 400, margin: 0, marginBottom: 4 }}>
          Team
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#8B949E', margin: 0 }}>
          Manage who has access to this partner portal.
        </p>
      </div>

      {/* Invite form — admin only */}
      {isAdmin ? (
        <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, padding: '20px 24px', marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8B949E', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16 }}>
            Invite Team Member
          </div>
          <form onSubmit={handleInvite}>
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
                  required
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
                type="submit"
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
          </form>
        </div>
      ) : null}

      {/* Team member table */}
      <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #21262D' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: '#C9D1D9' }}>
            Team Members
          </span>
        </div>
        {loading ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#8B949E', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading...</div>
        ) : team.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 14, color: '#8B949E' }}>No team members yet.</div>
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
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8B949E' }}>
                        {m.role === 'partner_admin' ? 'Admin' : 'Developer'}
                      </span>
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
  )
}
