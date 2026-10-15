/**
 * Colours for the upgrade-readiness panels. Partner surfaces use the semantic
 * --rb-* variables only (CLAUDE.md); the admin portal uses its own tokens.
 */

export type PanelVariant = 'admin' | 'partner'

export interface Palette {
  text: string
  muted: string
  border: string
  surface: string
  inset: string
  primary: string
  primaryText: string
  danger: string
  warning: string
  success: string
  accent: string
}

export const PALETTES: Record<PanelVariant, Palette> = {
  admin: {
    text: 'var(--ink)', muted: 'var(--slate)', border: 'var(--fog)', surface: 'var(--white)',
    inset: 'var(--cream)', primary: 'var(--forest)', primaryText: 'var(--white)',
    danger: 'var(--rb-danger, #b42318)', warning: 'var(--rb-warning, #b54708)', success: 'var(--rb-success, #027a48)',
    accent: 'var(--amber)',
  },
  partner: {
    text: 'var(--rb-text)', muted: 'var(--rb-text-muted)', border: 'var(--rb-border)', surface: 'var(--rb-surface)',
    inset: 'var(--rb-inset)', primary: 'var(--rb-primary)', primaryText: 'var(--rb-text-bright)',
    danger: 'var(--rb-danger)', warning: 'var(--rb-warning)', success: 'var(--rb-success)',
    accent: 'var(--rb-accent)',
  },
}

export function labelStyle(p: Palette): React.CSSProperties {
  return { display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, color: p.muted, marginBottom: 4 }
}

export function inputStyle(p: Palette): React.CSSProperties {
  return {
    width: '100%', background: p.inset, border: '1px solid ' + p.border, borderRadius: 6, color: p.text,
    fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 10px', boxSizing: 'border-box',
  }
}

export function buttonStyle(p: Palette, kind: 'primary' | 'ghost' | 'danger', disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: 6, padding: '7px 14px', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  }
  if (kind === 'primary') return { ...base, background: p.primary, color: p.primaryText, border: 'none' }
  if (kind === 'danger') return { ...base, background: 'transparent', color: p.danger, border: '1px solid ' + p.danger }
  return { ...base, background: 'transparent', color: p.text, border: '1px solid ' + p.border }
}

export function noteStyle(p: Palette, tone: 'info' | 'warning' | 'danger' | 'success'): React.CSSProperties {
  const c = tone === 'danger' ? p.danger : tone === 'warning' ? p.warning : tone === 'success' ? p.success : p.accent
  return {
    border: '1px solid ' + c, borderLeftWidth: 3, borderRadius: 6, padding: '10px 12px',
    fontFamily: 'var(--font-body)', fontSize: 13, color: p.text, background: 'transparent',
  }
}
