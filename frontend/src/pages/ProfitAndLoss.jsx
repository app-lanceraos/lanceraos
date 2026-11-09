// src/pages/ProfitAndLoss.jsx
//
// The Profit and Loss page (/pnl, Prompt 17): the person picks a period and a currency and sees what they received, what
// they spent and what was left. Every number comes from the server (GET /payments/pnl/); the page never adds, converts or
// rounds money, so it agrees with the PDF to the paisa. The header line above the figures is read from the RESPONSE, so the
// figures and their dates can never disagree. Top to bottom: a flash message, the controls (period, currency, Download), the
// cash-basis sentence, the headline numbers, the month-by-month chart and table, income by source and expenses by category,
// the notes, and a link to the Income Statement page. Period and currency are page state, not URL state.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileDown, Info, PieChart } from 'lucide-react'

import useTitle from '@/hooks/useTitle'
import useTimedMessage from '@/hooks/useTimedMessage'
import useReportData from '@/hooks/useReportData'
import useReportDownload from '@/hooks/useReportDownload'
import BreakdownCard from '@/components/BreakdownCard'
import FosAlert from '@/components/FosAlert'
import MonthlyTable from '@/components/MonthlyTable'
import PeriodSelector from '@/components/PeriodSelector'
import PnlKpiStrip from '@/components/PnlKpiStrip'
import PnlMonthlyChart from '@/components/PnlMonthlyChart'
import ReportNote from '@/components/ReportNote'
import { CURRENCY_OPTIONS, todayInPlatformTimezone } from './invoiceHelpers'
import { expenseCountLabel } from './expensesHelpers'
import { paymentCountLabel } from './paymentsHelpers'
import { monthLong } from './dashboardHelpers'
import {
  INCOME_ONLY_NOTE, PNL_FLASH, PNL_STANDING_NOTE, describePeriod, fallbackFilename, formatExact, initialPeriod, pdfPath, plainAmount,
  periodProblem, pnlBlockReason, pnlIsEmpty, pnlNotes, pnlParams, previewPath, showIncomeOnlyNote,
} from './reportsHelpers'

