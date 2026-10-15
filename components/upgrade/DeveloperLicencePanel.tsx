'use client'

/**
 * Upload / replace / remove the developer licence used for full object exports.
 * The file is never shown or downloadable again — only its name and dates.
 */

import { useEffect, useRef, useState } from 'react'
import { PALETTES, labelStyle, inputStyle, buttonStyle, noteStyle, type PanelVariant, type Palette } from './palette'

interface LicenceInfo {
  fileName: string
  sizeBytes: number
  expiresAt: string | null
  uploadedAt: string
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function LicenceSummary({ p, licence }: { p: Palette; licence: LicenceInfo }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
      <div>
        <span style={labelStyle(p)}>File</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: p.text }}>{licence.fileName}</span>
      </div>
      <div>
        <span style={labelStyle(p)}>Uploaded</span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: p.text }}>{fmtDate(licence.uploadedAt)}</span>
      </div>
      <div>
        <span style={labelStyle(p)}>Expires</span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: p.text }}>{licence.expiresAt ? fmtDate(licence.expiresAt) : 'Not set'}</span>
      </div>
    </div>
  )
}

export default function DeveloperLicencePanel({ apiUrl, canEdit, variant, ownerLabel }: {
  apiUrl: string
  canEdit: boolean
  variant: PanelVariant
  ownerLabel: string
}) {
  const p = PALETTES[variant]
  const fileRef = useRef<HTMLInputElement>(null)
  const expiryRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  const [licence, setLicence] = useState<LicenceInfo | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [keyConfigured, setKeyConfigured] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(apiUrl)
      const d = await r.json()
      if (r.ok) {
        setLicence(d.licence ?? null)
        setProblem(d.licence ? d.problem ?? null : null)
        setKeyConfigured(d.keyConfigured !== false)
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [apiUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) { setMsg({ tone: 'danger', text: 'Choose a .flf licence file first.' }); return }
    setBusy(true); setMsg(null)
    const fd = new FormData()
    fd.append('file', file)
    const exp = expiryRef.current?.value
    if (exp) fd.append('expiresAt', exp)
    try {
      const r = await fetch(apiUrl, { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) setMsg({ tone: 'danger', text: d.error ?? 'Upload failed' })
      else {
        setMsg({ tone: 'success', text: 'Licence saved.' })
        if (fileRef.current) fileRef.current.value = ''
        await load()
      }
    } catch { setMsg({ tone: 'danger', text: 'Network error' }) }
    setBusy(false)
  }

  async function remove() {
    if (!confirmRemove) { setConfirmRemove(true); return }
    setBusy(true); setMsg(null); setConfirmRemove(false)
    try {
      const r = await fetch(apiUrl, { method: 'DELETE' })
      if (r.ok) { setMsg({ tone: 'success', text: 'Licence removed.' }); await load() }
      else setMsg({ tone: 'danger', text: 'Could not remove the licence.' })
    } catch { setMsg({ tone: 'danger', text: 'Network error' }) }
    setBusy(false)
  }

  return (
    <div>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: p.muted, margin: '0 0 14px' }}>
        {'Full object exports for upgrade readiness run under ' + ownerLabel + '\'s developer licence. During an export it is applied to the customer\'s database only, then the customer\'s own licence is restored. It is stored encrypted and can\'t be downloaded again.'}
      </p>

      {!keyConfigured ? (
        <div style={{ ...noteStyle(p, 'warning'), marginBottom: 14 }}>
          Licence storage isn't configured on the server yet (LICENCE_ENCRYPTION_KEY). Uploads will fail until it is set.
        </div>
      ) : null}

      {loading ? (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: p.muted }}>Loading…</p>
      ) : licence ? (
        <LicenceSummary p={p} licence={licence} />
      ) : (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: p.text, margin: '0 0 14px' }}>No licence uploaded.</p>
      )}

      {problem ? <div style={{ ...noteStyle(p, 'danger'), marginBottom: 14 }}>{problem}</div> : null}

      {canEdit ? (
        <form onSubmit={upload}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle(p)}>{licence ? 'Replace licence (.flf)' : 'Licence file (.flf)'}</label>
              <input ref={fileRef} type="file" accept=".flf,.bclicense" style={inputStyle(p)} />
            </div>
            <div>
              <label style={labelStyle(p)}>Expiry date (optional)</label>
              <input ref={expiryRef} type="date" defaultValue="" style={inputStyle(p)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="submit" disabled={busy} style={buttonStyle(p, 'primary', busy)}>{busy ? 'Saving…' : licence ? 'Replace licence' : 'Upload licence'}</button>
            {licence ? (
              <button type="button" disabled={busy} onClick={remove} style={buttonStyle(p, 'danger', busy)}>
                {confirmRemove ? 'Click again to remove' : 'Remove'}
              </button>
            ) : null}
            {msg ? <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: msg.tone === 'success' ? p.success : p.danger }}>{msg.text}</span> : null}
          </div>
        </form>
      ) : (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: p.muted, margin: 0 }}>Only admins can upload or replace the licence.</p>
      )}
    </div>
  )
}
