// src/components/HealthGradeBadge.jsx
//
// The grade word (Excellent, Good, Fair, Poor) as the status-badge recipe from DESIGN.md Section 7. The colour is a judgement
// and may use the status tokens, but the WORD is always written, so colour is never the only signal. Renders nothing when
// the server sent no grade (no score).
import { gradeTone } from '@/pages/healthHelpers'

export default function HealthGradeBadge({ grade, label }) {
  if (!label) return null
  const tone = gradeTone(grade)
  return (
    <span
      data-grade={grade || undefined}
      style={{
        display: 'inline-block', borderRadius: 'var(--radius-full)', padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700,
        background: tone.bg, color: tone.color, whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}