export default function ProfitAndLoss() {
  useTitle('LanceraOS | Profit & Loss')

  const [today] = useState(() => todayInPlatformTimezone())
  const [period, setPeriod] = useState(() => initialPeriod('this_year', today))
  const [currency, setCurrency] = useState('')
  const flash = useTimedMessage()

  const problem = periodProblem(period.start, period.end, today)
  const params = pnlParams({ start: period.start, end: period.end, currency })
  const report = useReportData({ path: previewPath('pnl'), params, enabled: !problem })
  const pdf = useReportDownload()
  const { data } = report

  const reason = pnlBlockReason({ problem, loading: report.loading, loadFailed: Boolean(report.error), data, busy: pdf.busy })
  const blocked = reason !== null

  async function handleDownload() {
    if (blocked || pdf.busy) return
    const result = await pdf.download({
      path: pdfPath('pnl'), params, fallbackName: fallbackFilename('pnl', period.start, period.end),
    })
    if (result.ok) flash.show('success', PNL_FLASH)
  }

  const shownCurrency = currency || data?.currency || ''
  const currencyOptions = !shownCurrency || CURRENCY_OPTIONS.some((o) => o.value === shownCurrency)
    ? CURRENCY_OPTIONS : [{ value: shownCurrency, label: shownCurrency }, ...CURRENCY_OPTIONS]

  const empty = pnlIsEmpty(data)
  const code = data?.currency || ''

  return (
    <>
      {flash.message && <FosAlert type={flash.message.type} onDismiss={flash.clear} style={{ marginBottom: 14 }}>{flash.message.text}</FosAlert>}
      {pdf.error && <FosAlert type="error" onDismiss={pdf.clearError} style={{ marginBottom: 14 }}>{pdf.error}</FosAlert>}

      {/* ── Controls ── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <PeriodSelector value={period} onChange={setPeriod} today={today} />
        </div>
        <div className="pnl-currency" style={{ flex: '0 1 160px', minWidth: 0 }}>
          <label htmlFor="pnl-currency" className="fos-label">Show amounts in</label>
          <select
            id="pnl-currency" className="fos-input fos-select" style={{ minWidth: 0 }} value={shownCurrency} disabled={!shownCurrency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {!shownCurrency && <option value="">…</option>}
            {currencyOptions.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
          </select>
        </div>
        <div className="pnl-download" style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
          <span className="fos-label" aria-hidden="true" style={{ visibility: 'hidden' }}>Download</span>
          <button type="button" className="fos-btn fos-btn-accent" disabled={blocked || pdf.busy} aria-busy={pdf.busy ? 'true' : undefined} onClick={handleDownload}>
            {pdf.busy ? (<><span className="fos-spinner" /> Preparing PDF…</>) : (<><FileDown size={15} aria-hidden="true" /> Download PDF</>)}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        <ReportNote>{PNL_STANDING_NOTE}</ReportNote>
        {blocked && !pdf.busy && !problem && (
          <p role="status" style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            <Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{reason}</span>
          </p>
        )}
      </div>

      {!problem && (
        <>
          {data && (
            <p style={{ margin: '0 0 10px', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {describePeriod(data.start, data.end)}, in {data.currency}
            </p>
          )}

          <div style={{ marginBottom: 16 }}>
            <PnlKpiStrip data={data} loading={report.loading} error={report.error} onReload={report.reload} />
          </div>

          {report.error && !data && <FosAlert type="error" style={{ marginBottom: 16 }}>{report.error}</FosAlert>}

          {report.error && !data ? null : empty ? (
            <div style={{ textAlign: 'center', padding: '40px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', marginBottom: 16 }}>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>Nothing recorded in this period</p>
              <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>Record a payment or an expense dated inside this period to see your profit.</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
                <Link to="/payments" className="fos-btn fos-btn-ghost">Record a payment</Link>
                <Link to="/expenses" className="fos-btn fos-btn-ghost">Add an expense</Link>
              </div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <PnlMonthlyChart data={data} loading={report.loading} error={report.error} onReload={report.reload} />
              </div>

              {data && (
                <div style={{ marginBottom: 16, opacity: report.loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
                  <MonthlyTable
                    id="pnl-monthly-table" title="Month by month" subtitle={`In ${code}`} caption={`Income, expenses and net for each month, in ${code}`}
                    columns={[
                      { key: 'month', label: 'Month' },
                      { key: 'income', label: `Income (${code})`, align: 'right' },
                      { key: 'expenses', label: `Expenses (${code})`, align: 'right' },
                      { key: 'net', label: `Net (${code})`, align: 'right' },
                    ]}
                    rows={data.monthly.map((m) => ({ key: m.month, cells: { month: monthLong(m.month), income: plainAmount(m.income), expenses: plainAmount(m.expenses), net: plainAmount(m.net) } }))}
                    footer={{ cells: { month: 'Total', income: plainAmount(data.income.total), expenses: plainAmount(data.expenses.total), net: plainAmount(data.net.total) } }}
                  />
                </div>
              )}

              <div className="pnl-breakdowns" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, alignItems: 'start', opacity: report.loading && data ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
                <BreakdownCard
                  id="pnl-income-by-source" className="pnl-source" title="Income by source" subtitle="Where the money came from"
                  rows={(data?.income.by_source || []).map((r) => ({ key: r.source, label: r.label, total: r.total, count: r.count }))}
                  currency={code} loading={!data} countLabel={paymentCountLabel} emptyIcon={PieChart} emptyText="No payments in this period."
                  formatAmount={formatExact}
                />
                <BreakdownCard
                  id="pnl-expenses-by-category" className="pnl-category" title="Expenses by category" subtitle="What the money was spent on"
                  rows={(data?.expenses.by_category || []).map((r) => ({ key: r.category, label: r.label, total: r.total, count: r.count }))}
                  currency={code} loading={!data} countLabel={expenseCountLabel} emptyIcon={PieChart} emptyText="No expenses in this period."
                  formatAmount={formatExact}
                />
              </div>
            </>
          )}

          {data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {pnlNotes(data).slice(1).map((note) => <ReportNote key={note}>{note}</ReportNote>)}
              {showIncomeOnlyNote(data) && <ReportNote>{INCOME_ONLY_NOTE}</ReportNote>}
            </div>
          )}
        </>
      )}

      <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        Need a statement of your income for a bank or an embassy?{' '}
        <Link to="/income-certificate" style={{ color: 'var(--accent)', fontWeight: 600 }}>Income Statement</Link>
      </p>

      <style>{`
        @media (max-width: 768px) {
          .pnl-breakdowns { grid-template-columns: 1fr !important; }
          .pnl-currency { flex: 1 1 140px !important; }
        }
      `}</style>
    </>
  )
}
