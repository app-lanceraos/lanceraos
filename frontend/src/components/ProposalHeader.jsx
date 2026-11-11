// src/components/ProposalHeader.jsx
//
// The header of every proposal page: back link, title (an input for a draft,
// a heading otherwise), status, number, and the actions for the proposal's
// status. WHICH actions appear comes from availableActions() in
// proposalLifecycle.js (pinned to what the backend allows); this file only
// draws them: one primary accent button, ghost buttons, and the rest inside
// "More actions".
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Copy, ExternalLink, Eye, FileSignature, FileText, Link2, MoreHorizontal, Send, Trash2, Undo2 } from 'lucide-react'

import DropdownMenu from '@/components/DropdownMenu'
import ProposalStatusBadge from '@/components/ProposalStatusBadge'
import { availableActions } from '@/pages/proposalLifecycle'

const ICONS = {
  send: Send, preview: Eye, copy_link: Link2, withdraw: Undo2, convert: FileText,
  open_invoice: ExternalLink, duplicate: Copy, delete: Trash2, create_contract: FileSignature,
}
const LABELS = {
  send: 'Send', preview: 'Preview', copy_link: 'Copy link', withdraw: 'Withdraw', convert: 'Create invoice',
  open_invoice: 'Open invoice', duplicate: 'Duplicate', delete: 'Delete', create_contract: 'Create contract',
}

/**
 * @param {object} props
 * @param {object} props.detail
 * @param {React.ReactNode} props.titleField
 * @param {React.ReactNode} [props.saveIndicator]
 * @param {(key: string) => void} props.onAction - called with an action key
 * @param {boolean} [props.disabled] - every action is disabled (something is running)
 * @param {boolean} [props.preparing] - the Send button shows "Saving…"
 * @param {boolean} [props.linkCopied] - Copy link shows a check for a moment
 */
export default function ProposalHeader({ detail, titleField, saveIndicator, onAction, disabled = false, preparing = false, linkCopied = false }) {
  const actions = availableActions(detail)
  const menuItems = actions.filter((a) => a.placement === 'menu').map((a) => ({
    key: a.key, label: LABELS[a.key], Icon: ICONS[a.key], onClick: () => onAction(a.key), danger: a.danger, disabled,
  }))

  function renderButton(action, className) {
    const Icon = action.key === 'copy_link' && linkCopied ? Check : ICONS[action.key]
    if (action.key === 'open_invoice') {
      return (
        <Link key={action.key} to={`/invoices?invoice=${detail.converted_invoice}`} className={className}>
          <Icon size={15} /> {LABELS.open_invoice}
        </Link>
      )
    }
    const sending = action.key === 'send' && preparing
    return (
      <button key={action.key} type="button" className={className} onClick={() => onAction(action.key)} disabled={disabled || sending}>
        {sending ? <span className="fos-spinner" aria-hidden="true" /> : <Icon size={15} />}
        {sending ? 'Saving…' : action.key === 'copy_link' && linkCopied ? 'Copied' : LABELS[action.key]}
      </button>
    )
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <Link to="/proposals" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: '0.82rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
        <ArrowLeft size={14} /> Proposals
      </Link>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>{titleField}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 40 }}>
          <ProposalStatusBadge status={detail.status} expired={detail.is_expired} />
          {detail.proposal_number && <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{detail.proposal_number}</span>}
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
