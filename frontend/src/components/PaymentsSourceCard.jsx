// src/components/PaymentsSourceCard.jsx
//
// "Where this year's income came from": a thin wrapper over the shared BreakdownCard (promoted in Prompt 17). Whole units.
import { PieChart } from 'lucide-react'

import { paymentCountLabel } from '@/pages/paymentsHelpers'
import BreakdownCard from './BreakdownCard'

export default function PaymentsSourceCard({ summary }) {
  const rows = (summary?.by_source || []).map((row) => ({ key: row.source, label: row.label, total: row.total, count: row.count }))
  return (
    <BreakdownCard
      id="payments-by-source" className="pay-source" title="Where this year's income came from" subtitle="By source, this calendar year"
      rows={rows} currency={summary?.currency || ''} loading={!summary} countLabel={paymentCountLabel}
      emptyIcon={PieChart} emptyText="No payments this year yet."
    />
  )
}
