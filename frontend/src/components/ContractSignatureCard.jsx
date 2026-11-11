// src/components/ContractSignatureCard.jsx
//
// The signature record of a signed or declined contract, exactly as stored: the typed names, the times (PKT), the IP address
// and browser each person had, and the two fingerprints. Every value is escaped text (IP addresses and browser strings are
// attacker-influenced), shown in monospace with overflow-wrap so a long browser string cannot widen the page. The caption
// says what the record is NOT: proof of who the person was.
import Card from '@/components/Card'
import { OWNER_COPY } from '@/pages/contractCopy'
import { formatTimestampPkt } from '@/pages/proposalHelpers'

const MONO = { fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: '0.74rem', overflowWrap: 'anywhere', wordBreak: 'break-all' }
const LABELS = OWNER_COPY.recordLabels

function Row({ label, children, mono = false }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 130px) minmax(0, 1fr)', gap: 10, padding: '4px 0' }}>
      <dt style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-primary)', overflowWrap: 'anywhere', ...(mono ? MONO : null) }}>{children}</dd>
    </div>
  )
}

function Party({ role, name, whenLabel, when, ip, userAgent }) {
  return (
    <section style={{ marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{role}</h3>
      <dl style={{ margin: 0 }}>
        {name && <Row label={name.label}>{name.value}</Row>}
        <Row label={whenLabel}>{formatTimestampPkt(when)}</Row>
        <Row label={LABELS.ip} mono>{ip || OWNER_COPY.notRecorded}</Row>
        <Row label={LABELS.browser} mono>{userAgent || OWNER_COPY.notRecorded}</Row>
      </dl>
    </section>
  )
}

export default function ContractSignatureCard({ detail }) {
  const record = detail.signature_record
  if (!record) return null
  const signed = detail.status === 'signed'
  const same = signed && record.content_hash && record.content_hash === record.signed_hash
  return (
    <Card title={OWNER_COPY.recordTitle}>
      <p style={{ margin: '0 0 14px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{OWNER_COPY.recordCaption}</p>
      <Party
        role={LABELS.freelancer} name={{ label: LABELS.name, value: record.owner.name }}
        whenLabel={LABELS.signed} when={record.owner.signed_at} ip={record.owner.ip} userAgent={record.owner.user_agent}
      />
      <Party
        role={LABELS.client} name={signed ? { label: LABELS.name, value: record.client.name } : null}
        whenLabel={signed ? LABELS.signed : LABELS.declined} when={record.client.responded_at}
        ip={record.client.ip} userAgent={record.client.user_agent}
      />
      <dl style={{ margin: 0 }}>
        <Row label={LABELS.hashSent} mono>{record.content_hash}</Row>
        {signed && <Row label={LABELS.hashSigned} mono>{record.signed_hash}</Row>}
      </dl>
      {same && <p style={{ margin: '8px 0 0', fontSize: '0.78rem', fontWeight: 600, color: 'var(--status-green-text)' }}>{OWNER_COPY.fingerprintsEqual}</p>}
    </Card>
  )
}
