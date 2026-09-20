// src/components/InvoiceRowQuickActions.jsx
//
// Per-Row Quick Actions pass (20 September 2026) — a real, deliberate
// partial reversal of the InvoiceDetailPanel redesign's own "the whole
// row opens the panel, no dedicated Action column" decision (see
// InvoiceTable.jsx's own header comment and DECISIONS.md's "Invoice
// list — the whole row opens the panel" entry). That decision itself is
// unchanged — clicking anywhere on a row still opens the detail panel —
// but common utility/destructive actions (Cancel, Refund, Mark Bad Debt,
// Duplicate, Undo Payment, Delete, Resend Invoice, Pause/Resume
// Recurring, Copy Invoice Link, Download Invoice) no longer require
// opening it first.
//
// Every action's ELIGIBILITY rule (which status(es), payment state,
// recurring state) is read from invoiceHelpers.js's shared canX(invoice)
// exports — the exact same functions InvoiceDetailPanel.jsx's own footer/
// More menu now reads too, not a second, independently hand-rolled copy.
// See that file's own NO_PAYMENT_STATUSES precedent (audit finding
// INV-009/FE-001) for why this matters: a hand-rolled second copy of an
// eligibility rule is exactly how that bug happened.
//
// Every action that needs a confirmation/input modal reuses the EXACT
// modal component InvoiceDetailPanel.jsx already built and exports for
// this purpose (ConfirmModal for Cancel/Mark Bad Debt/Delete, RefundModal,
// UndoPaymentModal, ResendModal) — one shared refund-amount/undo-payment/
// resend UI, not a second one maintained here.
//
// Deliberately NOT included here (out of scope, not overlooked): Save as
// Preset, Change Due Date, Formal Notice, and Edit Series — each needs
// richer context (a kill-switch setting, an interval choice, a curation
// step) that fits "open the panel first" better than a single-click quick
// action; and every footer PRIMARY action (Finalise, Send, Mark as Sent,
// Add Payment, Send Reminder N) — those are the panel's own main
// forward-progression actions, not the "common action that shouldn't
// need the full panel" utility tier this menu covers. See DECISIONS.md.
import { useState } from 'react'
import { Ban, Copy, Download, Link2, MoreVertical, Pause, Play, RefreshCw, ShieldAlert, Trash2, Undo2 } from 'lucide-react'

import api from '@/lib/api'
import DropdownMenu from './DropdownMenu'
import { ConfirmModal, RefundModal, ResendModal, UndoPaymentModal } from './InvoiceDetailPanel'
import {
  canCancelInvoice, canCopyInvoiceLink, canDeleteInvoice, canDownloadInvoice, canDuplicateInvoice,
  canMarkInvoiceBadDebt, canPauseResumeRecurring, canRefundInvoice, canResendInvoice, canUndoInvoicePayment,
  daysSince, findLastPaymentEvent,
} from '@/pages/invoiceHelpers'

