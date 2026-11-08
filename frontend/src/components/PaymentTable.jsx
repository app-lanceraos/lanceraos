// src/components/PaymentTable.jsx
//
// The Payments list: a real table on desktop (PaymentTable) and a card list at <= 768px (PaymentCard, rendered by
// Payments.jsx), toggled with the same .list-desktop / .list-mobile CSS the other list pages use.
// Columns: Date | Received from | Source | Amount | Invoice. Every th/td/wrapper/hover style comes from
// listTableStyles.js. The whole row opens the payment's side panel, AND the date cell holds a real <button> that does
// the same, so every row is operable from the keyboard (the Invoices/Clients tables are not — this one is).
// An amount is shown with its exact cents; a payment converted with an estimated rate, or with none, carries an Info
// icon whose label is the same sentence the side panel shows as visible text.
import { ChevronRight, Info } from 'lucide-react'

import { clickableRowCss, tableStyle, tableWrapperStyle, td, th, theadRowStyle } from './listTableStyles'
import { STATUS_BADGE_STYLE, badgeBaseStyle } from '@/pages/clientHelpers'
import { formatIsoDate } from '@/pages/dashboardHelpers'
import {
  LINK_BADGE_KEY, LINK_LABELS, formatExact, linkStatus, rateNote, sourceLabel,
} from '@/pages/paymentsHelpers'

export function LinkBadge({ payment }) {
  const status = linkStatus(payment)
  return <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[LINK_BADGE_KEY[status]] }}>{LINK_LABELS[status]}</span>
}

export function SourceBadge({ source }) {
  return <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.gray, fontWeight: 500 }}>{sourceLabel(source)}</span>
}

export function RateInfo({ basis, size = 13 }) {
  const note = rateNote(basis)
  if (basis !== 'estimated' && basis !== 'none') return null
  return (
    <span role="img" aria-label={note} data-tooltip={note} style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 6, color: 'var(--text-tertiary)' }}>
      <Info size={size} aria-hidden="true" />
    </span>
  )
}

function firstInvoiceLine(payment) {
  const invoices = payment.invoices || []
  if (invoices.length === 0) return null
  return invoices.length === 1 ? invoices[0].invoice_number : `${invoices[0].invoice_number} +${invoices.length - 1} more`
}

export default function PaymentTable({ payments, onOpen }) {
  return (
    <div style={tableWrapperStyle}>
      <style>{clickableRowCss('payment-row')}</style>
      <table style={tableStyle(760)}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={th}>Date</th>
            <th style={th}>Received from</th>
            <th style={th}>Source</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount</th>
            <th style={th}>Invoice</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => {
            const invoiceLine = firstInvoiceLine(payment)
            return (
              <tr key={payment.id} className="payment-row" onClick={() => onOpen(payment)}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpen(payment) }}
                    style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                    aria-label={`Open payment of ${formatExact(payment.amount, payment.currency)} from ${formatIsoDate(payment.payment_date)}`}
                  >
                    {formatIsoDate(payment.payment_date)}
                  </button>
                </td>
                <td style={{ ...td, maxWidth: 260 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{payment.counterparty || '—'}</div>
                  {payment.notes && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{payment.notes}</div>
                  )}
                </td>
                <td style={td}><SourceBadge source={payment.source} /></td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {formatExact(payment.amount, payment.currency)}
                  <RateInfo basis={payment.rate_basis} />
                </td>
                <td style={td}>
                  <LinkBadge payment={payment} />
                  {invoiceLine && <div style={{ marginTop: 3, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{invoiceLine}</div>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function PaymentCard({ payment, onOpen }) {
  const invoiceLine = firstInvoiceLine(payment)
  return (
    <button
      type="button"
      onClick={() => onOpen(payment)}
      aria-label={`Open payment of ${formatExact(payment.amount, payment.currency)} from ${formatIsoDate(payment.payment_date)}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit',
        background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', color: 'var(--text-primary)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: '1rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {formatExact(payment.amount, payment.currency)}
          <RateInfo basis={payment.rate_basis} />
        </span>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{formatIsoDate(payment.payment_date)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {payment.counterparty || 'No name'}
        </span>
        <ChevronRight size={15} aria-hidden="true" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <SourceBadge source={payment.source} />
        <LinkBadge payment={payment} />
        {invoiceLine && <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{invoiceLine}</span>}
      </div>
    </button>
  )
}
