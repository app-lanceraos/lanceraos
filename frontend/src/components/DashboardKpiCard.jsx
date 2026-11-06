// src/components/DashboardKpiCard.jsx
//
// One KPI tile. The whole tile is a real <Link> (never a clickable div), so it is keyboard-reachable and opens in a
// new tab like any link. Look follows InvoiceKPIStrip's card; the delta line shows only when the server sent a
// percentage (a null pct_change means "no previous month to compare with", so nothing is invented).
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Info } from 'lucide-react'

export default function DashboardKpiCard({ label, value, caption, to, tone = 'var(--text-primary)', Icon, delta, note }) {
  return (
    <Link to={to} className="dash-link dash-kpi" style={{ display: 'block', textDecoration: 'none', color: 'inherit', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        {Icon && <Icon size={15} aria-hidden="true" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
      </div>
      <p className="dash-kpi-value" style={{ margin: '6px 0 2px', fontSize: '1.3rem', fontWeight: 800, lineHeight: 1.1, color: tone, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{value}</p>
      <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{caption}</p>
      {delta && (
        <p style={{ margin: '4px 0 0', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 3, color: delta.up ? 'var(--status-green-text)' : 'var(--status-red-text)' }}>
          {delta.up ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}
          <span>{delta.text}</span>
        </p>
      )}
      {note && (
        <p style={{ margin: '6px 0 0', fontSize: '0.68rem', lineHeight: 1.4, color: 'var(--text-tertiary)', display: 'flex', gap: 5, alignItems: 'flex-start' }}>
          <Info size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{note}</span>
        </p>
      )}
    </Link>
  )
}
