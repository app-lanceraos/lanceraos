// src/components/ProposalDocument.jsx
//
// The proposal as a CLIENT reads it. One presentational component for two
// worlds: the public page (/proposal/:token, ProposalPublic.jsx) and the
// freelancer's in-app Preview (ProposalPreviewModal.jsx), both feeding it the
// public-API shape (see toPublicShape in proposalLifecycle.js) — so what the
// freelancer previews is, by construction, what the client sees.
//
// Public-page rules (DESIGN.md Section 10): the fixed light palette, never theme
// tokens, because this renders for people who have no LanceraOS account and
// must not follow the freelancer's dark mode. Every string is ESCAPED text
// (React's default; no dangerouslySetInnerHTML anywhere), multi-line text keeps
// its line breaks with pre-wrap. Money is the server's strings, formatted — not
// recomputed. The class names exist for the page's print stylesheet.
import { useState } from 'react'

import { formatDate, formatProposalMoney } from '@/pages/proposalHelpers'

const NAVY = '#1e3a5f'
const TEXT = '#334155'
const MUTED = '#64748b'
const BORDER = 'rgba(0,0,0,.08)'

const text = { margin: 0, fontSize: '0.95rem', lineHeight: 1.7, color: TEXT, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
const h2 = { margin: '0 0 8px', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: NAVY }
const cell = { padding: '10px 0 10px 12px', fontSize: '0.88rem', color: TEXT, borderTop: `1px solid ${BORDER}`, verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' }

// A logo is shown only if it is a plain http(s) URL: never javascript:, data:
// or anything else a hostile record could carry.
const SAFE_LOGO = /^https?:\/\//i

function SenderLogo({ url }) {
  const [failed, setFailed] = useState(false)
  if (!url || !SAFE_LOGO.test(url) || failed) return null
  return (
    <img
      src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)}
      style={{ height: 36, width: 'auto', maxWidth: 120, objectFit: 'contain', borderRadius: 6 }}
    />
  )
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: bold ? '1.05rem' : '0.88rem', fontWeight: bold ? 700 : 400, color: bold ? NAVY : TEXT }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

export default function ProposalDocument({ data }) {
  const { currency, sender } = data
  const taxRate = Number(data.tax_rate)
  const discount = Number(data.discount_amount)
  const hasItems = (data.items || []).length > 0

  return (
    <article style={{ fontFamily: "'DM Sans', sans-serif", color: TEXT }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <SenderLogo url={sender?.logo_url} />
        <span style={{ fontSize: '1rem', fontWeight: 700, color: NAVY, overflowWrap: 'anywhere' }}>{sender?.name}</span>
      </header>

      <p style={{ margin: '0 0 4px', fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: MUTED }}>
        Proposal {data.proposal_number || 'Draft'}
      </p>
      <h1 style={{ margin: '0 0 10px', fontSize: '1.6rem', lineHeight: 1.25, fontWeight: 800, color: NAVY, overflowWrap: 'anywhere' }}>{data.title}</h1>
      <div style={{ display: 'flex', gap: '4px 18px', flexWrap: 'wrap', marginBottom: 22, fontSize: '0.85rem', color: MUTED }}>
        {data.client_name && <span>Prepared for {data.client_name}</span>}
        {data.valid_until && <span>Valid until {formatDate(data.valid_until)}</span>}
      </div>

      {data.body && <p className="proposal-doc-section" style={{ ...text, marginBottom: 26 }}>{data.body}</p>}

      {(data.scope_sections || []).map((section, index) => (
        <section key={index} className="proposal-doc-section" style={{ marginBottom: 22 }}>
          <h2 style={h2}>{section.title}</h2>
          {section.text && <p style={text}>{section.text}</p>}
        </section>
      ))}

      {hasItems && (
        <section className="proposal-doc-section" style={{ marginBottom: 22 }}>
          <h2 style={h2}>Pricing</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
              <thead>
                <tr>
                  {['Description', 'Qty', 'Unit price', 'Total'].map((heading, i) => (
                    <th key={heading} scope="col" style={{ textAlign: i === 0 ? 'left' : 'right', padding: i === 0 ? '0 0 8px' : '0 0 8px 12px', fontSize: '0.7rem', fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, index) => (
                  <tr key={index} className="proposal-doc-row">
                    <td style={{ ...cell, paddingLeft: 0, overflowWrap: 'anywhere' }}>{item.description}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{Number(item.quantity)}</td>
                    <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{formatProposalMoney(item.unit_price, currency)}</td>
                    <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{formatProposalMoney(item.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14, padding: '14px 16px', background: '#f8fafc', border: `1px solid ${BORDER}`, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <Row label="Subtotal" value={formatProposalMoney(data.subtotal, currency)} />
            {taxRate > 0 && <Row label={`Tax (${taxRate}%)`} value={formatProposalMoney(data.tax_amount, currency)} />}
            {discount > 0 && <Row label="Discount" value={`−${formatProposalMoney(data.discount_amount, currency)}`} />}
            <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4, paddingTop: 8 }}>
              <Row label="Total" value={formatProposalMoney(data.total, currency)} bold />
            </div>
          </div>
        </section>
      )}

      {data.payment_terms && (
        <section className="proposal-doc-section" style={{ marginBottom: 8 }}>
          <h2 style={h2}>Payment terms</h2>
          <p style={text}>{data.payment_terms}</p>
        </section>
      )}
    </article>
  )
}
