// src/components/PeriodSelector.jsx
//
// The one period control of both report pages: a <select> of presets (nine presets do not fit a row of pills on a phone, and
// a select is keyboard- and screen-reader-native) plus custom dates. A preset is resolved to real dates the moment it is
// chosen and held by the page; the resolved dates are always printed underneath. Custom dates are checked in the browser
// with the server's own sentences, and the page sends no request for a period the server would refuse.
import { useId } from 'react'

import { todayInPlatformTimezone } from '@/pages/invoiceHelpers'
import {
  EARLIEST_REPORT_DATE, TAX_YEAR_NOTE, TAX_YEAR_PRESETS, describePeriod, periodProblem, presetOptions, resolvePreset,
} from '@/pages/reportsHelpers'
import ReportNote from './ReportNote'

export { initialPeriod } from '@/pages/reportsHelpers'

export default function PeriodSelector({ value, onChange, today: todayProp }) {
  const today = todayProp || todayInPlatformTimezone()
  const selectId = useId()
  const problem = periodProblem(value.start, value.end, today)
  const custom = value.preset === 'custom'

  function choosePreset(key) {
    if (key === 'custom') {
      onChange({ preset: 'custom', start: value.start, end: value.end })
      return
    }
    const range = resolvePreset(key, today)
    onChange({ preset: key, start: range.start, end: range.end })
  }

  const dateStyle = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }

  return (
    <div className="rpt-period" style={{ minWidth: 0 }}>
      <div className="rpt-period-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="rpt-period-control" style={{ minWidth: 0, flex: '0 1 260px' }}>
          <label htmlFor={selectId} className="fos-label">Period</label>
          <select id={selectId} className="fos-input fos-select" style={{ minWidth: 0 }} value={value.preset} onChange={(e) => choosePreset(e.target.value)}>
            {presetOptions(today).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {custom && (
          <>
            <label className="rpt-period-control fos-label" style={{ ...dateStyle, flex: '0 1 170px', margin: 0 }}>
              From
              <input
                type="date" className="fos-input" value={value.start} min={EARLIEST_REPORT_DATE} max={today}
                onChange={(e) => onChange({ preset: 'custom', start: e.target.value, end: value.end })}
              />
            </label>
            <label className="rpt-period-control fos-label" style={{ ...dateStyle, flex: '0 1 170px', margin: 0 }}>
              To
              <input
                type="date" className="fos-input" value={value.end} min={EARLIEST_REPORT_DATE} max={today}
                onChange={(e) => onChange({ preset: 'custom', start: value.start, end: e.target.value })}
              />
            </label>
          </>
        )}
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {problem
          ? <p className="fos-error" role="alert" style={{ margin: 0 }}>{problem}</p>
          : <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{describePeriod(value.start, value.end)}</p>}
        {TAX_YEAR_PRESETS.includes(value.preset) && <ReportNote>{TAX_YEAR_NOTE}</ReportNote>}
      </div>
      <style>{`
        @media (max-width: 768px) {
          .rpt-period-control { flex: 1 1 140px !important; min-width: 0 !important; }
        }
      `}</style>
    </div>
  )
}
