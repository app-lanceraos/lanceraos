// src/components/TaxEstimate.jsx
//
// The Estimate view of the Tax page. Every number and every tax sentence is the SERVER's (GET /tax/overview/): this component
// only arranges them. Top to bottom: the standing notes (static, drift-tested against notes[0] of the payload), the year line,
// the stale alert, the three headline numbers, the rate, the PDF download, then EITHER the empty-year card OR the month table
// and the currency table, "what to do next", what the estimate does not cover, and the rest of the server's notes.
// First load shows skeletons with the same footprint under one status; a refetch dims the content (0.55) and keeps it; an
// error with no data shows one alert with Reload (the year pills live in the page, outside this component, and still work).
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'

import DashboardCard from './DashboardCard'
import FosAlert from './FosAlert'
import MonthlyTable from './MonthlyTable'
import ReportNote from './ReportNote'
import TaxDownloadCard from './TaxDownloadCard'
import TaxKpiStrip from './TaxKpiStrip'
import TaxNextStepsCard from './TaxNextStepsCard'
import TaxRateCard from './TaxRateCard'
import { TAX_YEAR_NOTE } from '@/pages/reportsHelpers'
import {
  CURRENCY_COLUMNS, CURRENCY_TABLE_SUBTITLE, CURRENCY_TABLE_TITLE, EMPTY_YEAR_BODY, EMPTY_YEAR_BUTTON, ESTIMATE_STANDING_NOTE, LOADING_LABEL,
  MONTH_COLUMNS, MONTH_TABLE_SUBTITLE, MONTH_TABLE_TITLE, NOT_ADVICE_NOTE, NOT_COVERED_TITLE, NO_FOREIGN_CURRENCY, RELOAD_LABEL,
  countedLine, currencyRows, emptyYearTitle, hasByCurrency, monthlyFooter, monthlyRows, staleLine, visibleNotes, yearIsEmpty, yearLine,
} from '@/pages/taxHelpers'

function Skeleton({ height }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 20px' }}>
      <div style={{ height: 14, width: '40%', marginBottom: 16, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      <div style={{ height, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
    </div>
  )
}

export default function TaxEstimate({ data, loading, error, onReload }) {
  const notes = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
      <ReportNote>{ESTIMATE_STANDING_NOTE}</ReportNote>
      <ReportNote>{NOT_ADVICE_NOTE}</ReportNote>
      <ReportNote>{TAX_YEAR_NOTE}</ReportNote>
    </div>
  )

  if (!data && error) {
    return (
      <>
        {notes}
        <FosAlert type="error" style={{ marginBottom: 12 }}>{error}</FosAlert>
        <button type="button" className="fos-btn fos-btn-ghost" onClick={onReload}>
          <RefreshCw size={14} aria-hidden="true" /> {RELOAD_LABEL}
        </button>
      </>
    )
  }

  if (!data) {
    return (
      <>
        {notes}
        <div role="status" aria-label={LOADING_LABEL} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TaxKpiStrip data={null} loading />
          <Skeleton height={90} />
          <Skeleton height={60} />
          <Skeleton height={180} />
        </div>
      </>
    )
  }

  const stale = staleLine(data)
  const counted = countedLine(data)
  const empty = yearIsEmpty(data)
  const code = 'PKR'

  return (
    <>
      {notes}
      <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
        <p style={{ margin: '0 0 12px', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
          {yearLine(data)}{counted ? `. ${counted}` : ''}
        </p>
        {stale && <FosAlert type="warning" style={{ marginBottom: 16 }}>{stale}</FosAlert>}

        <div style={{ marginBottom: 16 }}>
          <TaxKpiStrip data={data} loading={false} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16, alignItems: 'start' }}>
          <TaxRateCard data={data} />
          <TaxDownloadCard data={data} loading={loading} loadFailed={Boolean(error)} onNtnMissing={onReload} />
        </div>

        {empty ? (
          <div style={{ textAlign: 'center', padding: '40px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', marginBottom: 16 }}>
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{emptyYearTitle(data)}</p>
            <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>{EMPTY_YEAR_BODY}</p>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <Link to="/payments" className="fos-btn fos-btn-ghost">{EMPTY_YEAR_BUTTON}</Link>
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <MonthlyTable
                id="tax-monthly" title={MONTH_TABLE_TITLE} subtitle={MONTH_TABLE_SUBTITLE}
                caption={`Received from abroad, estimated tax and local payments for each month, in ${code}`}
                columns={MONTH_COLUMNS} rows={monthlyRows(data)} footer={monthlyFooter(data)}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              {hasByCurrency(data) ? (
                <MonthlyTable
                  id="tax-currencies" title={CURRENCY_TABLE_TITLE} subtitle={CURRENCY_TABLE_SUBTITLE}
                  columns={CURRENCY_COLUMNS} rows={currencyRows(data)} footer={null} minWidth={320}
                />
              ) : (
                <ReportNote>{NO_FOREIGN_CURRENCY}</ReportNote>
              )}
            </div>
          </>
        )}

        <div style={{ marginBottom: 16 }}>
          <TaxNextStepsCard data={data} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <DashboardCard id="tax-not-covered" title={NOT_COVERED_TITLE}>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              {data.not_covered.map((line, index) => <li key={`${index}-${line}`} style={{ overflowWrap: 'anywhere' }}>{line}</li>)}
            </ul>
          </DashboardCard>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleNotes(data).map((note, index) => <ReportNote key={`${index}-${note}`}>{note}</ReportNote>)}
        </div>
      </div>
    </>
  )
}
