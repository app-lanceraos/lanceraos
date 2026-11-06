// src/components/DashboardRatesCard.jsx
//
// The daily USD / EUR / GBP -> PKR rates. They come from ONE snapshot fetched each morning, so this says "Daily rate"
// and shows the snapshot's date — never "live". A snapshot older than three days gets an amber note.
import { AlertTriangle, Landmark } from 'lucide-react'

import { formatIsoDate, rateRowText } from '@/pages/dashboardHelpers'
import DashboardCard from './DashboardCard'
import DashboardUnavailable from './DashboardUnavailable'

export default function DashboardRatesCard({ rates, onReload, className }) {
  const hasRates = rates?.available && rates.pairs.length > 0
  return (
    <DashboardCard
      id="rates" title="Exchange rates" className={className}
      subtitle={rates?.available && rates.date ? `Daily rate · updated ${formatIsoDate(rates.date)}` : 'Daily rate'}
    >
      {!rates?.available ? (
        <DashboardUnavailable onReload={onReload} />
      ) : !hasRates ? (
        <div style={{ textAlign: 'center', padding: '16px 8px', color: 'var(--text-tertiary)' }}>
          <Landmark size={22} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ margin: 0, fontSize: '0.84rem' }}>No exchange rates yet.</p>
        </div>
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rates.pairs.map((pair) => (
              <li key={pair.from} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.84rem', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {rateRowText(pair)}
              </li>
            ))}
          </ul>
          {rates.stale && (
            <p style={{ margin: '10px 0 0', display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.74rem', color: 'var(--status-amber-text)' }}>
              <AlertTriangle size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>These rates are out of date — the daily update has missed a few days.</span>
            </p>
          )}
        </>
      )}
    </DashboardCard>
  )
}
