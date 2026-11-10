// src/components/TaxKpiStrip.jsx
//
// The three headline numbers of the Tax estimate: received from abroad, the estimated tax the banks took, received in PKR from
// local payers. All three are server figures shown with their exact cents. They are a calculation, not good or bad news, so
// the values are the plain text colour (never red). The grid is auto-fit: three across when there is room, fewer when there is
// not. A refetch dims the cards, it never unmounts them; with no data yet the cards are skeletons of the same footprint.
import { kpiCards } from '@/pages/taxHelpers'

const SKELETON_LABELS = [
  { key: 'export', label: 'Received from abroad' },
  { key: 'tax', label: 'Estimated tax taken by banks' },
  { key: 'local', label: 'Received in PKR from local payers' },
]

export default function TaxKpiStrip({ data, loading }) {
  const cards = data ? kpiCards(data) : SKELETON_LABELS
  return (
    <div
      className="tax-kpi-strip" aria-busy={loading ? 'true' : undefined}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, opacity: loading && data ? 0.55 : 1, transition: 'opacity 0.15s ease' }}
    >
      {cards.map((card) => (
        <div key={card.key} className="tax-kpi-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</p>
          {card.value !== undefined ? (
            <>
              <p className="tax-kpi-value" style={{ margin: '6px 0 4px', fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{card.value}</p>
              {card.lines.map((line) => (
                <p key={line} style={{ margin: '2px 0 0', fontSize: '0.74rem', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{line}</p>
              ))}
            </>
          ) : (
            <div style={{ height: 50, marginTop: 6, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
          )}
        </div>
      ))}
    </div>
  )
}
