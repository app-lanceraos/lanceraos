// src/components/ProposalAnswerCard.jsx
//
// The client's answer to an accepted or declined proposal: the decision, when,
// and their message as ESCAPED, pre-wrapped text (it is typed by a third party
// on a public page). When the proposal has been turned into an invoice, the
// link to it lives here too.
import { Link } from 'react-router-dom'
import { CheckCircle2, FileText, XCircle } from 'lucide-react'

import Card from '@/components/Card'
import { formatTimestampPkt } from '@/pages/proposalHelpers'

export default function ProposalAnswerCard({ detail }) {
  const accepted = detail.status === 'accepted'
  const Icon = accepted ? CheckCircle2 : XCircle
  return (
    <Card title="Your client's answer">
      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', fontWeight: 700, color: accepted ? 'var(--status-green-text)' : 'var(--status-red-text)' }}>
        <Icon size={17} aria-hidden="true" />
        {accepted ? 'Accepted' : 'Declined'} on {formatTimestampPkt(detail.responded_at)}
      </p>
      <p style={{ margin: '14px 0 4px', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>
        Message from your client
      </p>
      {detail.response_message
        ? <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.response_message}</p>
        : <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-tertiary)' }}>No message.</p>}
      {detail.converted_invoice && (
        <p style={{ margin: '16px 0 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--text-primary)' }}>
          <FileText size={15} aria-hidden="true" /> Invoice created ·{' '}
          <Link to={`/invoices?invoice=${detail.converted_invoice}`} style={{ color: 'var(--accent-text, var(--accent))', fontWeight: 600 }}>Open invoice</Link>
        </p>
      )}
    </Card>
  )
}
