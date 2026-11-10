// src/components/TaxYearPicker.jsx
//
// The tax-year pills, shared by the Estimate and the Calculator. The years come from GET /tax/law/ (tax_years), so a new year is a
// backend change only; with fewer than two years nothing is rendered. The shared FilterPill carries the styling; aria-pressed
// tells a screen reader which one is on. The pills wrap onto a second line instead of overflowing at 320 px.
import FilterPill from './FilterPill'
import { YEAR_GROUP_LABEL, yearPillLabel } from '@/pages/taxHelpers'

export default function TaxYearPicker({ years, value, onChange }) {
  if (!Array.isArray(years) || years.length === 0) return null
  return (
    <div role="group" aria-label={YEAR_GROUP_LABEL} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
      {years.map((year) => (
        <FilterPill key={year} type="button" active={value === year} aria-pressed={value === year} onClick={() => onChange(year)}>
          {yearPillLabel(year)}
        </FilterPill>
      ))}
    </div>
  )
}
