// src/components/ContractSentPage.jsx
//
// A contract that is no longer a draft: header actions for its status (copy link, preview, PDF, withdraw, duplicate), a
// summary, the client link, the client's reason when they declined, the signature record, the activity timeline and the
// contract text. WHICH actions appear is availableActions() in contractLifecycle.js; everything shown is the server's own
// detail.
//
// While a contract is waiting on the client (sent or viewed) the page re-reads it when the person returns to the tab and
// every 60 s while the tab is visible: no WebSocket. It stops when the tab is hidden and once the contract is answered or
// withdrawn.
import { useCallback, useEffect, useRef, useState } from 'react'

import api from '@/lib/api'
import Card from '@/components/Card'
import ContractDocument from '@/components/ContractDocument'
import { ExpiredBadge } from '@/components/ContractTable'
import ContractHeader from '@/components/ContractHeader'
import ContractLinkCard from '@/components/ContractLinkCard'
import ContractPreviewModal from '@/components/ContractPreviewModal'
import ContractSignatureCard from '@/components/ContractSignatureCard'
import ContractTimeline from '@/components/ContractTimeline'
import FosAlert from '@/components/FosAlert'
import ProposalBanners from '@/components/ProposalBanners'
import ProposalColumns from '@/components/ProposalColumns'
import WithdrawContractDialog from '@/components/WithdrawContractDialog'
import useContractActions from '@/hooks/useContractActions'
import { OWNER_COPY } from '@/pages/contractCopy'
import { moneyLabel, toDocumentModel } from '@/pages/contractHelpers'
import { formatDate } from '@/pages/proposalHelpers'

export const REFRESH_INTERVAL_MS = 60000

const labelStyle = { fontSize: '0.74rem', color: 'var(--text-tertiary)' }
const valueStyle = { margin: 0, fontSize: '0.84rem', color: 'var(--text-primary)', overflowWrap: 'anywhere' }

function Fact({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, 110px) minmax(0, 1fr)', gap: 10, padding: '4px 0' }}>
      <dt style={labelStyle}>{label}</dt>
      <dd style={{ ...valueStyle, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{children}</dd>
    </div>
  )
}

/**
 * @param {object} props
 * @param {object} props.detail
 * @param {object} props.banners - { flash, onDismissFlash, notice, onDismissNotice }
 * @param {(text?: string) => void} props.onNotDraft - reload the real state, optionally with a notice
 * @param {(data: object, notice: object) => void} props.onApplyDetail - a fresh detail plus a banner (remounts the page)
 * @param {(data: object) => void} props.onDetailChange - a fresh detail, quietly (no remount, no banner)
 * @param {() => void} props.onReload
 */
export default function ContractSentPage({ detail, banners, onNotDraft, onApplyDetail, onDetailChange, onReload }) {
  const actions = useContractActions({ detail, onNotDraft })
  const [dialog, setDialog] = useState(null) // null | 'withdraw' | 'preview'
  const [showText, setShowText] = useState(false)
  const requestId = useRef(0)
  const mounted = useRef(true)
  const latest = useRef(detail)
  latest.current = detail

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const waiting = detail.status === 'sent' || detail.status === 'viewed'

  const refresh = useCallback(async () => {
    requestId.current += 1
    const mine = requestId.current
    try {
      const { data } = await api.get(`/contracts/${latest.current.id}/`)
      if (!mounted.current || mine !== requestId.current) return
      if (data.status !== latest.current.status || data.updated_at !== latest.current.updated_at) onDetailChange(data)
    } catch {
      // A failed quiet refresh changes nothing: the page keeps what it has.
    }
  }, [onDetailChange])

  useEffect(() => {
    if (!waiting) return undefined
    let timer = null
    const start = () => {
      clearInterval(timer)
      timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { refresh(); start() } else { clearInterval(timer); timer = null }
    }
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [waiting, refresh])

  function handleAction(key) {
    if (key === 'duplicate') actions.duplicate()
    else if (key === 'copy_link') actions.copyLink()
    else if (key === 'pdf') actions.downloadPdf()
    else setDialog(key)
  }

  const documentModel = toDocumentModel({ kind: 'detail', source: detail })

  const main = (
    <>
      <Card title={OWNER_COPY.summaryTitle}>
        <dl style={{ margin: 0 }}>
          <Fact label={OWNER_COPY.summaryLabels.client}>{detail.client_name || OWNER_COPY.noClient}{detail.client_company ? ` · ${detail.client_company}` : ''}</Fact>
          {detail.client_email && <Fact label={OWNER_COPY.summaryLabels.email}>{detail.client_email}</Fact>}
          <Fact label={OWNER_COPY.summaryLabels.fee}>{moneyLabel(detail.fee_amount, detail.currency, detail.payment_terms)}</Fact>
          <Fact label={OWNER_COPY.summaryLabels.signBy}>
            {formatDate(detail.valid_until)}
            {detail.is_expired && <ExpiredBadge />}
          </Fact>
          {detail.sent_via && <Fact label={OWNER_COPY.summaryLabels.sentVia}>{OWNER_COPY.sentVia[detail.sent_via] || detail.sent_via}</Fact>}
          {detail.contract_number && <Fact label={OWNER_COPY.summaryLabels.number}>{detail.contract_number}</Fact>}
        </dl>
      </Card>

      {detail.status === 'declined' && (
        <Card title={OWNER_COPY.clientReasonTitle}>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {detail.response_message || OWNER_COPY.noReason}
          </p>
        </Card>
      )}

      <ContractSignatureCard detail={detail} />

      <Card
        title={OWNER_COPY.contractTextTitle}
        action={(
          <button type="button" className="fos-btn fos-btn-ghost" aria-expanded={showText} onClick={() => setShowText((value) => !value)}>
            {showText ? OWNER_COPY.hideText : OWNER_COPY.showText}
          </button>
        )}
      >
        {showText ? (
          <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 12, padding: '24px 22px' }}>
            <ContractDocument data={documentModel} />
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>{OWNER_COPY.sectionsSummary(detail.sections.length)}</p>
        )}
      </Card>
    </>
  )

  const aside = (
    <>
      <ContractLinkCard url={detail.public_url} status={detail.status} />
      <ContractTimeline detail={detail} />
    </>
  )

  return (
    <div style={{ maxWidth: 1180 }}>
      <ProposalBanners {...banners} message={actions.message} onDismissMessage={actions.clear} />
      {actions.pdfError && <FosAlert type="error" onDismiss={actions.clearPdfError} style={{ marginBottom: 16 }}>{actions.pdfError}</FosAlert>}
      <ContractHeader
        detail={detail} disabled={actions.busy !== null} pdfBusy={actions.pdfBusy} linkCopied={actions.linkCopied} onAction={handleAction}
        titleField={<h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{detail.title}</h1>}
      />
      <ProposalColumns main={main} aside={aside} />

      {dialog === 'preview' && <ContractPreviewModal kind="detail" source={detail} onClose={() => setDialog(null)} />}
      {dialog === 'withdraw' && (
        <WithdrawContractDialog
          contractId={detail.id} onClose={() => setDialog(null)} onStale={onNotDraft} onReload={onReload}
          onWithdrawn={(data) => onApplyDetail(data, { type: 'success', text: OWNER_COPY.withdrawn(data.contract_number) })}
        />
      )}
    </div>
  )
}
