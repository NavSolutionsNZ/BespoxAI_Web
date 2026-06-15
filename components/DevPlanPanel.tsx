'use client'

import React from 'react'

// ── Shared Dev Plan panel ────────────────────────────────────────────────────
// Theme-agnostic: references only --rb-* CSS variables, so each surface controls
// the palette by setting data-rb-theme on an ancestor. Used by both the partner
// requirement detail view and the BespoxAI admin requirement view.
//
// showPricing gates BespoxAI-internal commercial guidance (day rate, suggested
// quote, quoting notes). Partners are the quoter for their own clients but must
// not see BespoxAI's suggested pricing — they see hours/days only.

export type DevPlanData = Record<string, any>

export function DevPlanPanel({
  data,
  generating,
  error,
  onGenerate,
  collapsed,
  onToggle,
  showPricing = false,
  emptyHint,
}: {
  data: DevPlanData | null
  generating: boolean
  error?: string
  onGenerate: () => void
  collapsed: boolean
  onToggle: () => void
  showPricing?: boolean
  emptyHint?: string
}) {
  const label = (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
      Internal Dev Plan
    </span>
  )

  const sub = (txt: string) => (
    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rb-text-muted)', marginBottom: 5, marginTop: 0 }}>{txt}</p>
  )

  return (
    <div style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)', borderRadius: 8, padding: '20px 24px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed ? 0 : 12, gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {label}
          {data && data.totalEstimatedHours ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-success)' }}>
              {data.totalEstimatedHours}h · {data.tasks?.length ?? 0} tasks
            </span>
          ) : null}
          {data ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: data._bcConnected ? 'var(--rb-success)' : 'var(--rb-text-muted)', letterSpacing: '0.06em' }}>
              {data._bcConnected ? ('🔌 BC live · ' + (data._introspectedTables ?? []).join(', ')) : 'standard BC schema'}
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={onGenerate}
            disabled={generating}
            style={{ background: 'none', border: 'none', cursor: generating ? 'not-allowed' : 'pointer', color: 'var(--rb-accent)', fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}
          >
            {generating ? '✦ Generating…' : data ? '↺ Regenerate' : '✦ Generate Dev Plan'}
          </button>
          <button onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--rb-text-muted)', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center' }}>
            {collapsed ? '▾' : '▴'}
          </button>
        </div>
      </div>

      <div style={{ overflow: 'hidden', maxHeight: collapsed ? 0 : '99999px', transition: 'max-height 0.25s ease' }}>
        {error ? <p style={{ color: 'var(--rb-danger)', fontSize: 12, marginBottom: 8 }}>{error}</p> : null}
        {!data && !generating ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text-muted)', margin: 0 }}>
            {emptyHint ?? 'Generate an internal development plan with code snippets, task breakdown, hours, and risks. If the BC instance is connected, live field inspection is included.'}
          </p>
        ) : null}

        {data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.summary ? (
              <div>
                {sub('Summary')}
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', lineHeight: 1.65, margin: 0 }}>{data.summary}</p>
              </div>
            ) : null}

            {data._bcConnected && (data.existingFieldsFound?.length > 0 || data.missingFieldsAdded?.length > 0) ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {data.existingFieldsFound?.length > 0 ? (
                  <div style={{ flex: '1 1 200px', background: 'var(--rb-accent-soft)', border: '1px solid var(--rb-border)', borderRadius: 6, padding: '10px 12px' }}>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rb-success)', marginBottom: 6, marginTop: 0 }}>✓ Already in BC — no action</p>
                    <ul style={{ margin: 0, paddingLeft: 14 }}>
                      {data.existingFieldsFound.map((f: string, i: number) => <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text-muted)', lineHeight: 1.6 }}>{f}</li>)}
                    </ul>
                  </div>
                ) : null}
                {data.missingFieldsAdded?.length > 0 ? (
                  <div style={{ flex: '1 1 200px', background: 'var(--rb-warning-soft)', border: '1px solid var(--rb-border)', borderRadius: 6, padding: '10px 12px' }}>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rb-warning)', marginBottom: 6, marginTop: 0 }}>⚠ Missing — being added</p>
                    <ul style={{ margin: 0, paddingLeft: 14 }}>
                      {data.missingFieldsAdded.map((f: string, i: number) => <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text)', lineHeight: 1.6 }}>{f}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {data.approach ? (
              <div>
                {sub('Technical Approach')}
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--rb-text)', lineHeight: 1.65, margin: 0 }}>{data.approach}</p>
              </div>
            ) : null}

            {data.tasks?.length > 0 ? (
              <div>
                {sub('Tasks')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.tasks.map((task: any, i: number) => (
                    <div key={i} style={{ background: 'var(--rb-inset)', border: '1px solid var(--rb-border)', borderRadius: 6, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: task.description ? 5 : 0 }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--rb-text-bright)', lineHeight: 1.3, flex: 1 }}>{task.title}</span>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                          {task.phase ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 7, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rb-warning)', background: 'var(--rb-warning-soft)', border: '1px solid var(--rb-border)', padding: '2px 6px', borderRadius: 4 }}>{task.phase}</span> : null}
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-success)', fontWeight: 600 }}>{task.estimatedHours}h</span>
                        </div>
                      </div>
                      {task.description ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--rb-text-muted)', lineHeight: 1.55, margin: task.objects?.length ? '0 0 6px' : 0 }}>{task.description}</p> : null}
                      {task.objects?.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: task.codeSnippet ? 8 : 0 }}>
                          {task.objects.map((o: string, j: number) => <span key={j} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-text-muted)', background: 'var(--rb-surface)', border: '1px solid var(--rb-border)', borderRadius: 4, padding: '2px 6px' }}>{o}</span>)}
                        </div>
                      ) : null}
                      {task.codeSnippet ? (
                        <div style={{ marginTop: 8 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rb-success)' }}>{task.codeSnippet.filename}</span>
                          {task.codeSnippet.placement ? <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--rb-text-muted)', margin: '4px 0 5px', fontStyle: 'italic' }}>📍 {task.codeSnippet.placement}</p> : null}
                          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--rb-text)', background: 'var(--rb-code)', border: '1px solid var(--rb-border)', borderRadius: 5, padding: '10px 12px', overflowX: 'auto', margin: '4px 0 0', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{task.codeSnippet.code}</pre>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Effort summary — hours/days always; pricing only when showPricing */}
            {(data.totalEstimatedHours || (showPricing && data.suggestedDailyRate)) ? (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {data.totalEstimatedHours ? (
                  <div style={{ background: 'var(--rb-accent-soft)', border: '1px solid var(--rb-border)', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300, color: 'var(--rb-success)', lineHeight: 1 }}>{data.totalEstimatedHours}h</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rb-text-muted)', marginTop: 3 }}>Total Hours</div>
                  </div>
                ) : null}
                {data.totalEstimatedHours ? (
                  <div style={{ background: 'var(--rb-inset)', border: '1px solid var(--rb-border)', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300, color: 'var(--rb-text-bright)', lineHeight: 1 }}>{Math.ceil(data.totalEstimatedHours / 8)}d</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rb-text-muted)', marginTop: 3 }}>Est. Days</div>
                  </div>
                ) : null}
                {showPricing && data.suggestedDailyRate ? (
                  <div style={{ background: 'var(--rb-warning-soft)', border: '1px solid var(--rb-border)', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300, color: 'var(--rb-warning)', lineHeight: 1 }}>${data.suggestedDailyRate.toLocaleString()}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rb-text-muted)', marginTop: 3 }}>Day Rate (NZD)</div>
                  </div>
                ) : null}
                {showPricing && data.totalEstimatedHours && data.suggestedDailyRate ? (
                  <div style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300, color: 'var(--rb-text-bright)', lineHeight: 1 }}>${Math.round(data.totalEstimatedHours / 8 * data.suggestedDailyRate).toLocaleString()}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rb-text-muted)', marginTop: 3 }}>Suggested Quote</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showPricing && data.quotingNotes ? (
              <div style={{ background: 'var(--rb-warning-soft)', border: '1px solid var(--rb-border)', borderRadius: 6, padding: '10px 12px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--rb-warning)', marginBottom: 5, marginTop: 0 }}>💰 Quoting Notes</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text)', lineHeight: 1.65, margin: 0 }}>{data.quotingNotes}</p>
              </div>
            ) : null}

            {data.risks?.length > 0 ? (
              <div>
                {sub('Risks & Mitigations')}
                <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {data.risks.map((r: string, i: number) => <li key={i} style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text)', lineHeight: 1.6 }}>{r}</li>)}
                </ul>
              </div>
            ) : null}

            {data.testingPlan ? (
              <div>
                {sub('Testing Plan')}
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text)', lineHeight: 1.6, margin: 0 }}>{data.testingPlan}</p>
              </div>
            ) : null}

            {data.deploymentNotes ? (
              <div>
                {sub('Deployment')}
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--rb-text)', lineHeight: 1.6, margin: 0 }}>{data.deploymentNotes}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
