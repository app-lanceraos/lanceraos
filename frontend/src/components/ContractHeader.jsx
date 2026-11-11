// src/components/ContractHeader.jsx
//
// The header of every contract page: back link, title (an input for a draft, a heading otherwise), status, number and the
// actions for the contract's status. WHICH actions appear comes from availableActions() in contractLifecycle.js (pinned to
// what the backend allows); this file only draws them: one primary accent button, ghost buttons, and the rest inside "More
// actions". Written beside ProposalHeader.jsx rather than reusing it because that component is bound to the Proposals
// action table, status badge and back link (Prompt 23, "Disagreements with the prompt").
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Eye, FileDown, Link2, MoreHorizontal, Send, Trash2, Undo2 } from 'lucide-react'

import ContractStatusBadge from '@/components/ContractStatusBadge'
import DropdownMenu from '@/components/DropdownMenu'
import { OWNER_COPY } from '@/pages/contractCopy'
import { availableActions } from '@/pages/contractLifecycle'

const ICONS = { send: Send, preview: Eye, copy_link: Link2, withdraw: Undo2, duplicate: Copy, delete: Trash2, pdf: FileDown }

/**
 * @param {object} props
 * @param {object} props.detail
 * @param {React.ReactNode} props.titleField
 * @param {React.ReactNode} [props.saveIndicator]
 * @param {(key: string) => void} props.onAction - called with an action key
 * @param {boolean} [props.disabled] - every action is disabled (something is running)
 * @param {boolean} [props.preparing] - the Send button shows "Saving…"
 * @param {boolean} [props.pdfBusy] - the PDF action shows "Preparing…"
 * @param {boolean} [props.linkCopied] - Copy link shows a check for a moment
 */
export default function ContractHeader({
  detail, titleField, saveIndicator, onAction, disabled = false, preparing = false, pdfBusy = false, linkCopied = false,
}) {
  const actions = availableActions(detail)
  const labelFor = (key) => (key === 'send' && preparing ? OWNER_COPY.actionBusy.send
    : key === 'pdf' && pdfBusy ? OWNER_COPY.actionBusy.pdf
      : key === 'copy_link' && linkCopied ? OWNER_COPY.copied
        : OWNER_COPY.actions[key])
  const menuItems = actions.filter((a) => a.placement === 'menu').map((a) => ({
    key: a.key, label: labelFor(a.key), Icon: ICONS[a.key], onClick: () => onAction(a.key), danger: a.danger,
    disabled: disabled || (a.key === 'pdf' && pdfBusy),
  }))

  function renderButton(action, className) {
    const Icon = action.key === 'copy_link' && linkCopied ? Check : ICONS[action.key]
    const busy = (action.key === 'send' && preparing) || (action.key === 'pdf' && pdfBusy)
    return (
      <button key={action.key} type="button" className={className} onClick={() => onAction(action.key)} disabled={disabled || busy}>
        {busy ? <span className="fos-spinner" aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
        {labelFor(action.key)}
      </button>
    )
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <Link to="/contracts" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12, minHeight: 24, fontSize: '0.82rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
        <ArrowLeft size={14} aria-hidden="true" /> {OWNER_COPY.listTitle}
      </Link>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>{titleField}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 40 }}>
          <ContractStatusBadge status={detail.status} expired={detail.is_expired} />
          {detail.contract_number && <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{detail.contract_number}</span>}
          {actions.filter((a) => a.placement === 'secondary').map((a) => renderButton(a, 'fos-btn fos-btn-ghost'))}
          {actions.filter((a) => a.placement === 'primary').map((a) => renderButton(a, 'fos-btn fos-btn-accent'))}
          {menuItems.length > 0 && (
            <DropdownMenu
              trigger={<MoreHorizontal size={17} />} triggerLabel="More actions" bareTrigger
              triggerStyle={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', border: '1.5px solid var(--border-subtle)' }}
              items={menuItems}
            />
          )}
        </div>
      </div>
      {saveIndicator && <div style={{ marginTop: 8 }}>{saveIndicator}</div>}
    </div>
  )
}
