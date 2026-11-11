// src/components/ContractDocument.jsx
//
// The contract as a CLIENT reads it. One presentational component for three worlds: the public page
// (/contract/:token, ContractPublic.jsx), the owner's view of a sent or answered contract, and the owner's draft preview;
// all feed it the public-API shape (toDocumentModel in contractHelpers.js), so what the freelancer previews is, by
// construction, what the client sees.
//
// Public-page rules (DESIGN.md Section 10): the fixed light palette, never theme tokens, because this renders for
// people who have no LanceraOS account and must not follow anyone's dark mode. Every string is ESCAPED text (React's
// default; nothing is ever injected as raw HTML) and multi-line text keeps its line breaks with pre-wrap. Money
// is the server's string, formatted, not recomputed. The section numbering and headings match the PDF.
//
// `markPlaceholders` (the owner's draft preview only) highlights text in [[double square brackets]] and says so above
// the document.
import { useState } from 'react'

import { PUBLIC_COPY } from '@/pages/contractCopy'
import {
  feeIsPositive, findPlaceholders, placeholderCount,
} from '@/pages/contractHelpers'
import { formatDate, formatProposalMoney, formatTimestamp } from '@/pages/proposalHelpers'

const NAVY = '#1e3a5f'
const TEXT = '#334155'
const MUTED = '#64748b'
const BORDER = 'rgba(0,0,0,.1)'
const SERIF = "Georgia, 'Times New Roman', serif"
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

