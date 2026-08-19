// src/components/InvoiceDetailPanel.jsx
//
// Slide-in side panel for a single invoice — mirrors ClientDetailPanel.jsx's
// exact pattern (DESIGN.md Section 7's slide-in recipe, overlay z-index 100,
// panel z-index 101, maxWidth widened past the recipe's 480 example for the
// same "more content needs room" reason ClientDetailPanel widened to 600).
// Lives in components/, not pages/, for the identical reason
// ClientDetailPanel does: Invoices.jsx mounts it conditionally, it is never
// routed directly.
//
// Redesigned this round (bug-hardening round 2 — see DECISIONS.md for the
// full reasoning on every item below):
//   - Preview-as-Client (the iframe/modal) is REMOVED entirely — "View
//     Invoice" now opens the real, live portal_invoice_view_html page
//     directly (same URL apps/invoices/models.py's Invoice.portal_view_url
//     property builds). The freelancer-own-session guard
//     (apps.clients.portal.is_freelancer_previewing_portal) that protects
//     THAT endpoint is backend-only and untouched by this removal — see
//     apps/invoices/tests/test_portal.py's own regression test for direct
//     proof it still suppresses the Sent->Viewed transition, InvoiceViewEvent
//     logging, and comment seen-marking when a freelancer opens this exact
//     button while also signed into their own LanceraOS account.
//   - Header: Close top-right, invoice #+status badge top-left, a real
//     "X days remaining"/"X days overdue" countdown subtitle
//     (invoiceHelpers.dueDateCountdown), and a "View Invoice" quick-access
//     button next to Close.
//   - Details tab reordered: Client Info -> Invoice/Due Date -> Line Items
//     (+ Subtotal/Total) -> Payment Terms/Currency -> Payment Status
//     (progress bar, only when partially paid) -> Reminders section.
//   - Reminders: exactly one of {a top warning banner with a real "Turn on
//     reminders" button, a plain on/off toggle in the Details tab} shows at
//     a time — never both, matching REMINDERS_HIDDEN_STATUSES on terminal
//     invoices exactly as before.
//   - Footer collapsed to a fixed primary/secondary pair per status (see
//     the table in this round's own build notes) plus a "More" dropdown
//     hosting every other existing action (Duplicate/Save as Preset/
//     Change Due Date/Copy Invoice Link/Download/Refund/Undo Payment/
//     Cancel/Bad Debt/Formal Notice/Delete) PLUS the new "Resend Invoice".
//     "Send Reminder N" targets the next ungenerated reminder number,
//     computed from invoice.reminder_count (kept in sync with the real
//     InvoiceReminder row count on both the manual and scheduled paths —
//     see apps/invoices/tasks.py's _send_reminder); once exhausted (N>4)
//     the secondary action falls back to "View Invoice" instead of
//     disappearing into a disabled state, matching this panel's own
//     established "absent, not disabled" convention.
//   - Tabs reordered: Details, Timeline, Claims, Comments (Comments last).
//     Comments tab has its own fixed-header/scrollable-thread/fixed-input
//     internal layout (CommentThread.jsx already implements the
//     scrollable-thread/fixed-input half internally; this panel now gives
//     it a real flexible height to work with instead of a fixed 420px box).
//
// Overdue is never a status value (see apps/invoices/models.py's
// days_overdue docstring) — every status badge here is rendered alongside a
// separate, orthogonal Overdue badge computed from invoice.days_overdue,
// never merged into or replacing the real status.
import { useEffect, useState } from 'react'
import {
  X, Send, Mail, CheckCircle2, Wallet, Undo2, Ban, ShieldAlert, Copy, BookmarkPlus,
  Check, AlertTriangle, Pause, Play, Bell, BellOff, Trash2, Clock, Eye, Receipt, FileText, MessageCircle,
  Landmark, XCircle, UserCheck, AlertOctagon, Gavel, Settings2, ExternalLink, Download, RefreshCw,
  CalendarClock, Link2,
} from 'lucide-react'

import api from '@/lib/api'
import useAuthStore from '@/store/authStore'
import useTimedMessage from '@/hooks/useTimedMessage'
import useInvoiceAutosave from '@/hooks/useInvoiceAutosave'
import { initTooltipBindings } from '@/hooks/useAppTooltip'
import CommentThread from './CommentThread'
import DropdownMenu from './DropdownMenu'
import ErrorBoundary from './ErrorBoundary'
import FormField from './FormField'
import FormSelect from './FormSelect'
import FosAlert from './FosAlert'
import InvoiceFormFields from './InvoiceFormFields'
import InvoiceStatusBadge from './InvoiceStatusBadge'
import {
  INVOICE_STATUS_META, OVERDUE_BADGE, STATUS_BADGE_STYLE, badgeBaseStyle, formatMoney,
  PAYMENT_SOURCE_OPTIONS, RECURRING_INTERVAL_OPTIONS, REMINDERS_HIDDEN_STATUSES, UNDO_CONFIRMATION_AGE_DAYS,
  daysSince, dueDateCountdown, getSendBannerCopy, invoiceToForm, timelineDotColor, timelineLabel,
} from '@/pages/invoiceHelpers'

const ACTIVE_STATUSES = ['sent', 'viewed', 'partially_paid']
// Audit fix (LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md, 19 August
// 2026, finding INV-009/FE-001): this constant existed but was dead code
// — the actual "Undo Payment" More-menu gate was a separately hand-rolled
// `!['cancelled', 'bad_debt'].includes(...)` that had drifted from this
// list and omitted 'refunded', making Undo Payment reachable (and, before
// the matching backend fix in apps/invoices/views.py's
// invoice_undo_payment, actually destructive) on a refunded invoice —
// live-reproduced on invoice 76472345-cdb5-4800-a2f0-6cc8ba1547e8 /
// INV-2026-0025. This list is now the ONE place that decision lives; the
// gate below reads it directly instead of re-deriving its own copy.
// Matches invoice_add_payment/invoice_mark_paid/invoice_undo_payment's
// own status guard on the backend exactly — keep both in sync.
const NO_PAYMENT_STATUSES = ['cancelled', 'bad_debt', 'refunded', 'draft']
// REMINDERS_HIDDEN_STATUSES lives in invoiceHelpers.js — imported above,
// not redefined here — so RemindersOffBanner/the Details-tab toggle and
// getSendBannerCopy can never drift apart again (bug-fix round; see that
// file's own comment for the real bug this originally fixed).

// initialTab: opens directly on a specific tab instead of the 'details'
// default. Real consumer: Invoices.jsx's notification click-through (a
// comment/claim notification should land on that invoice's Comments/
// Claims tab, not just the invoice's default view). Falls back to
// 'details' for any value that isn't one of TabButton's own real keys.
const VALID_TABS = ['details', 'timeline', 'claims', 'comments']

