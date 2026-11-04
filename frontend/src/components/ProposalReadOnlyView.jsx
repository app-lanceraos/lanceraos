// src/components/ProposalReadOnlyView.jsx
//
// A proposal that is no longer a draft (sent, viewed, answered or withdrawn).
// The same cards as the draft editor, but plain text and a plain money table:
// no inputs, no autosave, nothing to save. The actions live in the page header;
// this view adds what only a sent proposal has — the client's answer, the
// expired warning, the activity timeline and the client link.
//
// Everything shown is the server's own value — money is the server's strings,
// not recomputed.
import Card from './Card'
import FosAlert from './FosAlert'
import ProposalAnswerCard from './ProposalAnswerCard'
import ProposalColumns from './ProposalColumns'
import ProposalLinkCard from './ProposalLinkCard'
import ProposalScoreCard from './ProposalScoreCard'
import ProposalTimeline from './ProposalTimeline'
import ProposalTipsCard from './ProposalTipsCard'
import { formatDate, formatProposalMoney } from '@/pages/proposalHelpers'

const textBlock = { margin: 0, fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
const mutedText = { margin: 0, fontSize: '0.84rem', color: 'var(--text-tertiary)' }
const cellBase = { padding: '8px 0', fontSize: '0.84rem', borderTop: '1px solid var(--border-subtle)', verticalAlign: 'top' }

function Fact({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: '0.84rem', padding: '3px 0' }}>
      <span style={{ width: 84, flexShrink: 0, color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

function TotalRow({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: bold ? '0.95rem' : '0.82rem', fontWeight: bold ? 700 : 400, color: 'var(--text-primary)' }}>
      <span style={{ color: bold ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

export default function ProposalReadOnlyView({ detail }) {
  const { currency } = detail
  const hasClient = detail.client_name || detail.client_email || detail.client_company
  const taxRate = Number(detail.tax_rate)
  const discount = Number(detail.discount_amount)
  const answeredOrWithdrawnForRevision = detail.status === 'declined' || detail.status === 'withdrawn'

  const main = (
    <>
      <FosAlert type="info" style={{ marginBottom: 16 }}>{
        answeredOrWithdrawnForRevision
          ? 'Duplicate it to send a revised proposal.'
          : "Sent proposals can't be edited. Duplicate it to make changes."
      }</FosAlert>

      {detail.is_expired && (
        <FosAlert type="warning" style={{ marginBottom: 16 }}>
          This proposal expired on {formatDate(detail.valid_until)}. Your client can still read it but can no longer accept or decline. Withdraw it, or duplicate it to send a fresh one.
        </FosAlert>
      )}

      {(detail.status === 'accepted' || detail.status === 'declined') && <ProposalAnswerCard detail={detail} />}

      <Card title="Client">
        {hasClient ? (
          <div>
            {detail.client_name && <Fact label="Name">{detail.client_name}</Fact>}
            {detail.client_email && <Fact label="Email">{detail.client_email}</Fact>}
            {detail.client_company && <Fact label="Company">{detail.client_company}</Fact>}
          </div>
        ) : <p style={mutedText}>No client details.</p>}
      </Card>

      <Card title="Proposal text">
        {detail.body ? <p style={textBlock}>{detail.body}</p> : <p style={mutedText}>No text.</p>}
      </Card>

      {detail.scope_sections?.length > 0 && (
        <Card title="Scope">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {detail.scope_sections.map((section, index) => (
              <div key={index}>
                <h3 style={{ margin: '0 0 4px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>{section.title}</h3>
                {section.text && <p style={textBlock}>{section.text}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Pricing">
        {detail.items?.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
              <thead>
                <tr>
                  {['Description', 'Qty', 'Unit price', 'Total'].map((heading, i) => (
                    <th key={heading} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '0 0 8px 12px', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', paddingLeft: i === 0 ? 0 : 12 }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ ...cellBase, overflowWrap: 'anywhere' }}>{item.description}</td>
                    <td style={{ ...cellBase, textAlign: 'right', paddingLeft: 12, fontVariantNumeric: 'tabular-nums' }}>{Number(item.quantity)}</td>
                    <td style={{ ...cellBase, textAlign: 'right', paddingLeft: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatProposalMoney(item.unit_price, currency)}</td>
                    <td style={{ ...cellBase, textAlign: 'right', paddingLeft: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 600 }}>{formatProposalMoney(item.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p style={mutedText}>No priced items.</p>}
        <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <TotalRow label="Subtotal" value={formatProposalMoney(detail.subtotal, currency)} />
          {taxRate > 0 && <TotalRow label={`Tax (${taxRate}%)`} value={formatProposalMoney(detail.tax_amount, currency)} />}
          {discount > 0 && <TotalRow label="Discount" value={`−${formatProposalMoney(detail.discount_amount, currency)}`} />}
          <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 4, paddingTop: 6 }}>
            <TotalRow label="Total" value={formatProposalMoney(detail.total, currency)} bold />
          </div>
        </div>
      </Card>

      <Card title="Terms & validity">
        <Fact label="Valid until">{formatDate(detail.valid_until)}</Fact>
        <div style={{ marginTop: 10 }}>
          {detail.payment_terms ? <p style={textBlock}>{detail.payment_terms}</p> : <p style={mutedText}>No payment terms.</p>}
        </div>
      </Card>
    </>
  )

  const aside = (
    <>
      <ProposalTimeline detail={detail} />
      {detail.public_url && ['sent', 'viewed', 'accepted'].includes(detail.status) && <ProposalLinkCard url={detail.public_url} />}
      <ProposalScoreCard quality={detail.quality} />
      <ProposalTipsCard tips={detail.ai_tips} />
    </>
  )

  return <ProposalColumns main={main} aside={aside} />
}
