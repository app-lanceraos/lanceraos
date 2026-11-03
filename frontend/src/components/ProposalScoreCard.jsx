// src/components/ProposalScoreCard.jsx
//
// Shows the quality score EXACTLY as the server returned it (D4): computed by
// code in apps/proposals/scoring.py, never recomputed or approximated in
// JavaScript — a second implementation would drift. While edits are waiting to
// be saved the card says so, because the score describes the last SAVED text.
// The explanation line (from the server) states it is a count of 7 simple
// checks, not a chance of winning; this card never phrases it as one.
import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from 'lucide-react'

import Card from './Card'

const CHECK_ICON = {
  pass: { Icon: CheckCircle2, color: 'var(--status-green-text)', label: 'Passed' },
  partial: { Icon: AlertTriangle, color: 'var(--status-amber-text)', label: 'Partly passed' },
  fail: { Icon: XCircle, color: 'var(--status-red-text)', label: 'Not passed' },
  'n/a': { Icon: MinusCircle, color: 'var(--text-tertiary)', label: 'Not applicable' },
}

function barColor(score) {
  if (score >= 8) return 'var(--status-green)'
  if (score >= 5) return 'var(--status-amber)'
  return 'var(--status-red)'
}

export default function ProposalScoreCard({ quality, pending = false }) {
  if (!quality) return null
  const percent = Math.max(0, Math.min(100, (quality.score / quality.max) * 100))
  return (
    <Card title="Proposal score">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{quality.score}</span>
        <span style={{ fontSize: '0.95rem', color: 'var(--text-tertiary)' }}>/ {quality.max}</span>
      </div>
      <div
        role="meter" aria-label="Proposal score" aria-valuemin={0} aria-valuemax={quality.max} aria-valuenow={quality.score}
        style={{ height: 8, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 8 }}
      >
        <div style={{ width: `${percent}%`, height: '100%', background: barColor(quality.score), borderRadius: 'var(--radius-full)', transition: 'width var(--transition-base)' }} />
      </div>
      {pending && (
        <p style={{ margin: '0 0 10px', fontSize: '0.74rem', color: 'var(--status-amber-text)' }}>Based on your last saved text</p>
      )}
      <ul style={{ listStyle: 'none', margin: '12px 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {quality.checks.map((check) => {
          const meta = CHECK_ICON[check.status] || CHECK_ICON['n/a']
          return (
            <li key={check.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <meta.Icon size={16} aria-label={meta.label} style={{ color: meta.color, flexShrink: 0, marginTop: 2 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <span>{check.label}</span>
                  {check.possible > 0 && (
                    <span style={{ color: 'var(--text-tertiary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {check.points}/{check.possible}
                    </span>
                  )}
                </div>
                <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{check.detail}</p>
              </div>
            </li>
          )
        })}
      </ul>
      <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{quality.explanation}</p>
    </Card>
  )
}
