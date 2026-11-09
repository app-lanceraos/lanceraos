// src/components/ExpensesCategoryCard.jsx
//
// "Where this year's spending went": a thin wrapper over the shared BreakdownCard (promoted in Prompt 17). Whole units.
// The label comes from the server's own `label` (the summary rows carry it).
import { PieChart } from 'lucide-react'

import { categoryLabel, expenseCountLabel } from '@/pages/expensesHelpers'
import BreakdownCard from './BreakdownCard'

export default function ExpensesCategoryCard({ summary }) {
  const rows = (summary?.by_category || []).map((row) => ({
    key: row.category, label: row.label || categoryLabel(row.category), total: row.total, count: row.count,
  }))
  return (
    <BreakdownCard
      id="expenses-by-category" className="exp-category" title="Where this year's spending went" subtitle="By category, this calendar year"
      rows={rows} currency={summary?.currency || ''} loading={!summary} countLabel={expenseCountLabel}
      emptyIcon={PieChart} emptyText="No expenses this year yet."
    />
  )
}
