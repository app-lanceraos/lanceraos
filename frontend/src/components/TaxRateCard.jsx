// src/components/TaxRateCard.jsx
//
// The rate used in the estimate and the server's own sentence about why (rate.sentence). The rate text is the response's
// `rate.percent` (never a constant in the page). A link leads to Settings > Tax & PSEB where the PSEB number is saved.
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import DashboardCard from './DashboardCard'
import { RATE_CARD_TITLE, SETTINGS_LINK_LABEL, rateLine } from '@/pages/taxHelpers'

export default function TaxRateCard({ data }) {
  return (
    <DashboardCard id="tax-rate" title={RATE_CARD_TITLE}>
      <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{rateLine(data)}</p>
      <p style={{ margin: '8px 0 14px', fontSize: '0.84rem', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{data.rate.sentence}</p>
      <Link to="/settings?tab=tax" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>
        {SETTINGS_LINK_LABEL} <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </DashboardCard>
  )
}