export default function InvoiceRowQuickActions({ invoice, onChanged, onError }) {
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState(null)

  async function run(fn, errorFallback = 'Action failed. Please try again.') {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      const body = e.response?.data
      const fieldError = body && typeof body === 'object'
        ? Object.values(body).find((v) => Array.isArray(v) && v.length)?.[0]
        : null
      onError?.(body?.error || fieldError || errorFallback)
    } finally {
      setBusy(false)
    }
  }

  const handleDuplicate = () => run(async () => {
    const { data } = await api.post(`/invoices/${invoice.id}/duplicate/`)
    onChanged?.(data)
  }, 'Could not duplicate this invoice.')

  const handleCopyLink = () => run(async () => {
    await navigator.clipboard.writeText(invoice.portal_view_url)
  }, 'Could not copy the link.')

  const handleDownload = () => run(async () => {
    const res = await api.get(`/invoices/${invoice.id}/pdf/`, { responseType: 'blob' })
    const blobUrl = URL.createObjectURL(res.data)
    const match = /filename="?([^"]+)"?/i.exec(res.headers['content-disposition'] || '')
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = match ? match[1] : `${invoice.invoice_number || 'invoice'}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(blobUrl)
  }, 'Could not download the PDF.')

  const handlePauseResume = () => run(async () => {
    const path = invoice.recurring_paused ? 'resume-recurring' : 'pause-recurring'
    const { data } = await api.post(`/invoices/${invoice.id}/${path}/`)
    onChanged?.(data)
  }, 'Could not update the recurring series.')

  const handleCancel = () => run(async () => {
    const { data } = await api.post(`/invoices/${invoice.id}/cancel/`)
    onChanged?.(data)
    setModal(null)
  }, 'Could not cancel this invoice.')

  const handleBadDebt = () => run(async () => {
    const { data } = await api.post(`/invoices/${invoice.id}/bad-debt/`)
    onChanged?.(data)
    setModal(null)
  }, 'Could not mark this invoice as bad debt.')

  const handleRefund = (amount) => run(async () => {
    const { data } = await api.post(`/invoices/${invoice.id}/refund/`, { amount })
    onChanged?.(data)
    setModal(null)
  }, 'Could not record the refund.')

  const handleUndoPayment = (confirmedOld) => run(async () => {
    const { data } = await api.delete(`/invoices/${invoice.id}/payments/undo/`, { data: confirmedOld ? { confirmed_old: true } : {} })
    onChanged?.(data)
    setModal(null)
  }, 'Could not undo the payment.')

  const handleDelete = () => run(async () => {
    await api.delete(`/invoices/${invoice.id}/`)
    onChanged?.(null, { deleted: true, id: invoice.id })
    setModal(null)
  }, 'Could not delete this invoice.')

  const handleResend = () => run(async () => {
    const { data } = await api.post(`/invoices/${invoice.id}/resend/`, { confirm: true })
    onChanged?.(data)
    setModal(null)
  }, 'Could not resend this invoice.')

  // Undo Payment needs the most recently recorded payment (amount/
  // timestamp) and its age, the same two values InvoiceDetailPanel.jsx's
  // own requestUndoPayment derives from its already-loaded `timeline`
  // array — a list row has no timeline loaded at all, so this fetches it
  // fresh, on demand, only when the action is actually clicked (never
  // eagerly per row). findLastPaymentEvent/daysSince are the exact same
  // shared helpers the panel uses, not a re-derived copy.
  async function requestUndoPayment() {
    setBusy(true)
    try {
      const { data } = await api.get(`/invoices/${invoice.id}/timeline/`)
      const lastPayment = findLastPaymentEvent(data.results || [])
      const age = lastPayment ? daysSince(lastPayment.timestamp) : null
      setModal({ kind: 'undo', lastPayment, age })
    } catch {
      onError?.('Could not load payment history. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const items = []
  if (canDuplicateInvoice(invoice)) {
    items.push({ key: 'duplicate', label: 'Duplicate', Icon: Copy, onClick: handleDuplicate })
  }
  if (canCopyInvoiceLink(invoice)) {
    items.push({ key: 'copy_link', label: 'Copy Invoice Link', Icon: Link2, onClick: handleCopyLink })
  }
  if (canDownloadInvoice(invoice)) {
    items.push({ key: 'download', label: 'Download Invoice', Icon: Download, onClick: handleDownload })
  }
  if (canResendInvoice(invoice)) {
    items.push({ key: 'resend', label: 'Resend Invoice', Icon: RefreshCw, onClick: () => setModal({ kind: 'resend' }) })
  }
  if (canPauseResumeRecurring(invoice)) {
    items.push({
      key: 'pause_resume', label: invoice.recurring_paused ? 'Resume Recurring' : 'Pause Recurring',
      Icon: invoice.recurring_paused ? Play : Pause, onClick: handlePauseResume,
    })
  }
  if (canRefundInvoice(invoice)) {
    items.push({ key: 'refund', label: 'Refund', Icon: Undo2, danger: true, onClick: () => setModal({ kind: 'refund' }) })
  }
  if (canUndoInvoicePayment(invoice)) {
    items.push({ key: 'undo_payment', label: 'Undo Payment', Icon: Undo2, onClick: requestUndoPayment })
  }
  if (canCancelInvoice(invoice)) {
    items.push({ key: 'cancel', label: 'Cancel', Icon: Ban, danger: true, onClick: () => setModal({ kind: 'cancel' }) })
  }
  if (canMarkInvoiceBadDebt(invoice)) {
    items.push({ key: 'bad_debt', label: 'Mark Bad Debt', Icon: ShieldAlert, danger: true, onClick: () => setModal({ kind: 'bad_debt' }) })
  }
  if (canDeleteInvoice(invoice)) {
    items.push({ key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onClick: () => setModal({ kind: 'delete' }) })
  }

  if (items.length === 0) return null

  return (
    <>
      <DropdownMenu
        trigger={<MoreVertical size={15} strokeWidth={1.7} />}
        triggerLabel={`Actions for ${invoice.invoice_number || 'this invoice'}`}
        bareTrigger
        triggerStyle={{ width: 28, height: 28, borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)' }}
        items={items.map((item) => ({ ...item, disabled: busy }))}
      />

      {modal?.kind === 'cancel' && (
        <ConfirmModal
          title="Cancel this invoice?" body="The invoice will move to Cancelled. Any payments already recorded stay on record."
          confirmLabel="Cancel Invoice" danger busy={busy} onConfirm={handleCancel} onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'bad_debt' && (
        <ConfirmModal
          title="Mark as bad debt?" body="Use this once you no longer expect to collect payment for this invoice."
          confirmLabel="Mark Bad Debt" danger busy={busy} onConfirm={handleBadDebt} onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'delete' && (
        <ConfirmModal
          title={`Delete ${invoice.invoice_number || 'this draft'}?`} body="This permanently removes the invoice. This cannot be undone."
          confirmLabel="Delete" danger busy={busy} onConfirm={handleDelete} onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'refund' && (
        <RefundModal invoice={invoice} busy={busy} onConfirm={handleRefund} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'undo' && (
        <UndoPaymentModal age={modal.age} lastPayment={modal.lastPayment} busy={busy} onConfirm={handleUndoPayment} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'resend' && (
        <ResendModal invoice={invoice} busy={busy} onConfirm={handleResend} onClose={() => setModal(null)} />
      )}
    </>
  )
}
