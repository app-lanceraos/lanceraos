// src/components/ProposalSentPage.jsx
//
// A proposal that is no longer a draft: header actions for its status (copy
// link, preview, withdraw, create invoice, duplicate), the read-only document,
// and the dialogs those actions open. WHICH actions appear is availableActions()
// in proposalLifecycle.js; everything shown is the server's own detail.
import { useState } from 'react'

import useProposalActions from '@/hooks/useProposalActions'
import ConvertProposalDialog from '@/components/ConvertProposalDialog'
import ProposalBanners from '@/components/ProposalBanners'
import ProposalHeader from '@/components/ProposalHeader'
import ProposalPreviewModal from '@/components/ProposalPreviewModal'
import ProposalReadOnlyView from '@/components/ProposalReadOnlyView'
import WithdrawProposalDialog from '@/components/WithdrawProposalDialog'

/**
 * @param {object} props
 * @param {object} props.detail
 * @param {object} props.banners - { flash, onDismissFlash, notice, onDismissNotice }
 * @param {(text?: string) => void} props.onNotDraft - reload the real state, optionally with a notice
 * @param {(data: object, notice: object) => void} props.onApplyDetail
 * @param {() => void} props.onReload
 */
export default function ProposalSentPage({ detail, banners, onNotDraft, onApplyDetail, onReload }) {
  const actions = useProposalActions({ detail, onNotDraft })
  const [dialog, setDialog] = useState(null) // null | 'withdraw' | 'convert' | 'preview'

  function handleAction(key) {
    if (key === 'duplicate') actions.duplicate()
    else if (key === 'copy_link') actions.copyLink()
    else setDialog(key)
  }

  return (
    <div style={{ maxWidth: 1180 }}>
      <ProposalBanners {...banners} message={actions.message} onDismissMessage={actions.clear} />
      <ProposalHeader
        detail={detail} disabled={actions.busy !== null} linkCopied={actions.linkCopied} onAction={handleAction}
        titleField={<h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{detail.title}</h1>}
      />
      <ProposalReadOnlyView detail={detail} />

      {dialog === 'preview' && <ProposalPreviewModal kind="detail" source={detail} onClose={() => setDialog(null)} />}
      {dialog === 'withdraw' && (
        <WithdrawProposalDialog
          proposalId={detail.id} onClose={() => setDialog(null)} onStale={onNotDraft} onReload={onReload}
          onWithdrawn={(data) => onApplyDetail(data, { type: 'success', text: "Proposal withdrawn. Your client's link now shows it as withdrawn." })}
        />
      )}
      {dialog === 'convert' && <ConvertProposalDialog detail={detail} onClose={() => setDialog(null)} onNotAccepted={onNotDraft} />}
    </div>
  )
}
