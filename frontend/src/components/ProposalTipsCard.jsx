// src/components/ProposalTipsCard.jsx
//
// The AI's 2-4 job-specific tips, as plain text. Rendered escaped (React's
// default) — the model's output is never treated as markup. Hidden when there
// are none (a hand-written proposal has no tips).
import Card from './Card'

export default function ProposalTipsCard({ tips }) {
  if (!Array.isArray(tips) || tips.length === 0) return null
  return (
    <Card title="Tips" subtitle="Written by AI from the job post — check them against what's true for you.">
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.55 }}>
        {tips.map((tip, index) => <li key={index}>{String(tip)}</li>)}
      </ul>
    </Card>
  )
}