export default function InvoiceDetailPanel({ invoiceId, onClose, onChanged, onPresetSaved, initialMessage, onInitialMessageShown, initialTab }) {
  const formalNoticeEnabled = useAuthStore((s) => s.user?.formal_notice_enabled ?? true)
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [timeline, setTimeline] = useState([])
  const [timelineLoaded, setTimelineLoaded] = useState(false)
  const [claims, setClaims] = useState([])
  const [activeTab, setActiveTab] = useState(VALID_TABS.includes(initialTab) ? initialTab : 'details')

  // ── Autosave (Gmail-compose-style, entire time an invoice is
  // status='draft' — matches is_editable exactly). There is no separate
  // "editing" toggle: a draft invoice's form fields ARE the invoice, live.
  const [form, setForm] = useState(null)
  const {
    saveState, saveErrors, setSaveErrors, flushPendingSave, skipNextAutosave,
  } = useInvoiceAutosave(invoiceId, form, invoice?.status === 'draft', setInvoice)

  const [busyKey, setBusyKey] = useState(null)
  const { message: toast, show: showToast, clear: clearToast } = useTimedMessage()

  const [modal, setModal] = useState(null)

  useEffect(() => { loadInvoice() }, [invoiceId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialMessage) {
      const { type, text } = typeof initialMessage === 'string' ? { type: 'success', text: initialMessage } : initialMessage
      showToast(type, text)
      onInitialMessageShown?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage])
  useEffect(() => { loadTimeline() }, [invoiceId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadClaims() }, [invoiceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tooltips — AppShell.jsx is the only OTHER place in this codebase that
  // ever calls initTooltipBindings(); this panel's own [data-tooltip]
  // icon buttons (the bare Close (X) button, every modal's own close
  // button) were never wired at all before. Idempotent
  // (dataset.tooltipBound guards re-binding) and cheap, so re-running it
  // after every render — including tab switches and modal open/close,
  // both of which mount fresh [data-tooltip] elements — is safe.
  useEffect(() => { initTooltipBindings() })

  async function handleClose() {
    const flushed = await flushPendingSave()
    const latest = flushed || invoice
    if (latest) notifyChanged(latest)
    onClose()
  }

  async function loadInvoice() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get(`/invoices/${invoiceId}/`)
      setInvoice(data)
      if (data.status === 'draft') {
        skipNextAutosave()
        setForm(invoiceToForm(data))
      } else {
        setForm(null)
      }
    } catch {
      setError('Failed to load this invoice. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function loadTimeline() {
    try {
      const { data } = await api.get(`/invoices/${invoiceId}/timeline/`)
      setTimeline(data.results || [])
    } catch {
      setTimeline([])
    } finally {
      setTimelineLoaded(true)
    }
  }

  async function loadClaims() {
    try {
      const { data } = await api.get(`/invoices/${invoiceId}/claims/`)
      setClaims(data || [])
    } catch {
      setClaims([])
    }
  }

  function notifyChanged(updated) {
    onChanged?.(updated)
  }

  async function runAction(key, fn, successMsg) {
    setBusyKey(key)
    try {
      await fn()
      if (successMsg) showToast('success', successMsg)
    } catch (e) {
      const body = e.response?.data
      const fieldError = body && typeof body === 'object'
        ? Object.values(body).find((v) => Array.isArray(v) && v.length)?.[0]
        : null
      showToast('error', body?.error || fieldError || 'Action failed. Please try again.')
    } finally {
      setBusyKey(null)
    }
  }

  const handleFinalise = () => runAction('finalise', async () => {
    await flushPendingSave()
    const { data } = await api.post(`/invoices/${invoiceId}/finalise/`)
    setInvoice(data); setForm(null); notifyChanged(data)
  }, 'Invoice finalised.')

  const handleDelete = () => runAction('delete', async () => {
    await api.delete(`/invoices/${invoiceId}/`)
    onChanged?.(null, { deleted: true })
    onClose()
  })

  const handleMarkSent = (sendReminders) => runAction('mark_sent', async () => {
    await flushPendingSave()
    const { data } = await api.post(`/invoices/${invoiceId}/mark-sent/`, { confirm: true, send_reminders: sendReminders })
    setInvoice(data); setForm(null); notifyChanged(data); setModal(null)
  }, 'Marked as sent.')

  const handleSend = () => runAction('send', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/send/`, { confirm: true })
    setInvoice(data); notifyChanged(data); setModal(null)
    await loadTimeline()
  }, 'Invoice sent.')

  const handleMarkPaid = (form) => runAction('mark_paid', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/mark-paid/`, form)
    setInvoice(data); notifyChanged(data); setModal(null)
    await loadTimeline()
  }, 'Invoice marked as paid.')

  const handleAddPayment = (form) => runAction('add_payment', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/payments/`, form)
    setInvoice(data); notifyChanged(data); setModal(null)
    await loadTimeline()
  }, 'Payment recorded.')

  const handleConfirmClaim = (claimId) => runAction('confirm_claim', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/claims/${claimId}/confirm/`, { confirm: true })
    setInvoice(data.invoice); notifyChanged(data.invoice); setModal(null)
    await loadTimeline(); await loadClaims()
  }, 'Claim confirmed — payment recorded.')

  const handleRejectClaim = (claimId, reviewNote) => runAction('reject_claim', async () => {
    await api.post(`/invoices/${invoiceId}/claims/${claimId}/reject/`, { confirm: true, review_note: reviewNote })
    setModal(null)
    await loadClaims()
  }, 'Claim rejected.')

  const handleUndoPayment = (confirmedOld) => runAction('undo_payment', async () => {
    const { data } = await api.delete(`/invoices/${invoiceId}/payments/undo/`, { data: confirmedOld ? { confirmed_old: true } : {} })
    setInvoice(data); notifyChanged(data); setModal(null)
    await loadTimeline()
  }, 'Payment undone.')

  const handleCancel = () => runAction('cancel', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/cancel/`)
    setInvoice(data); notifyChanged(data); setModal(null)
  }, 'Invoice cancelled.')

  const handleRefund = (amount) => runAction('refund', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/refund/`, { amount })
    setInvoice(data); notifyChanged(data); setModal(null)
  }, 'Refund recorded.')

  const handleBadDebt = () => runAction('bad_debt', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/bad-debt/`)
    setInvoice(data); notifyChanged(data); setModal(null)
  }, 'Marked as bad debt.')

  const handleDuplicate = () => runAction('duplicate', async () => {
    await flushPendingSave()
    const { data } = await api.post(`/invoices/${invoiceId}/duplicate/`)
    notifyChanged(data)
  }, 'Duplicated as a new draft.')

  const handleToggleReminders = () => runAction('toggle_reminders', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/toggle-reminders/`)
    setInvoice(data); notifyChanged(data)
  })

  const handlePauseResume = () => runAction('recurring', async () => {
    const path = invoice.recurring_paused ? 'resume-recurring' : 'pause-recurring'
    const { data } = await api.post(`/invoices/${invoiceId}/${path}/`)
    setInvoice(data); notifyChanged(data)
  })

  const handleUpdateSeries = (intervalDays, autoSend) => runAction('update_series', async () => {
    const { data } = await api.put(`/invoices/${invoiceId}/`, {
      recurring_interval_days: intervalDays, recurring_auto_send: autoSend,
    })
    setInvoice(data); notifyChanged(data); setModal(null)
  }, 'Series settings updated.')

  const handleDismissEscalation = () => runAction('dismiss_escalation', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/dismiss-escalation/`)
    setInvoice(data); notifyChanged(data)
  })

  const handleSendFormalNotice = () => runAction('send_formal_notice', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/send-formal-notice/`, { confirm: true })
    setInvoice(data); notifyChanged(data); setModal(null)
    await loadTimeline()
  }, 'Formal notice sent.')

  const handleSaveAsPreset = (name, includeClient) => runAction('save_preset', async () => {
    const flushed = await flushPendingSave()
    const current = flushed || invoice
    const { data } = await api.post('/invoices/presets/', {
      name,
      include_client: includeClient && !!current.client,
      client: includeClient ? current.client : null,
      client_name: current.client_name, client_email: current.client_email, client_company: current.client_company,
      currency: current.currency, tax_rate: current.tax_rate, discount_amount: current.discount_amount,
      payment_terms: 30,
      notes: current.notes, terms: current.terms,
      late_fee_enabled: current.late_fee_enabled, late_fee_rate: current.late_fee_rate,
      items: (current.items || []).map((it) => ({ description: it.description, quantity: it.quantity, unit_price: it.unit_price })),
    })
    onPresetSaved?.(data)
    setModal(null)
  }, 'Saved as a preset.')

  // ── New this round ──────────────────────────────────────────────
  const handleSendReminder = () => runAction('send_reminder', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/send-reminder/`)
    setInvoice(data); notifyChanged(data); setModal(null)
    await loadTimeline()
  }, 'Reminder sent.')

  const handleResend = () => runAction('resend', async () => {
    const { data } = await api.post(`/invoices/${invoiceId}/resend/`, { confirm: true })
    setInvoice(data); notifyChanged(data); setModal(null)
  }, 'Invoice resent.')

  const handleChangeDueDate = (newDueDate) => runAction('change_due_date', async () => {
    const { data } = await api.put(`/invoices/${invoiceId}/`, { due_date: newDueDate })
    setInvoice(data); notifyChanged(data); setModal(null)
  }, 'Due date updated.')

  function requestUndoPayment() {
    const lastPayment = [...timeline].reverse().find((e) => e.type === 'payment')
    const age = lastPayment ? daysSince(lastPayment.timestamp) : null
    setModal({ kind: 'undo', lastPayment, age })
  }

  if (loading) {
    return (
      <>
        <div onClick={onClose} style={overlayStyle} />
        <div style={panelStyle}><div style={{ padding: '20px 24px' }}><PanelSkeleton /></div></div>
      </>
    )
  }

  if (error || !invoice) {
    return (
      <>
        <div onClick={onClose} style={overlayStyle} />
        <div style={panelStyle}>
          <div style={{ padding: '20px 24px' }}>
            <button onClick={onClose} aria-label="Close" data-tooltip="Close" className="fos-btn fos-btn-ghost" style={{ padding: 8, marginBottom: 12 }}><X size={16} /></button>
            <FosAlert type="error">{error || 'Invoice not found.'}</FosAlert>
          </div>
        </div>
      </>
    )
  }

  const meta = INVOICE_STATUS_META[invoice.status] || INVOICE_STATUS_META.draft
  const isOverdue = invoice.days_overdue > 0
  const isDraft = invoice.status === 'draft'
  const isTerminal = REMINDERS_HIDDEN_STATUSES.includes(invoice.status)
  const sendBannerCopy = getSendBannerCopy(invoice)
  const countdown = dueDateCountdown(invoice)
  const busy = busyKey !== null
  // Docked bottom-right above the footer (moved out of DetailsTab's own
  // scrolling flow this round) — same on/toggle-visible-vs-off-banner
  // exclusivity as before, RemindersOffBanner above covers the "off" half.
  const showRemindersToggle = !isDraft && activeTab === 'details' && ACTIVE_STATUSES.includes(invoice.status) && invoice.reminders_enabled

  // The real, backend-built URL (Invoice.portal_view_url — the frontend's
  // own /invoice/:token route, not the raw API host) — never re-derived
  // client-side. Re-deriving it here used to be exactly how the backend
  // host leaked into "View Invoice"/"Copy Invoice Link" even after
  // portal_view_url itself pointed at the frontend — see DECISIONS.md.
  const portalViewUrl = invoice.portal_view_url || null
  const openViewInvoice = () => portalViewUrl && window.open(portalViewUrl, '_blank', 'noopener,noreferrer')
  // Real, reported bug fixed: this used to be a bare window.open(backendUrl,
  // '_blank') — a new tab whose address bar showed the raw API host
  // directly. Fetches as a blob and triggers a same-origin, in-place
  // download instead (matching InvoiceView.jsx's own client-facing
  // Download button) — no new tab, no backend host ever visible anywhere.
  async function downloadInvoicePdf() {
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
  }
  const openDownload = () => runAction('download', downloadInvoicePdf)
  async function copyInvoiceLink() {
    if (!portalViewUrl) return
    try {
      await navigator.clipboard.writeText(portalViewUrl)
      showToast('success', 'Invoice link copied.')
    } catch {
      showToast('error', 'Could not copy the link.')
    }
  }

  const nextReminderNumber = (invoice.reminder_count || 0) + 1
  const remindersExhausted = nextReminderNumber > 4
  // Duplicate is now the footer's own secondary button (replacing View
  // Invoice there — see the footer below) for active-not-currently-
  // overdue-or-reminder-exhausted invoices and every terminal status.
  // NOT for 'created' (Send/Mark as Sent occupy the footer) or an
  // overdue active invoice with reminders still available (Send Reminder
  // N occupies it instead) — Duplicate stays reachable via More only in
  // those two cases.
  const footerShowsDuplicate = !isDraft && (isTerminal || (ACTIVE_STATUSES.includes(invoice.status) && !(isOverdue && !remindersExhausted)))

  // ── More-menu items — every other existing lifecycle/utility action,
  // each only appearing when actually reachable for the current status
  // (never shown-disabled, matching this panel's own established
  // convention throughout). ──
  const moreMenuItems = []
  if (!isDraft) {
    const dueDateEditable = ['created', ...ACTIVE_STATUSES].includes(invoice.status)
    // Skip when the footer already shows it as a real button — this
    // panel's own established rule (see the header's "View Invoice is
    // already reachable from the header — redundant as a footer
    // secondary action" reasoning above): never list the same action
    // twice for one status.
    if (!footerShowsDuplicate) {
      moreMenuItems.push({ key: 'duplicate', label: 'Duplicate', Icon: Copy, onClick: handleDuplicate })
    }
    moreMenuItems.push({ key: 'save_preset', label: 'Save as Preset', Icon: BookmarkPlus, onClick: () => setModal({ kind: 'save_preset' }) })
    if (dueDateEditable) {
      moreMenuItems.push({ key: 'change_due_date', label: 'Change Due Date', Icon: CalendarClock, onClick: () => setModal({ kind: 'change_due_date' }) })
    }
    moreMenuItems.push({ key: 'copy_link', label: 'Copy Invoice Link', Icon: Link2, onClick: copyInvoiceLink })
    if (dueDateEditable) {
      moreMenuItems.push({ key: 'download', label: 'Download Invoice', Icon: Download, onClick: openDownload })
    }
    if (['paid', 'partially_paid'].includes(invoice.status)) {
      moreMenuItems.push({ key: 'refund', label: 'Refund', Icon: Undo2, danger: true, onClick: () => setModal({ kind: 'refund' }) })
    }
    if (Number(invoice.amount_paid) > 0 && !NO_PAYMENT_STATUSES.includes(invoice.status)) {
      moreMenuItems.push({ key: 'undo_payment', label: 'Undo Payment', Icon: Undo2, onClick: requestUndoPayment })
    }
    if (ACTIVE_STATUSES.includes(invoice.status)) {
      moreMenuItems.push({ key: 'resend', label: 'Resend Invoice', Icon: RefreshCw, onClick: () => setModal({ kind: 'resend' }) })
      moreMenuItems.push({ key: 'cancel', label: 'Cancel', Icon: Ban, danger: true, onClick: () => setModal({ kind: 'cancel' }) })
      moreMenuItems.push({ key: 'bad_debt', label: 'Mark Bad Debt', Icon: ShieldAlert, danger: true, onClick: () => setModal({ kind: 'bad_debt' }) })
    }
    if ((invoice.escalation_required || invoice.status === 'bad_debt') && formalNoticeEnabled) {
      moreMenuItems.push({ key: 'formal_notice', label: 'Formal Notice', Icon: Gavel, danger: true, onClick: () => setModal({ kind: 'formal_notice' }) })
    }
    if (invoice.status === 'created') {
      moreMenuItems.push({ key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onClick: () => setModal({ kind: 'delete' }) })
    }
  }

  return (
    <>
      <div onClick={handleClose} style={overlayStyle} />
      <div style={panelStyle}>
        {/* ── Fixed top section: close/view, header, banners, tabs ── */}
        <div style={{ flexShrink: 0, padding: '20px 24px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: isDraft ? 16 : 4 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <h2 className="idp-invoice-number" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {invoice.invoice_number || '(unnumbered draft)'}
                </h2>
                <InvoiceStatusBadge meta={meta} />
                {isOverdue && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[OVERDUE_BADGE.statusKey] }}>{OVERDUE_BADGE.label}</span>}
              </div>
              {!isDraft && (
                <p className="idp-due-line" style={{
                  margin: 0, fontSize: '0.82rem',
                  color: countdown?.overdue ? 'var(--status-red-text)' : 'var(--text-tertiary)',
                  fontWeight: countdown?.overdue ? 600 : 400,
                }}>
                  Due {invoice.due_date || '—'}{countdown && ` · ${countdown.text}`}
                </p>
              )}
              {invoice.client_acknowledged && (
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--status-green-text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <UserCheck size={12} /> Acknowledged on {new Date(invoice.client_acknowledged_at).toLocaleDateString()}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {!isDraft && portalViewUrl && (
                <button
                  onClick={openViewInvoice} data-tooltip="View Invoice"
                  className="idp-header-view-invoice fos-btn fos-btn-ghost" style={{ fontSize: '0.76rem' }}
                >
                  <ExternalLink size={13} /> <span className="idp-view-invoice-label">View Invoice</span>
                </button>
              )}
              <button onClick={handleClose} aria-label="Close" data-tooltip="Close" className="fos-btn fos-btn-ghost" style={{ padding: 8 }}>
                <X size={16} />
              </button>
            </div>
          </div>

          {sendBannerCopy && (
            <FosAlert type="warning" style={{ marginBottom: 16 }}>{sendBannerCopy}</FosAlert>
          )}

          <RemindersOffBanner invoice={invoice} busy={busy} onTurnOn={handleToggleReminders} />

          {invoice.escalation_required && !invoice.escalation_dismissed && (
            <FosAlert type="error" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span>This invoice is severely overdue and has gone through the full reminder schedule.</span>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={handleDismissEscalation} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.72rem' }}>Dismiss</button>
                  {formalNoticeEnabled && (
                    <button onClick={() => setModal({ kind: 'formal_notice' })} disabled={busy} className="fos-btn fos-btn-danger" style={{ fontSize: '0.72rem' }}>
                      <Gavel size={12} /> Send Formal Notice
                    </button>
                  )}
                </div>
              </div>
            </FosAlert>
          )}

          {toast && <FosAlert type={toast.type} onDismiss={clearToast} style={{ marginBottom: 16 }}>{toast.text}</FosAlert>}

          {!isDraft && (
            // Real, reported bug (round 2): the previous fix (this row
            // scrolling horizontally) forced a real, needed tab out of
            // sight at 375px, with no visible affordance that scrolling
            // was even possible. .idp-tab-btn's own real padding/font
            // shrink at <=480px (see the <style> block below) is now
            // enough to fit all 4 tabs on one line without scrolling —
            // overflowX:'auto' stays only as a harmless fallback for an
            // unusually long Claims count.
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
              <TabButton icon={Receipt} label="Details" active={activeTab === 'details'} onClick={() => setActiveTab('details')} />
              <TabButton icon={Clock} label="Timeline" active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} />
              <TabButton
                icon={Landmark} label={`Claims${claims.filter((c) => c.status === 'pending').length > 0 ? ` (${claims.filter((c) => c.status === 'pending').length})` : ''}`}
                active={activeTab === 'claims'} onClick={() => setActiveTab('claims')}
              />
              <TabButton icon={MessageCircle} label="Comments" active={activeTab === 'comments'} onClick={() => setActiveTab('comments')} />
            </div>
          )}
        </div>

        {/* ── Flexible middle section — the ONLY scrolling region for every
            tab except Comments, which manages its own internal scroll
            (fixed recap header + scrollable thread + fixed input, all via
            CommentThread.jsx's own layout, just given real height here). ── */}
        <div style={{
          flex: '1 1 0%', minHeight: 0,
          overflow: activeTab === 'comments' && !isDraft ? 'hidden' : 'auto',
          padding: activeTab === 'comments' && !isDraft ? '16px 0 0' : '16px 24px',
        }}>
          {isDraft ? (
            <>
              <SaveStatusIndicator state={saveState} />
              {form && <InvoiceFormFields form={form} setForm={setForm} errors={saveErrors} />}
            </>
          ) : (
            <>
              {activeTab === 'details' && (
                <DetailsTab
                  invoice={invoice} busy={busy}
                  onPauseResume={handlePauseResume}
                  onEditSeries={() => setModal({ kind: 'edit_series' })}
                />
              )}
              {activeTab === 'timeline' && (
                <ErrorBoundary key={invoiceId}>
                  <TimelineTab loaded={timelineLoaded} entries={timeline} />
                </ErrorBoundary>
              )}
              {activeTab === 'claims' && (
                <ClaimsTab
                  claims={claims} busy={busy}
                  onConfirm={(claim) => setModal({ kind: 'confirm_claim', claim })}
                  onReject={(claim) => setModal({ kind: 'reject_claim', claim })}
                />
              )}
              {activeTab === 'comments' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                  <CommentsTabRecap invoice={invoice} />
                  <div style={{ flex: '1 1 0%', minHeight: 0, padding: '0 24px 16px' }}>
                    <CommentThread
                      commentsUrl={`/invoices/${invoiceId}/comments/`}
                      viewToken={invoice.view_token}
                      viewerType="freelancer"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Reminders toggle — docked bottom-right, directly above the
            footer, never scrolling with the rest of the Details tab
            content (position kept from the previous round). Real size
            fix this round: the label was full-size text and the button
            used .fos-btn's own un-shrunk 10px/20px default padding,
            together adding up to a disconnected-looking oversized box —
            shrunk to a real compact pill sized to its actual content
            ("Reminders" as a small secondary label + a small On button),
            matching the footer's own FOOTER_BTN_STYLE density. ── */}
        {showRemindersToggle && (
          <div style={{ flexShrink: 0, padding: '0 24px 8px', display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ padding: '4px 4px 4px 10px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Reminders</span>
              <button onClick={handleToggleReminders} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.68rem', padding: '3px 8px', gap: 3 }}>
                <Bell size={10} /> On
              </button>
            </div>
          </div>
        )}

        {/* ── Fixed footer — a real primary/secondary pair per status, plus
            "More" for everything else. Desktop uses FOOTER_BTN_STYLE, a
            moderate step down from .fos-btn's own 10px/20px/0.88rem
            defaults (not a further, cramped shrink — round 2's own
            0.74rem/7px12px overcorrected and looked too small next to
            the rest of the panel). idp-footer-btn/idp-footer-btn-group
            carry a SEPARATE, real mobile-specific shrink at <=480px (see
            the <style> block below) — round 2's "fits one line" claim
            was never actually checked at real mobile width and, in fact,
            still wrapped there; this round fixes both ends for real,
            independently. ── */}
        <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {isDraft ? (
            <div className="idp-footer-btn-group" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button onClick={handleFinalise} disabled={busy} className="idp-footer-btn fos-btn fos-btn-primary" style={FOOTER_BTN_STYLE}>
                {busyKey === 'finalise' ? <span className="fos-spinner" /> : <CheckCircle2 size={13} />} Finalise
              </button>
              <button onClick={() => setModal({ kind: 'mark_sent' })} disabled={busy} className="idp-footer-btn fos-btn fos-btn-accent" style={FOOTER_BTN_STYLE}>
                <Send size={13} /> Mark as Sent
              </button>
              <button onClick={() => setModal({ kind: 'delete' })} disabled={busy} className="idp-footer-btn fos-btn fos-btn-ghost" style={{ ...FOOTER_BTN_STYLE, color: 'var(--status-red-text)' }}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          ) : (
            <>
              <div className="idp-footer-btn-group" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {invoice.status === 'created' && (
                  <>
                    <button onClick={() => setModal({ kind: 'send' })} disabled={busy} className="idp-footer-btn fos-btn fos-btn-primary" style={FOOTER_BTN_STYLE}>
                      <Mail size={13} /> Send
                    </button>
                    <button onClick={() => setModal({ kind: 'mark_sent' })} disabled={busy} className="idp-footer-btn fos-btn fos-btn-ghost" style={FOOTER_BTN_STYLE}>
                      <Send size={13} /> Mark as Sent
                    </button>
                  </>
                )}
                {ACTIVE_STATUSES.includes(invoice.status) && (
                  <>
                    <button onClick={() => setModal({ kind: 'add_payment' })} disabled={busy} className="idp-footer-btn fos-btn fos-btn-primary" style={FOOTER_BTN_STYLE}>
                      <Wallet size={13} /> Add Payment
                    </button>
                    {isOverdue && !remindersExhausted ? (
                      <button onClick={() => setModal({ kind: 'send_reminder' })} disabled={busy} className="idp-footer-btn fos-btn fos-btn-ghost" style={FOOTER_BTN_STYLE}>
                        <Bell size={13} /> Send Reminder {nextReminderNumber}
                      </button>
                    ) : (
                      // View Invoice is already reachable from the header —
                      // redundant as a footer secondary action. Duplicate
                      // takes its place here (see footerShowsDuplicate).
                      <button onClick={handleDuplicate} disabled={busy} className="idp-footer-btn fos-btn fos-btn-ghost" style={FOOTER_BTN_STYLE}>
                        <Copy size={13} /> Duplicate
                      </button>
                    )}
                  </>
                )}
                {isTerminal && (
                  <>
                    <button onClick={openDownload} disabled={busy} className="idp-footer-btn fos-btn fos-btn-primary" style={FOOTER_BTN_STYLE}>
                      <Download size={13} /> Download Invoice
                    </button>
                    <button onClick={handleDuplicate} disabled={busy} className="idp-footer-btn fos-btn fos-btn-ghost" style={FOOTER_BTN_STYLE}>
                      <Copy size={13} /> Duplicate
                    </button>
                  </>
                )}
              </div>
              {moreMenuItems.length > 0 && (
                <DropdownMenu
                  trigger="More" showChevron placement="top"
                  triggerClassName="idp-footer-btn fos-btn fos-btn-ghost"
                  triggerStyle={FOOTER_BTN_STYLE}
                  items={moreMenuItems}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      {modal?.kind === 'mark_sent' && (
        <MarkSentModal busy={busyKey === 'mark_sent'} onConfirm={handleMarkSent} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'send' && (
        <SendModal invoice={invoice} busy={busyKey === 'send'} onConfirm={handleSend} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'add_payment' && (
        <AddPaymentModal invoice={invoice} busy={busy} busyKey={busyKey} onMarkPaid={handleMarkPaid} onAddPayment={handleAddPayment} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'refund' && (
        <RefundModal invoice={invoice} busy={busyKey === 'refund'} onConfirm={handleRefund} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'undo' && (
        <UndoPaymentModal age={modal.age} lastPayment={modal.lastPayment} busy={busyKey === 'undo_payment'} onConfirm={handleUndoPayment} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'save_preset' && (
        <SavePresetModal hasClient={!!invoice.client} busy={busyKey === 'save_preset'} onConfirm={handleSaveAsPreset} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'cancel' && (
        <ConfirmModal
          title="Cancel this invoice?" body="The invoice will move to Cancelled. Any payments already recorded stay on record."
          confirmLabel="Cancel Invoice" danger busy={busyKey === 'cancel'} onConfirm={handleCancel} onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'bad_debt' && (
        <ConfirmModal
          title="Mark as bad debt?" body="Use this once you no longer expect to collect payment for this invoice."
          confirmLabel="Mark Bad Debt" danger busy={busyKey === 'bad_debt'} onConfirm={handleBadDebt} onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'delete' && (
        <ConfirmModal
          title={`Delete ${invoice.invoice_number || 'this draft'}?`} body="This permanently removes the invoice. This cannot be undone."
          confirmLabel="Delete" danger busy={busyKey === 'delete'} onConfirm={handleDelete} onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'confirm_claim' && (
        <ConfirmModal
          title="Confirm this claim?"
          body={`Records ${formatMoney(modal.claim.amount_claimed, modal.claim.currency)} as a real payment on this invoice via ${modal.claim.payment_source}, using the same payment-recording path as Add Payment.`}
          confirmLabel="Confirm Claim" busy={busyKey === 'confirm_claim'}
          onConfirm={() => handleConfirmClaim(modal.claim.id)} onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'reject_claim' && (
        <RejectClaimModal claim={modal.claim} busy={busyKey === 'reject_claim'} onConfirm={handleRejectClaim} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'edit_series' && (
        <EditSeriesModal invoice={invoice} busy={busyKey === 'update_series'} onConfirm={handleUpdateSeries} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'formal_notice' && (
        <FormalNoticeModal invoice={invoice} busy={busyKey === 'send_formal_notice'} onConfirm={handleSendFormalNotice} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'send_reminder' && (
        <SendReminderModal invoice={invoice} nextReminderNumber={nextReminderNumber} busy={busyKey === 'send_reminder'} onConfirm={handleSendReminder} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'resend' && (
        <ResendModal invoice={invoice} busy={busyKey === 'resend'} onConfirm={handleResend} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'change_due_date' && (
        <ChangeDueDateModal invoice={invoice} busy={busyKey === 'change_due_date'} onConfirm={handleChangeDueDate} onClose={() => setModal(null)} />
      )}

      <style>{`
        /* Real, reported bug (mobile screenshot, 375px): the invoice
           number wrapped onto 2 lines (word-wrap breaking after the
           hyphens in e.g. "INV-2026-0018"), and the due-date/countdown
           line wrapped awkwardly too. Both get real responsive font
           shrink here — never truncation/ellipsis, the full number must
           always be readable. The header's own "View Invoice" button
           drops to icon-only (tooltip carries the label, matching the
           Close button's own established icon-only+tooltip pattern right
           next to it) to free the room the number/countdown need.
           Tabs: Details/Timeline/Claims/Comments used to need horizontal
           scrolling to all be visible at 375px — real padding/font shrink
           here instead, so all 4 fit on one line with no scrolling.
           Footer (round 3): a REAL, separate mobile-specific shrink —
           round 2's single FOOTER_BTN_STYLE object was applied at every
           width via inline style, which can't respond to a media query
           at all, so the "fits one line at 375px" claim was never
           actually true there; verified this round with a real
           screenshot at 375px against the longest real per-status
           combinations (not the hypothetical "Send Reminder 4" + "Mark
           as Sent" combo, which never co-occurs in the real status
           matrix). */
        @media (max-width: 480px) {
          .idp-invoice-number { font-size: 0.98rem !important; white-space: nowrap; }
          .idp-due-line { font-size: 0.72rem !important; white-space: nowrap; }
          .idp-header-view-invoice { padding: 8px !important; }
          .idp-header-view-invoice .idp-view-invoice-label { display: none; }
          .idp-tab-btn { padding: 8px 6px !important; font-size: 0.68rem !important; gap: 4px !important; }
          .idp-tab-btn svg { width: 11px !important; height: 11px !important; }
          .idp-footer-btn { padding: 6px 10px !important; font-size: 0.68rem !important; gap: 4px !important; }
          .idp-footer-btn svg { width: 12px !important; height: 12px !important; }
          .idp-footer-btn-group { gap: 5px !important; }
        }
      `}</style>
    </>
  )
}

const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 100 }
const panelStyle = {
  position: 'fixed', top: 'var(--header-h)', right: 0, bottom: 0, width: '100%', maxWidth: 600,
  background: 'var(--bg-surface)', boxShadow: '-8px 0 32px rgba(0,0,0,0.2)', zIndex: 101,
  animation: 'panel-slide-in 0.2s cubic-bezier(0.22,1,0.36,1)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
}
// Desktop footer button sizing — a moderate step down from .fos-btn's own
// 10px/20px/0.88rem defaults (real primary+secondary+More combinations
// fit fine at this size; a further, cramped shrink read as too small next
// to the rest of the panel — round 3's own fix, see DECISIONS.md). Real
// mobile-specific sizing lives in the .idp-footer-btn CSS class instead
// (this JS object is desktop's baseline only — inline styles can't
// respond to a media query, which is exactly why round 2's one-size
// approach couldn't actually fit 375px without either being globally too
// small or still wrapping).
const FOOTER_BTN_STYLE = { fontSize: '0.82rem', padding: '8px 16px', gap: 7 }

// ── RemindersOffBanner ───────────────────────────────────────────
// Exactly one of {this banner, the docked toggle above the footer} ever
// renders — never both, never neither except a terminal/draft/created
// invoice (nothing left to remind about, or reminders not yet relevant).
// Real compact redesign (round 3): the previous version's own FosAlert
// wrapper was already at this app's normal compact alert density
// (.fos-alert's real 12px/16px padding, 0.875rem font, 16px icon) — the
// actual bulk came from the "Turn on reminders" button underneath it,
// which used .fos-btn's full, un-shrunk 10px/20px default padding and
// sat inside a flexWrap:'wrap' row, so it routinely wrapped onto its own
// full-width line. Fixed by shrinking the button to a real small inline
// pill (own compact padding/font, matching FOOTER_BTN_STYLE's own
// density) and keeping the row on one line — icon + short text + a small
// button, not a stacked block.
function RemindersOffBanner({ invoice, busy, onTurnOn }) {
  if (!ACTIVE_STATUSES.includes(invoice.status)) return null
  if (invoice.reminders_enabled) return null
  return (
    <FosAlert type="warning" style={{ marginBottom: 16, alignItems: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <BellOff size={13} style={{ flexShrink: 0 }} /> Reminders are off
        </span>
        <button onClick={onTurnOn} disabled={busy} className="fos-btn fos-btn-accent" style={{ fontSize: '0.7rem', padding: '4px 10px', gap: 4, flexShrink: 0 }}>
          <Bell size={11} /> Turn on
        </button>
      </div>
    </FosAlert>
  )
}

// ── SaveStatusIndicator ───────────────────────────────────────────
function SaveStatusIndicator({ state }) {
  if (state === 'idle') return null
  const config = {
    saving: { icon: <span className="fos-spinner" />, text: 'Saving…', color: 'var(--text-tertiary)' },
    saved: { icon: <Check size={12} />, text: 'All changes saved', color: 'var(--text-tertiary)' },
    error: { icon: <AlertTriangle size={12} />, text: "Couldn't save — will retry on your next change", color: 'var(--status-red-text)' },
  }[state]
  if (!config) return null
  return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 14px', fontSize: '0.72rem', color: config.color }}>
      {config.icon} {config.text}
    </p>
  )
}

// ── DetailsTab ────────────────────────────────────────────────────
// Reordered this round: Client Info -> Invoice/Due Date -> Line Items
// (+ Subtotal/Total) -> Payment Terms/Currency -> Payment Status
// (progress bar) -> Recurring (if applicable) -> Reminders section.
function DetailsTab({ invoice, busy, onPauseResume, onEditSeries }) {
  const showPaymentProgress = Number(invoice.amount_paid) > 0 && invoice.status !== 'paid'

  return (
    <div>
      {(invoice.client_name || invoice.client_email || invoice.client_company) && (
        <div style={{ marginBottom: 16 }}>
          <p style={sectionLabelStyle}>Client</p>
          <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{invoice.client_name || 'No client yet'}</p>
          {invoice.client_company && <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{invoice.client_company}</p>}
          {invoice.client_email && <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>{invoice.client_email}</p>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={sectionLabelStyle}>Invoice Date</p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{invoice.issue_date || '—'}</p>
        </div>
        <div>
          <p style={sectionLabelStyle}>Due Date</p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{invoice.due_date || '—'}</p>
        </div>
      </div>

      {invoice.items?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={sectionLabelStyle}>Line Items</p>
          {invoice.items.map((it, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.description}</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', flexShrink: 0 }}>{it.quantity} × {formatMoney(it.unit_price, invoice.currency)}</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>{formatMoney(it.total, invoice.currency)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 8, fontSize: '0.8rem' }}>
            {Number(invoice.tax_amount) > 0 && <span style={{ color: 'var(--text-tertiary)' }}>Tax: {formatMoney(invoice.tax_amount, invoice.currency)}</span>}
            {Number(invoice.discount_amount) > 0 && <span style={{ color: 'var(--status-red-text)' }}>Discount: −{formatMoney(invoice.discount_amount, invoice.currency)}</span>}
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(invoice.total, invoice.currency)}</span>
          </div>
        </div>
      )}

      {invoice.notes && (
        <div style={{ marginBottom: 16 }}>
          <p style={sectionLabelStyle}>Notes</p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
        </div>
      )}

      <p style={{ margin: '0 0 16px', fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
        {invoice.terms ? `Payment Terms: ${invoice.terms} · ` : ''}Currency: {invoice.currency}
      </p>

      {invoice.late_fee_enabled && Number(invoice.late_fee_amount) > 0 && (
        <FosAlert type="warning" style={{ marginBottom: 16 }}>+ {formatMoney(invoice.late_fee_amount, invoice.currency)} late fee accrued ({invoice.late_fee_rate}%/month)</FosAlert>
      )}

      {showPaymentProgress && <PaymentProgressBar invoice={invoice} />}

      {invoice.is_recurring && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)' }}>
            {invoice.recurring_paused ? 'Recurring — paused' : `Recurring — next ${invoice.next_recurring_date || 'unscheduled'}`}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            {!invoice.parent_invoice && (
              <button onClick={onEditSeries} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.75rem' }}>
                <Settings2 size={13} /> Edit Series
              </button>
            )}
            <button onClick={onPauseResume} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.75rem' }}>
              {invoice.recurring_paused ? <Play size={13} /> : <Pause size={13} />}
              {invoice.recurring_paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PaymentProgressBar ────────────────────────────────────────────
function PaymentProgressBar({ invoice }) {
  const total = Number(invoice.total) || 0
  const paid = Number(invoice.amount_paid) || 0
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={sectionLabelStyle}>Payment Status</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 6 }}>
        <span style={{ color: 'var(--status-green-text)' }}>Paid {formatMoney(paid, invoice.currency)}</span>
        <span style={{ color: 'var(--status-red-text)' }}>Outstanding {formatMoney(invoice.outstanding_amount, invoice.currency)}</span>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: 'var(--bg-surface-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--status-green)', transition: 'width 0.3s ease' }} />
      </div>
      <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{pct}% paid</p>
    </div>
  )
}

const sectionLabelStyle = { fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }

// ── CommentsTabRecap — the fixed condensed client-info + invoice-recap
// block above the (separately scrollable) message thread. ──
function CommentsTabRecap({ invoice }) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '0 24px 12px', marginBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {invoice.client_name || 'No client yet'}
        </p>
        {invoice.client_email && <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{invoice.client_email}</p>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(invoice.total, invoice.currency)}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{invoice.invoice_number}</p>
      </div>
    </div>
  )
}

// ── TimelineTab ───────────────────────────────────────────────────
function TimelineTab({ loaded, entries }) {
  if (!loaded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[1, 2, 3].map((i) => <div key={i} style={{ height: 44, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />)}
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 28, background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
        No activity yet. Views, reminders, and payments will show up here.
      </div>
    )
  }
  const reversed = [...entries].reverse()
  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      <div style={{ position: 'absolute', left: 6, top: 6, bottom: 6, width: 1, background: 'var(--border-subtle)' }} />
      {reversed.map((ev, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 14, position: 'relative' }}>
          <div style={{ position: 'absolute', left: -14, top: 4, width: 8, height: 8, borderRadius: '50%', background: timelineDotColor(ev.type), flexShrink: 0, border: '2px solid var(--bg-surface)' }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 1px', fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: ev.type === 'payment' ? 600 : 400, display: 'flex', alignItems: 'center', gap: 6 }}>
              {timelineIcon(ev.type)}
              {timelineLabel(ev)}
            </p>
            <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{new Date(ev.timestamp).toLocaleString()}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── ClaimsTab ─────────────────────────────────────────────────────
const CLAIM_STATUS_STYLE = {
  pending: { color: 'var(--status-amber-text)', label: 'Pending' },
  confirmed: { color: 'var(--status-green-text)', label: 'Confirmed' },
  rejected: { color: 'var(--status-red-text)', label: 'Rejected' },
}

function ClaimsTab({ claims, busy, onConfirm, onReject }) {
  if (claims.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 28, background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
        No payment claims yet. Claims your client submits from the portal will show up here.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {claims.map((claim) => {
        const meta = CLAIM_STATUS_STYLE[claim.status] || CLAIM_STATUS_STYLE.pending
        return (
          <div key={claim.id} style={{ padding: '12px 14px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
              <div>
                <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {formatMoney(claim.amount_claimed, claim.currency)}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                  {claim.client_name || 'Client'} · via {claim.payment_source} · {claim.payment_date}
                </p>
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: meta.color }}>{meta.label}</span>
            </div>
            {claim.client_note && (
              <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>"{claim.client_note}"</p>
            )}
            {claim.status !== 'pending' && claim.review_note && (
              <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Note: {claim.review_note}</p>
            )}
            {claim.status === 'pending' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => onConfirm(claim)} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.75rem', color: 'var(--status-green-text)' }}>
                  <CheckCircle2 size={13} /> Confirm
                </button>
                <button onClick={() => onReject(claim)} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.75rem', color: 'var(--status-red-text)' }}>
                  <XCircle size={13} /> Reject
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function timelineIcon(type) {
  if (type === 'payment') return <Wallet size={12} />
  if (type === 'reminder') return <Bell size={12} />
  if (type === 'view') return <Eye size={12} />
  if (type === 'created') return <FileText size={12} />
  if (type === 'finalised') return <CheckCircle2 size={12} />
  if (type === 'sent') return <Send size={12} />
  if (type === 'claim') return <Landmark size={12} />
  if (type === 'acknowledged') return <UserCheck size={12} />
  if (type === 'escalation') return <AlertOctagon size={12} />
  if (type === 'formal_notice') return <Gavel size={12} />
  return null
}

function TabButton({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="idp-tab-btn"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px',
        background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
        fontSize: '0.85rem', fontWeight: active ? 600 : 500,
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'color var(--transition-fast), border-color var(--transition-fast)',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <Icon size={14} /> {label}
    </button>
  )
}

// ── Modals ────────────────────────────────────────────────────────
function ModalShell({ title, onClose, children, maxWidth = 420 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '24px 28px', width: '100%', maxWidth, maxHeight: '90vh', overflowY: 'auto', animation: 'modal-in 0.2s cubic-bezier(0.22,1,0.36,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" data-tooltip="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ConfirmModal({ title, body, confirmLabel, danger, busy, onConfirm, onClose }) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{body}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className={danger ? 'fos-btn fos-btn-danger' : 'fos-btn fos-btn-accent'} onClick={onConfirm} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : null}{confirmLabel}
        </button>
      </div>
    </ModalShell>
  )
}

function SendModal({ invoice, busy, onConfirm, onClose }) {
  return (
    <ModalShell title="Send Invoice" onClose={onClose}>
      <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        This actually emails <strong>{invoice.client_name || 'the client'}</strong> at{' '}
        <strong>{invoice.client_email}</strong> with the invoice PDF attached, through LanceraOS
        (your own SMTP if configured and verified, otherwise LanceraOS's own mail). You're cc'd on
        the email. This is different from "Mark as Sent" — that just records that you sent it
        yourself elsewhere.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-primary" onClick={onConfirm} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <Mail size={14} />} Send Invoice
        </button>
      </div>
    </ModalShell>
  )
}

function MarkSentModal({ busy, onConfirm, onClose }) {
  const [sendReminders, setSendReminders] = useState(true)
  return (
    <ModalShell title="Mark as Sent" onClose={onClose}>
      <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        This tells LanceraOS you already sent this invoice yourself (email, WhatsApp, in person). It does not send anything through LanceraOS.
      </p>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', marginBottom: 20 }}>
        <input type="checkbox" checked={sendReminders} onChange={(e) => setSendReminders(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--accent)', width: 14, height: 14 }} />
        <div>
          <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)' }}>Enable reminders</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Starts the escalating reminder schedule once overdue.</p>
        </div>
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-accent" onClick={() => onConfirm(sendReminders)} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <Send size={14} />} Confirm
        </button>
      </div>
    </ModalShell>
  )
}

// ── AddPaymentModal — unified this round: one popup, two real paths.
// "Mark Fully Paid" reuses the exact mark-paid endpoint (pre-fills the
// full outstanding balance); "Add a Partial Amount" reuses the exact
// add-payment endpoint (user-entered amount). Same two backend calls
// this panel already had — a frontend consolidation into one entry
// point, not new backend logic. ──
function AddPaymentModal({ invoice, busy, busyKey, onMarkPaid, onAddPayment, onClose }) {
  const [mode, setMode] = useState(null) // null (choose) | 'full' | 'partial'

  if (mode === null) {
    return (
      <ModalShell title="Add Payment" onClose={onClose}>
        <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Outstanding balance: <strong>{formatMoney(invoice.outstanding_amount, invoice.currency)}</strong>
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={() => setMode('full')} className="fos-btn fos-btn-accent" style={{ justifyContent: 'flex-start', padding: '12px 16px' }}>
            <CheckCircle2 size={15} /> Mark Fully Paid — {formatMoney(invoice.outstanding_amount, invoice.currency)}
          </button>
          <button onClick={() => setMode('partial')} className="fos-btn fos-btn-ghost" style={{ justifyContent: 'flex-start', padding: '12px 16px' }}>
            <Wallet size={15} /> Add a Partial Amount
          </button>
        </div>
      </ModalShell>
    )
  }

  if (mode === 'full') {
    return <MarkPaidForm invoice={invoice} busy={busyKey === 'mark_paid'} onBack={() => setMode(null)} onConfirm={onMarkPaid} onClose={onClose} />
  }

  return <PartialPaymentForm invoice={invoice} busy={busyKey === 'add_payment'} onBack={() => setMode(null)} onConfirm={onAddPayment} onClose={onClose} />
}

function MarkPaidForm({ invoice, busy, onBack, onConfirm, onClose }) {
  const [source, setSource] = useState('other')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  return (
    <ModalShell title="Mark Fully Paid" onClose={onClose}>
      <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        Records the full outstanding balance of <strong>{formatMoney(invoice.outstanding_amount, invoice.currency)}</strong> as a payment.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        <FormSelect label="Source" value={source} onChange={(e) => setSource(e.target.value)} options={PAYMENT_SOURCE_OPTIONS} />
        <FormField label="Payment Date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        <FormField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onBack}>Back</button>
        <button className="fos-btn fos-btn-accent" onClick={() => onConfirm({ source, payment_date: paymentDate, notes })} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <CheckCircle2 size={14} />} Confirm
        </button>
      </div>
    </ModalShell>
  )
}

function PartialPaymentForm({ invoice, busy, onBack, onConfirm, onClose }) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(invoice.currency)
  const [source, setSource] = useState('other')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  function submit() {
    if (!amount || parseFloat(amount) <= 0) { setError('Enter a valid amount.'); return }
    if (parseFloat(amount) > Number(invoice.outstanding_amount)) {
      setError(`Amount cannot exceed the outstanding balance of ${formatMoney(invoice.outstanding_amount, invoice.currency)}.`)
      return
    }
    setError('')
    onConfirm({ amount, currency, source, payment_date: paymentDate, notes })
  }

  return (
    <ModalShell title="Add a Partial Amount" onClose={onClose}>
      {error && <FosAlert type="error" style={{ marginBottom: 12 }}>{error}</FosAlert>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <FormField label={`Amount (outstanding: ${formatMoney(invoice.outstanding_amount, invoice.currency)})`} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <FormField label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </div>
        <FormSelect label="Source" value={source} onChange={(e) => setSource(e.target.value)} options={PAYMENT_SOURCE_OPTIONS} />
        <FormField label="Date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        <FormField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onBack}>Back</button>
        <button className="fos-btn fos-btn-accent" onClick={submit} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <Wallet size={14} />} Record Payment
        </button>
      </div>
    </ModalShell>
  )
}

function RefundModal({ invoice, busy, onConfirm, onClose }) {
  const [amount, setAmount] = useState(invoice.amount_paid)
  const [error, setError] = useState('')

  if (invoice.status === 'refunded') {
    return (
      <ModalShell title="Refund" onClose={onClose}>
        <FosAlert type="info">This invoice has already been refunded.</FosAlert>
      </ModalShell>
    )
  }

  function submit() {
    const value = parseFloat(amount)
    if (!value || value <= 0 || value > Number(invoice.amount_paid)) {
      setError(`Amount must be greater than 0 and no more than ${formatMoney(invoice.amount_paid, invoice.currency)}.`)
      return
    }
    setError('')
    onConfirm(amount)
  }

  return (
    <ModalShell title="Refund" onClose={onClose}>
      <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        Refunding sets this invoice's status to Refunded — it's a one-time, final action and cannot be repeated or undone.
      </p>
      {error && <FosAlert type="error" style={{ marginBottom: 12 }}>{error}</FosAlert>}
      <FormField
        label={`Refund Amount (max ${formatMoney(invoice.amount_paid, invoice.currency)})`}
        type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-danger" onClick={submit} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : null} Refund
        </button>
      </div>
    </ModalShell>
  )
}

function UndoPaymentModal({ age, lastPayment, busy, onConfirm, onClose }) {
  const isOld = age !== null && age > UNDO_CONFIRMATION_AGE_DAYS
  return (
    <ModalShell title="Undo Last Payment" onClose={onClose}>
      {lastPayment ? (
        <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          This removes the most recently recorded payment of <strong>{formatMoney(lastPayment.amount, lastPayment.currency)}</strong>,
          recorded {age === 0 ? 'today' : `${age} day${age !== 1 ? 's' : ''} ago`} on {new Date(lastPayment.timestamp).toLocaleDateString()}.
        </p>
      ) : (
        <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>This removes the most recently recorded payment on this invoice.</p>
      )}
      {isOld && (
        <FosAlert type="warning" style={{ marginBottom: 16 }}>
          This payment was recorded more than {UNDO_CONFIRMATION_AGE_DAYS} days ago. Undoing it will change the invoice's status retroactively.
        </FosAlert>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-danger" onClick={() => onConfirm(isOld)} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <Undo2 size={14} />} {isOld ? 'Undo Anyway' : 'Undo Payment'}
        </button>
      </div>
    </ModalShell>
  )
}

function RejectClaimModal({ claim, busy, onConfirm, onClose }) {
  const [reviewNote, setReviewNote] = useState('')
  const [error, setError] = useState('')

  function submit() {
    if (!reviewNote.trim()) { setError('A reason is required to reject a claim.'); return }
    setError('')
    onConfirm(claim.id, reviewNote.trim())
  }

  return (
    <ModalShell title="Reject this claim?" onClose={onClose}>
      <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {formatMoney(claim.amount_claimed, claim.currency)} claimed via {claim.payment_source} will be marked rejected. No payment is recorded — this has zero financial effect.
      </p>
      {error && <FosAlert type="error" style={{ marginBottom: 12 }}>{error}</FosAlert>}
      <FormField label="Reason" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="e.g. Amount doesn't match our records" required autoFocus />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-danger" onClick={submit} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <XCircle size={14} />} Reject Claim
        </button>
      </div>
    </ModalShell>
  )
}

function EditSeriesModal({ invoice, busy, onConfirm, onClose }) {
  const [intervalDays, setIntervalDays] = useState(invoice.recurring_interval_days || 30)
  const [autoSend, setAutoSend] = useState(invoice.recurring_auto_send)

  return (
    <ModalShell title="Edit Recurring Series" onClose={onClose}>
      <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Changes apply going forward, starting with the next generated occurrence. Any invoice already
        generated from this series is unaffected.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        <FormSelect
          label="Repeats" value={intervalDays}
          onChange={(e) => setIntervalDays(Number(e.target.value))}
          options={RECURRING_INTERVAL_OPTIONS}
        />
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
          <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--accent)', width: 14, height: 14 }} />
          <div>
            <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)' }}>Auto-send new occurrences</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Off leaves each generated invoice as a draft for you to review first.</p>
          </div>
        </label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-accent" onClick={() => onConfirm(intervalDays, autoSend)} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <Settings2 size={14} />} Save
        </button>
      </div>
    </ModalShell>
  )
}

function FormalNoticeModal({ invoice, busy, onConfirm, onClose }) {
  return (
    <ModalShell title="Send Formal Notice" onClose={onClose}>
      <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        This sends a firmer, formal email to <strong>{invoice.client_name || 'the client'}</strong> stating the
        amount owed and days overdue, and referencing the invoice thread for a response. This is a real,
        deliberate escalation — not part of the automatic reminder schedule.
      </p>
      {invoice.formal_notice_sent_at && (
        <FosAlert type="warning" style={{ marginBottom: 14 }}>
          A formal notice was already sent on {new Date(invoice.formal_notice_sent_at).toLocaleString()}. Sending again is allowed, but make sure it's intentional.
        </FosAlert>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <Gavel size={14} />} Send Formal Notice
        </button>
      </div>
    </ModalShell>
  )
}

function SavePresetModal({ hasClient, busy, onConfirm, onClose }) {
  const [name, setName] = useState('')
  const [includeClient, setIncludeClient] = useState(false)
  const [error, setError] = useState('')

  function submit() {
    if (!name.trim()) { setError('A preset name is required.'); return }
    onConfirm(name.trim(), includeClient)
  }

  return (
    <ModalShell title="Save as Preset" onClose={onClose}>
      <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        Saves this invoice's line items and settings as a reusable starting point for future invoices.
      </p>
      {error && <FosAlert type="error" style={{ marginBottom: 12 }}>{error}</FosAlert>}
      <FormField label="Preset Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Web Dev Retainer" autoFocus required />
      {hasClient && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={includeClient} onChange={(e) => setIncludeClient(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
          Also save this client with the preset
        </label>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-accent" onClick={submit} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <BookmarkPlus size={14} />} Save Preset
        </button>
      </div>
    </ModalShell>
  )
}

// ── SendReminderModal — new this round ──────────────────────────────
function SendReminderModal({ invoice, nextReminderNumber, busy, onConfirm, onClose }) {
  return (
    <ModalShell title={`Send Reminder ${nextReminderNumber}`} onClose={onClose}>
      <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        This emails <strong>{invoice.client_name || 'the client'}</strong> at <strong>{invoice.client_email}</strong> a
        real reminder about this overdue invoice. It writes the same record the automatic day-3/7/14/30
        schedule uses, so the scheduled task won't send this same level again later.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-accent" onClick={onConfirm} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <Bell size={14} />} Send Reminder
        </button>
      </div>
    </ModalShell>
  )
}

// ── ResendModal — new this round ─────────────────────────────────────
function ResendModal({ invoice, busy, onConfirm, onClose }) {
  return (
    <ModalShell title="Resend Invoice" onClose={onClose}>
      <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        This re-sends this invoice's current PDF to <strong>{invoice.client_name || 'the client'}</strong> at{' '}
        <strong>{invoice.client_email}</strong> again — unlike the original Send, this can be repeated as
        many times as you like and never changes the invoice's status.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-accent" onClick={onConfirm} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <RefreshCw size={14} />} Resend
        </button>
      </div>
    </ModalShell>
  )
}

// ── ChangeDueDateModal — new this round ──────────────────────────────
function ChangeDueDateModal({ invoice, busy, onConfirm, onClose }) {
  const [dueDate, setDueDate] = useState(invoice.due_date || '')
  const [error, setError] = useState('')

  function submit() {
    if (!dueDate) { setError('A due date is required.'); return }
    if (invoice.issue_date && dueDate < invoice.issue_date) {
      setError('Due date cannot be before the issue date.')
      return
    }
    setError('')
    onConfirm(dueDate)
  }

  return (
    <ModalShell title="Change Due Date" onClose={onClose}>
      {error && <FosAlert type="error" style={{ marginBottom: 12 }}>{error}</FosAlert>}
      <FormField label="Due Date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-accent" onClick={submit} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <CalendarClock size={14} />} Save
        </button>
      </div>
    </ModalShell>
  )
}

function PanelSkeleton() {
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        <div style={{ width: '40%', height: 22, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
        <div style={{ width: '60%', height: 14, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      </div>
      <div style={{ height: 90, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-lg)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', marginBottom: 16 }} />
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ height: 40, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', marginBottom: 8 }} />
      ))}
    </div>
  )
}
