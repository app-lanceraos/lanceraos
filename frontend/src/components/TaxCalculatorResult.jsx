// src/components/TaxCalculatorResult.jsx
//
// The calculator's answer, band by band. Every figure is the server's (POST /tax/calculator/); the title and subtitle name the
// year and income the result was calculated for, read from the RESPONSE. The total is the plain text colour (a calculation is
// not good or bad news). The surcharge row appears only when the server sent a surcharge percentage.
import DashboardCard from './DashboardCard'
import MonthlyTable from './MonthlyTable'
import ReportNote from './ReportNote'
import { formatExact, plainAmount } from '@/pages/reportsHelpers'
import {
  NO_BANDS, RESULT_COLUMNS, RESULT_TABLE_TITLE, SUMMARY_LABELS, averageRateText, bandRows, calculatorResultSubtitle, calculatorResultTitle,
  surchargeLabel, topBandText,
} from '@/pages/taxHelpers'

const ROW = { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '8px 0', borderTop: '1px solid var(--border-subtle)', fontSize: '0.86rem', color: 'var(--text-secondary)' }
const VALUE = { color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', overflowWrap: 'anywhere' }

export default function TaxCalculatorResult({ result }) {
  const hasSurcharge = result.surcharge_percent !== null && result.surcharge_percent !== undefined
  return (
    <DashboardCard id="tax-calculator-result" title={calculatorResultTitle(result)} subtitle={calculatorResultSubtitle(result)}>
      {result.bands.length === 0 ? (
        <p style={{ margin: '0 0 12px', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>{NO_BANDS}</p>
      ) : (
        <MonthlyTable id="tax-bands" bare title={RESULT_TABLE_TITLE} columns={RESULT_COLUMNS} rows={bandRows(result)} footer={null} minWidth={420} />
      )}

      <dl style={{ margin: '14px 0 0', padding: 0 }}>
        <div style={ROW}>
          <dt>{SUMMARY_LABELS.before}</dt>
          <dd style={{ ...VALUE, margin: 0 }}>{plainAmount(result.tax_before_surcharge)}</dd>
        </div>
        {hasSurcharge && (
          <div style={ROW}>
            <dt>{surchargeLabel(result)}</dt>
            <dd style={{ ...VALUE, margin: 0 }}>{plainAmount(result.surcharge)}</dd>
          </div>
        )}
        <div style={ROW}>
          <dt style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{SUMMARY_LABELS.total}</dt>
          <dd style={{ ...VALUE, margin: 0, fontWeight: 800, fontSize: '1rem' }}>{formatExact(result.total_tax, 'PKR')}</dd>
        </div>
        <div style={ROW}>
          <dt>{SUMMARY_LABELS.average}</dt>
          <dd style={{ ...VALUE, margin: 0 }}>{averageRateText(result)}</dd>
        </div>
        <div style={ROW}>
          <dt>{SUMMARY_LABELS.top}</dt>
          <dd style={{ ...VALUE, margin: 0 }}>{topBandText(result)}</dd>
        </div>
      </dl>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
        {result.notes.map((note, index) => <ReportNote key={`${index}-${note}`}>{note}</ReportNote>)}
      </div>
    </DashboardCard>
  )
}
