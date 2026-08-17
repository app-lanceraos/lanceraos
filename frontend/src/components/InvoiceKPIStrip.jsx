// src/components/InvoiceKPIStrip.jsx
//
// The 3 dashboard KPI cards (Outstanding / Overdue / Collected) plus
// their own period + currency controls — List/Table restructure pass.
// Scoped ONLY to these 3 cards: the period/currency selectors here never
// touch the invoice list below (that has its own independent currency
// FILTER and no period concept at all — two different controls for two
// different purposes, see Invoices.jsx's own filter row).
//
// "Total Paid" is now labeled "Collected" and "Past-Due" is now labeled
// "Overdue" — display-only renames; the backend response keys
// (total_paid/past_due) are unchanged, see DECISIONS.md. Only Collected
// shows a month-over-month delta, and only when period=this_month (the
// one case where "vs last month" reads as coherent next to the
// displayed figure) — Outstanding/Overdue never get one, deliberately:
// a delta on a balance-type figure would need a historical snapshot
// that doesn't exist and risks showing a confidently wrong number.
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'

import api from '@/lib/api'
import { CURRENCY_OPTIONS, formatMoney } from '@/pages/clientHelpers'

const PERIOD_OPTIONS = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
]

export default function InvoiceKPIStrip() {
  const [period, setPeriod] = useState('this_month')
  const [currency, setCurrency] = useState('')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = { period }
    if (currency) params.currency = currency
    api.get('/invoices/summary/', { params })
      .then(({ data }) => { setSummary(data); if (!currency) setCurrency(data.currency) })
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }, [period, currency]) // eslint-disable-line react-hooks/exhaustive-deps

  const cards = [
    { key: 'outstanding', label: 'Outstanding', data: summary?.outstanding, hint: 'Sent, viewed, or partially paid — not yet resolved', statusKey: 'amber' },
    { key: 'total_paid', label: 'Collected', data: summary?.total_paid, hint: 'Payments received in this window', statusKey: 'green', showDelta: period === 'this_month' },
    { key: 'past_due', label: 'Overdue', data: summary?.past_due, hint: 'Outstanding + overdue', statusKey: 'red' },
  ]
  const effectiveCurrency = currency || summary?.currency || 'USD'

  return (
    <div style={{ marginBottom: 20 }}>
      <KPIControls period={period} onPeriodChange={setPeriod} currency={effectiveCurrency} onCurrencyChange={setCurrency} />

      {/* Desktop: static grid. Mobile (≤768px): swipeable row + dot
          indicator — both always rendered, CSS media query toggles which
          is visible, matching this app's existing responsive convention
          (Invoices.jsx/Clients.jsx's own filter-row-desktop/mobile split)
          rather than a JS isMobile prop. */}
      <div className="kpi-grid-desktop">
        <div className="kpi-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {cards.map((c) => <KPICard key={c.key} card={c} loading={loading} currency={effectiveCurrency} />)}
        </div>
      </div>
      <div className="kpi-swipe-mobile" style={{ display: 'none' }}>
        <MobileSwipeRow cards={cards} loading={loading} currency={effectiveCurrency} />
      </div>

      <style>{`
        @media (max-width: 939px) {
          .kpi-strip { grid-template-columns: repeat(3, 1fr) !important; gap: 6px !important; }
          .kpi-card { padding: 8px 8px !important; }
          .kpi-card-label { font-size: 0.58rem !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .kpi-card-value { font-size: 0.92rem !important; }
          .kpi-card-count { font-size: 0.62rem !important; }
        }
        @media (max-width: 768px) {
          .kpi-grid-desktop { display: none !important; }
          .kpi-swipe-mobile { display: block !important; }
        }
      `}</style>
    </div>
  )
}

function KPIControls({ period, onPeriodChange, currency, onCurrencyChange }) {
  return (
    <div className="kpi-controls" style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <select
        value={period} onChange={(e) => onPeriodChange(e.target.value)}
        className="fos-input fos-select"
        aria-label="KPI period"
        style={{ width: 'auto', minWidth: 150, fontSize: '0.78rem', padding: '6px 28px 6px 10px' }}
      >
        {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select
        value={currency} onChange={(e) => onCurrencyChange(e.target.value)}
        className="fos-input fos-select"
        aria-label="KPI currency"
        style={{ width: 'auto', minWidth: 100, fontSize: '0.78rem', padding: '6px 28px 6px 10px' }}
      >
        {CURRENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
      </select>
      <style>{`
        @media (max-width: 768px) {
          .kpi-controls select { flex: 1; min-width: 0 !important; }
        }
      `}</style>
    </div>
  )
}

// Horizontally swipeable row with a dot-page indicator — mobile only.
// Real scroll-snap (not a fake transform carousel), each card is
// `scroll-snap-align: center` at ~82% of the container so the next card
// peeks at the edge. The active dot is driven by a real scroll listener
// scoped to this row's own container, not window scroll.
function MobileSwipeRow({ cards, loading, currency }) {
  const scrollerRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    let raf = null
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const cardWidth = el.scrollWidth / cards.length
        setActiveIndex(Math.round(el.scrollLeft / cardWidth))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [cards.length])

  return (
    <div>
      <div
        ref={scrollerRef}
        style={{
          display: 'flex', gap: 10, overflowX: 'auto', scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch', paddingBottom: 4,
        }}
      >
        {cards.map((c) => (
          <div key={c.key} style={{ flex: '0 0 82%', scrollSnapAlign: 'center' }}>
            <KPICard card={c} loading={loading} currency={currency} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 8 }}>
        {cards.map((c, i) => (
          <span
            key={c.key}
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: i === activeIndex ? 'var(--accent)' : 'var(--border-subtle)',
              transition: 'background 0.15s ease',
            }}
          />
        ))}
      </div>
    </div>
  )
}

function KPICard({ card, loading, currency }) {
  return (
    <div className="kpi-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', height: '100%' }}>
      <p className="kpi-card-label" style={{ margin: 0, fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</p>
      {!loading && card.data ? (
        <>
          <p className="kpi-card-value" style={{ margin: '5px 0 2px', fontSize: '1.3rem', fontWeight: 800, color: `var(--status-${card.statusKey}-text)`, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(card.data.total, currency)}
          </p>
          <p className="kpi-card-count" style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
            {card.data.count ?? 0} invoice{card.data.count !== 1 ? 's' : ''}
            {card.data.unconverted_count > 0 && ` · ${card.data.unconverted_count} excluded (no exchange rate)`}
          </p>
          {card.showDelta && card.data.delta && <DeltaIndicator delta={card.data.delta} currency={currency} />}
        </>
      ) : (
        <div style={{ height: 34, marginTop: 6, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      )}
    </div>
  )
}

function DeltaIndicator({ delta, currency }) {
  const pct = delta.pct_change
  const amount = Number(delta.amount_change || 0)
  if (pct === null && amount === 0) return null // no prior-month AND no current-month data — nothing meaningful to show

  const isUp = amount >= 0
  const color = isUp ? 'var(--status-green-text)' : 'var(--status-red-text)'
  const Icon = isUp ? ArrowUp : ArrowDown

  const changeLabel = pct !== null ? `${Math.abs(pct).toFixed(1)}% vs last month` : 'New vs last month'
  const amountLabel = pct !== null ? ` (${isUp ? '+' : '−'}${formatMoney(Math.abs(amount), currency)})` : ''

  return (
    <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color, display: 'flex', alignItems: 'center', gap: 3 }}>
      <Icon size={11} />
      <span>{changeLabel}{amountLabel}</span>
    </p>
  )
}
