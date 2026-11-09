// src/components/HealthWindowPicker.jsx
//
// Four pills for the window (3, 6, 12, 24 months). A pill row is quicker than a select for four short choices and wraps onto
// a second line instead of overflowing at 320 px. The shared FilterPill carries aria-pressed.
import FilterPill from './FilterPill'
import { WINDOW_GROUP_LABEL, WINDOW_OPTIONS } from '@/pages/healthHelpers'

export default function HealthWindowPicker({ value, onChange }) {
  return (
    <div role="group" aria-label={WINDOW_GROUP_LABEL} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {WINDOW_OPTIONS.map((option) => (
        <FilterPill key={option.months} type="button" active={value === option.months} aria-pressed={value === option.months} onClick={() => onChange(option.months)}>
          {option.label}
        </FilterPill>
      ))}
    </div>
  )
}