const bodyText = { margin: 0, fontSize: '0.95rem', lineHeight: 1.7, color: TEXT, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
const h2 = { margin: '0 0 8px', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: NAVY }
const small = { margin: 0, fontSize: '0.78rem', color: MUTED, lineHeight: 1.55 }

// A logo is shown only if it is a plain http(s) URL: never javascript:, data: or anything else a hostile record could carry.
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

/** `text` as React text nodes, with every [[blank]] on an amber background when `mark` is true. */
function MarkedText({ text, mark }) {
  const value = String(text ?? '')
  if (!mark) return value
  const blanks = findPlaceholders(value)
  if (!blanks.length) return value
  const pieces = []
  let cursor = 0
  blanks.forEach((blank, index) => {
    if (blank.start > cursor) pieces.push(value.slice(cursor, blank.start))
    pieces.push(
      <mark key={index} data-blank="true" style={{ background: '#fde68a', color: '#78350f', borderRadius: 3, padding: '0 2px' }}>
        {blank.text}
      </mark>,
    )
    cursor = blank.end
  })
  if (cursor < value.length) pieces.push(value.slice(cursor))
  return pieces
}

function PartyBlock({ role, lines }) {
  return (
    <div style={{ flex: '1 1 220px', minWidth: 0, borderLeft: `3px solid ${NAVY}`, paddingLeft: 10 }}>
      <p style={{ ...small, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{role}</p>
      {lines.map((line, index) => (
        <p key={index} style={{ margin: 0, fontSize: '0.9rem', color: TEXT, fontWeight: index === 0 ? 600 : 400, overflowWrap: 'anywhere' }}>{line}</p>
      ))}
    </div>
  )
}

function freelancerLines(party) {
  const place = [party?.city, party?.country].filter(Boolean).join(', ')
  const lines = [party?.name, party?.business_name && party.business_name !== party.name ? party.business_name : '', place]
  return lines.filter(Boolean)
}

function Signature({ role, name, when }) {
  return (
    <div style={{ flex: '1 1 220px', minWidth: 0, borderTop: `1.5px solid ${NAVY}`, paddingTop: 8 }}>
      <p style={{ ...small, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{role}</p>
      <p style={{ margin: '6px 0 4px', minHeight: 28, fontFamily: SERIF, fontStyle: 'italic', fontSize: '1.3rem', lineHeight: 1.25, color: NAVY, overflowWrap: 'anywhere' }}>{name}</p>
      <p style={small}>{when}</p>
    </div>
  )
}

function KeyTerm({ label, children }) {
  return (
    <>
      <dt style={{ ...small, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 0' }}>{label}</dt>
      <dd style={{ margin: 0, padding: '6px 0', fontSize: '0.9rem', color: TEXT, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</dd>
    </>
  )
}

export default function ContractDocument({ data, markPlaceholders = false }) {
  const copy = PUBLIC_COPY.doc
  const { currency, sender, parties } = data
  const sections = data.sections || []
  const hasFee = feeIsPositive(data.fee_amount)
  const blankTotal = markPlaceholders ? placeholderCount(sections) : 0
  const clientSigned = Boolean(data.client_signature)
  const ownerWhen = data.owner_signature?.signed_at ? copy.signedOn(formatTimestamp(data.owner_signature.signed_at)) : copy.notSignedYet
  let clientName = ''
  let clientWhen = copy.notSignedYet
  if (clientSigned) {
    clientName = data.client_signature.name
    clientWhen = copy.signedOn(formatTimestamp(data.client_signature.signed_at))
  } else if (data.declined_at) {
    clientWhen = copy.declinedOn(formatTimestamp(data.declined_at))
  }

  return (
    <article className="contract-doc" style={{ fontFamily: "'DM Sans', sans-serif", color: TEXT }}>
      {blankTotal > 0 && (
        <p
          role="note"
          style={{ margin: '0 0 16px', padding: '10px 12px', borderRadius: 8, background: '#fef3c7', color: '#78350f', fontSize: '0.85rem', fontWeight: 600 }}
        >
          {copy.blankBanner}
        </p>
      )}

      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <SenderLogo url={sender?.logo_url} />
        <span style={{ fontSize: '1rem', fontWeight: 700, color: NAVY, overflowWrap: 'anywhere' }}>{sender?.name}</span>
      </header>

      <p style={{ margin: '0 0 4px', fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: MUTED }}>
        {copy.contract} {data.contract_number || copy.draftNumber}
      </p>
      <h1 style={{ margin: '0 0 22px', fontSize: '1.6rem', lineHeight: 1.25, fontWeight: 800, color: NAVY, overflowWrap: 'anywhere' }}>{data.title}</h1>

      <section className="contract-doc-section" style={{ marginBottom: 22 }}>
        <h2 style={h2}>{copy.parties}</h2>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <PartyBlock role={copy.freelancer} lines={freelancerLines(parties?.freelancer)} />
          <PartyBlock role={copy.client} lines={[parties?.client?.name, parties?.client?.company].filter(Boolean)} />
        </div>
      </section>

      {(hasFee || data.payment_terms || data.start_date || data.end_date || data.valid_until) && (
        <section className="contract-doc-section" style={{ marginBottom: 22 }}>
          <h2 style={h2}>{copy.keyTerms}</h2>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(90px, 130px) minmax(0, 1fr)', columnGap: 12, padding: '4px 14px', background: '#f8fafc', border: `1px solid ${BORDER}`, borderRadius: 10 }}>
            {hasFee && <KeyTerm label={copy.fee}>{formatProposalMoney(data.fee_amount, currency)}</KeyTerm>}
            {data.payment_terms && <KeyTerm label={copy.paymentTerms}><MarkedText text={data.payment_terms} mark={markPlaceholders} /></KeyTerm>}
            {data.start_date && <KeyTerm label={copy.startDate}>{formatDate(data.start_date)}</KeyTerm>}
            {data.end_date && <KeyTerm label={copy.endDate}>{formatDate(data.end_date)}</KeyTerm>}
            {data.valid_until && <KeyTerm label={copy.signBy}>{formatDate(data.valid_until)}</KeyTerm>}
          </dl>
        </section>
      )}

      {sections.map((section, index) => (
        <section key={section.id || index} className="contract-doc-section" style={{ marginBottom: 22 }}>
          <h2 style={h2}>{index + 1}. <MarkedText text={section.title} mark={markPlaceholders} /></h2>
          {section.text && <p style={bodyText}><MarkedText text={section.text} mark={markPlaceholders} /></p>}
        </section>
      ))}

      <div className="contract-doc-signoff" style={{ marginTop: 8 }}>
        <h2 style={h2}>{copy.signatures}</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Signature role={copy.freelancer} name={data.owner_signature?.name || ''} when={ownerWhen} />
          <Signature role={copy.client} name={clientName} when={clientWhen} />
        </div>

        {data.content_hash && (
          <div style={{ marginTop: 18, padding: '12px 14px', border: `1px solid ${BORDER}`, borderRadius: 10, background: '#f8fafc' }}>
            <p style={{ ...small, fontWeight: 600 }}>{copy.fingerprintLabel}</p>
            <p data-testid="contract-fingerprint" style={{ margin: '4px 0 8px', fontFamily: MONO, fontSize: '0.78rem', color: TEXT, wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{data.content_hash}</p>
            <p style={small}>{copy.fingerprintNote}</p>
            <p style={{ ...small, marginTop: 4 }}>{clientSigned ? copy.signingNoteBoth : copy.signingNoteOwner}</p>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          .contract-doc-section, .contract-doc-signoff { break-inside: avoid; }
        }
      `}</style>
    </article>
  )
}
