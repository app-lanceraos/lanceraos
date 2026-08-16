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
// Overdue is never a status value (see apps/invoices/models.py's
// days_overdue docstring) — every status badge here is rendered alongside a
// separate, orthogonal Overdue badge computed from invoice.days_overdue,
// never merged into or replacing the real status.
import { useEffect, useState } from 'react'
import {
  X, Send, Mail, CheckCircle2, Wallet, Undo2, Ban, ShieldAlert, Copy, BookmarkPlus,
  Check, AlertTriangle, Pause, Play, Bell, BellOff, Trash2, Clock, Eye, Receipt, FileText, MessageCircle,
  Landmark, XCircle, UserCheck, AlertOctagon, Gavel, Settings2,
} from 'lucide-react'

import api from '@/lib/api'
import useAuthStore from '@/store/authStore'
import useTimedMessage from '@/hooks/useTimedMessage'
import useInvoiceAutosave from '@/hooks/useInvoiceAutosave'
import CommentThread from './CommentThread'
import ErrorBoundary from './ErrorBoundary'
import FormField from './FormField'
import FormSelect from './FormSelect'
import FosAlert from './FosAlert'
import InvoiceFormFields from './InvoiceFormFields'
import InvoiceStatusBadge from './InvoiceStatusBadge'
import {
  INVOICE_STATUS_META, OVERDUE_BADGE, STATUS_BADGE_STYLE, badgeBaseStyle, formatMoney,
  PAYMENT_SOURCE_OPTIONS, RECURRING_INTERVAL_OPTIONS, UNDO_CONFIRMATION_AGE_DAYS, daysSince,
  getSendBannerCopy, invoiceToForm, timelineDotColor, timelineLabel,
} from '@/pages/invoiceHelpers'

const ACTIVE_STATUSES = ['sent', 'viewed', 'partially_paid']
const NO_PAYMENT_STATUSES = ['cancelled', 'bad_debt', 'refunded', 'draft']

export default function InvoiceDetailPanel({ invoiceId, onClose, onChanged, onPresetSaved, initialMessage, onInitialMessageShown }) {
  const formalNoticeEnabled = useAuthStore((s) => s.user?.formal_notice_enabled ?? true)
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [timeline, setTimeline] = useState([])
  const [timelineLoaded, setTimelineLoaded] = useState(false)
  const [claims, setClaims] = useState([])
  const [activeTab, setActiveTab] = useState('details')

  // ── Autosave (Step 6 rework; extracted to useInvoiceAutosave this
  // pass so NewInvoiceWizard.jsx can share the exact same race-safe
  // chain once a brand-new invoice crosses its creation threshold) ──
  // Continuous, Gmail-compose-style autosave for the entire time an
  // invoice is status='draft' — matches is_editable exactly (see
  // apps/invoices/models.py; PUT is rejected with 403 the moment status
  // leaves 'draft', including 'created'). There is no more separate
  // "editing" toggle: a draft invoice's form fields ARE the invoice, live.
  const [form, setForm] = useState(null)
  const {
    saveState, saveErrors, setSaveErrors, flushPendingSave, skipNextAutosave,
  } = useInvoiceAutosave(invoiceId, form, invoice?.status === 'draft', setInvoice)

  const [busyKey, setBusyKey] = useState(null)
  const { message: toast, show: showToast, clear: clearToast } = useTimedMessage()

  const [modal, setModal] = useState(null) // 'mark_sent' | 'mark_paid' | 'add_payment' | 'refund' | 'undo' | 'save_preset' | 'cancel' | 'bad_debt' | 'delete'

  useEffect(() => { loadInvoice() }, [invoiceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Surfaces a success message that was earned inside NewInvoiceWizard.jsx
  // (Finalise/Mark-as-Sent), a different component instance than this one —
  // this is the one place that message has anywhere left to show, since
  // the wizard unmounts the instant it hands off. Shown once, then cleared
  // in the parent so navigating away and reopening this same invoice later
  // doesn't repeat a stale message.
  useEffect(() => {
    if (initialMessage) {
      // A plain string is always a success toast (every existing caller);
      // an object lets a caller like the Finalise & Send handoff show a
      // warning instead — e.g. "finalised, but sending failed" must never
      // render in the same green success style as a real full success.
      const { type, text } = typeof initialMessage === 'string' ? { type: 'success', text: initialMessage } : initialMessage
      showToast(type, text)
      onInitialMessageShown?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage])
  useEffect(() => { loadTimeline() }, [invoiceId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadClaims() }, [invoiceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // The sole close path (X button + overlay click) — flushes first so
  // closing right after typing still saves, exactly like closing a Gmail
  // compose window. An empty, never-touched draft is never deleted here
  // or anywhere else — it persists as a real Draft row, findable later.
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

  async function refresh() {
    await loadInvoice()
    await loadTimeline()
    await loadClaims()
  }

  async function runAction(key, fn, successMsg) {
    setBusyKey(key)
    try {
      await fn()
      if (successMsg) showToast('success', successMsg)
    } catch (e) {
      const body = e.response?.data
      // Most rejections here have already been caught client-side first
      // (e.g. AddPaymentModal's own outstanding-balance check) — this is
      // the fallback for whatever reaches the backend anyway, so a DRF
      // field-level error (serializer.errors' own shape, e.g. `amount`)
      // still surfaces its real message instead of a generic one.
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

  // The REAL send — distinct from handleMarkSent's manual self-report
  // flip. Only reachable from status='created' (see the footer's own
  // gate below); the backend re-checks this regardless. No flushPendingSave
  // call needed here — a status='created' invoice is already immutable
  // (is_editable is draft-only), so there's nothing pending to flush.
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

  // Only reachable for a recurring ROOT (is_recurring, no parent_invoice) —
  // invoice_detail's PUT handler allows exactly these 2 fields through
  // regardless of the root's own status, per Step 16's own narrow allowance.
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
    // Read from the just-flushed row, not the `invoice` closure var directly —
    // setInvoice() inside saveNow() won't be reflected here until the next
    // render, so a stale flush result would silently drop the last edits.
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
    // Real bug, fixed here: Invoices.jsx fetches its presets list once on
    // mount and had no way of knowing a new one was just created — "From
    // Preset" needed a full page reload to see it. This tells the parent
    // directly rather than Invoices.jsx re-fetching the whole list.
    onPresetSaved?.(data)
    setModal(null)
  }, 'Saved as a preset.')

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
            <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 8, marginBottom: 12 }}><X size={16} /></button>
            <FosAlert type="error">{error || 'Invoice not found.'}</FosAlert>
          </div>
        </div>
      </>
    )
  }

  const meta = INVOICE_STATUS_META[invoice.status] || INVOICE_STATUS_META.draft
  const isOverdue = invoice.days_overdue > 0
  const sendBannerCopy = getSendBannerCopy(invoice)
  const busy = busyKey !== null

  return (
    <>
      <div onClick={handleClose} style={overlayStyle} />
      <div style={panelStyle}>
        <div style={{ padding: '20px 24px 100px' }}>
          <button onClick={handleClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 8, marginBottom: 12 }}>
            <X size={16} />
          </button>

          {/* ── Header ── */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {invoice.invoice_number || '(unnumbered draft)'}
              </h2>
              {isOverdue && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[OVERDUE_BADGE.statusKey] }}>{OVERDUE_BADGE.label}</span>}
              <InvoiceStatusBadge meta={meta} />
            </div>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
              {invoice.client_name || 'No client yet'} · Due {invoice.due_date || '—'}
            </p>
            {invoice.client_acknowledged && (
              <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--status-green-text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <UserCheck size={12} /> Acknowledged on {new Date(invoice.client_acknowledged_at).toLocaleDateString()}
              </p>
            )}
          </div>

          {sendBannerCopy && (
            <FosAlert type="warning" style={{ marginBottom: 16 }}>{sendBannerCopy}</FosAlert>
          )}

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

          {invoice.status === 'draft' ? (
            <>
              <SaveStatusIndicator state={saveState} />
              {form && <InvoiceFormFields form={form} setForm={setForm} errors={saveErrors} />}
            </>
          ) : (
            <>
              {/* ── Amount ── */}
              <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ margin: '0 0 4px', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Invoice Total</p>
                    <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(invoice.total, invoice.currency)}
                    </p>
                  </div>
                  {Number(invoice.amount_paid) > 0 && (
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ margin: '0 0 3px', fontSize: '0.75rem', color: 'var(--status-green-text)' }}>Paid: {formatMoney(invoice.amount_paid, invoice.currency)}</p>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--status-red-text)' }}>Outstanding: {formatMoney(invoice.outstanding_amount, invoice.currency)}</p>
                    </div>
                  )}
                </div>
                {invoice.status === 'refunded' && (
                  <p style={{ margin: '10px 0 0', paddingTop: 10, borderTop: '1px solid var(--border-subtle)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Refunded: {formatMoney(invoice.refunded_amount, invoice.currency)}
                  </p>
                )}
              </div>

              {/* ── Tabs ── */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
                <TabButton icon={Receipt} label="Details" active={activeTab === 'details'} onClick={() => setActiveTab('details')} />
                <TabButton icon={Clock} label="Timeline" active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} />
                <TabButton icon={MessageCircle} label="Comments" active={activeTab === 'comments'} onClick={() => setActiveTab('comments')} />
                <TabButton
                  icon={Landmark} label={`Claims${claims.filter((c) => c.status === 'pending').length > 0 ? ` (${claims.filter((c) => c.status === 'pending').length})` : ''}`}
                  active={activeTab === 'claims'} onClick={() => setActiveTab('claims')}
                />
              </div>

              {activeTab === 'details' && <DetailsTab invoice={invoice} />}
              {activeTab === 'timeline' && (
                <ErrorBoundary key={invoiceId}>
                  <TimelineTab loaded={timelineLoaded} entries={timeline} />
                </ErrorBoundary>
              )}
              {activeTab === 'comments' && (
                <div style={{ height: 420 }}>
                  <CommentThread
                    commentsUrl={`/invoices/${invoiceId}/comments/`}
                    viewToken={invoice.view_token}
                    viewerType="freelancer"
                  />
                </div>
              )}
              {activeTab === 'claims' && (
                <ClaimsTab
                  claims={claims} busy={busy}
                  onConfirm={(claim) => setModal({ kind: 'confirm_claim', claim })}
                  onReject={(claim) => setModal({ kind: 'reject_claim', claim })}
                />
              )}

              {/* ── Recurring + Reminders toggle — Details tab ONLY (real,
                  found bug this pass: both used to render unconditionally
                  below the tab switch, so they showed up on Timeline/
                  Comments/Claims too, not just Details). ── */}
              {activeTab === 'details' && (
                <>
                  {invoice.is_recurring && (
                    <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div>
                        <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                          {invoice.recurring_paused ? 'Recurring — paused' : `Recurring — next ${invoice.next_recurring_date || 'unscheduled'}`}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {/* Only a ROOT invoice (no parent) owns the series settings —
                            a generated occurrence is independent from that point on. */}
                        {!invoice.parent_invoice && (
                          <button onClick={() => setModal({ kind: 'edit_series' })} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.75rem' }}>
                            <Settings2 size={13} /> Edit Series
                          </button>
                        )}
                        <button onClick={handlePauseResume} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.75rem' }}>
                          {invoice.recurring_paused ? <Play size={13} /> : <Pause size={13} />}
                          {invoice.recurring_paused ? 'Resume' : 'Pause'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-primary)' }}>Automatic reminders</p>
                    <button onClick={handleToggleReminders} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.75rem' }}>
                      {invoice.reminders_enabled ? <Bell size={13} /> : <BellOff size={13} />}
                      {invoice.reminders_enabled ? 'On' : 'Off'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* ── Actions footer — reorganized into 3 groups this pass (item 9
            of the verification pass): primary lifecycle actions (move the
            invoice forward) first and most prominent; secondary/utility
            actions (never change the invoice's own state) in the middle;
            destructive/terminal actions last, visually separated by a
            divider and consistently red-toned so they read as a distinct,
            deliberate zone rather than blending into the rest. ── */}
        <div style={{ position: 'sticky', bottom: 0, padding: '12px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Primary lifecycle actions */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {invoice.status === 'draft' && (
                <button onClick={handleFinalise} disabled={busy} className="fos-btn fos-btn-primary" style={{ fontSize: '0.78rem' }}>
                  {busyKey === 'finalise' ? <span className="fos-spinner" /> : <CheckCircle2 size={13} />} Finalise
                </button>
              )}
              {['draft', 'created'].includes(invoice.status) && (
                <button onClick={() => setModal({ kind: 'mark_sent' })} disabled={busy} className="fos-btn fos-btn-accent" style={{ fontSize: '0.78rem' }}>
                  <Send size={13} /> Mark as Sent
                </button>
              )}
              {/* The real send — a distinct, parallel action from Mark as
                  Sent above, not a replacement for it (per DECISIONS.md:
                  "I already sent this myself" vs. LanceraOS actually
                  delivering it). Only reachable at status='created' —
                  the backend's own real gate, mirrored here so the
                  button is never even shown somewhere it'd just 400. */}
              {invoice.status === 'created' && (
                <button onClick={() => setModal({ kind: 'send' })} disabled={busy} className="fos-btn fos-btn-primary" style={{ fontSize: '0.78rem' }}>
                  <Mail size={13} /> Send
                </button>
              )}
              {!NO_PAYMENT_STATUSES.includes(invoice.status) && (
                <>
                  <button onClick={() => setModal({ kind: 'add_payment' })} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem' }}><Wallet size={13} /> Add Payment</button>
                  <button onClick={() => setModal({ kind: 'mark_paid' })} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', color: 'var(--status-green-text)' }}><CheckCircle2 size={13} /> Mark Paid</button>
                </>
              )}
              {Number(invoice.amount_paid) > 0 && !['cancelled', 'bad_debt'].includes(invoice.status) && (
                <button onClick={requestUndoPayment} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem' }}><Undo2 size={13} /> Undo Payment</button>
              )}
            </div>

            {/* Secondary / utility actions — never change the invoice's own lifecycle state */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {/* "For any invoice with a client" — no status restriction,
                  unlike Send/Mark-as-Sent above. A one-time-client invoice
                  (invoice.client is null) has no portal identity to
                  preview as, so this is absent rather than shown-disabled. */}
              {invoice.client && (
                <button onClick={() => setModal({ kind: 'preview_as_client' })} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem' }}><Eye size={13} /> Preview as Client</button>
              )}
              <button onClick={handleDuplicate} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem' }}><Copy size={13} /> Duplicate</button>
              <button onClick={() => setModal({ kind: 'save_preset' })} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem' }}><BookmarkPlus size={13} /> Save as Preset</button>
            </div>

            {/* Destructive / terminal actions — visually separated */}
            {(['paid', 'partially_paid'].includes(invoice.status)
              || ACTIVE_STATUSES.includes(invoice.status)
              || ((invoice.escalation_required || invoice.status === 'bad_debt') && formalNoticeEnabled)
              || ['draft', 'created'].includes(invoice.status)) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 8, borderTop: '1px dashed var(--border-subtle)' }}>
                {['paid', 'partially_paid'].includes(invoice.status) && (
                  <button onClick={() => setModal({ kind: 'refund' })} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', color: 'var(--status-red-text)' }}><Undo2 size={13} /> Refund</button>
                )}
                {ACTIVE_STATUSES.includes(invoice.status) && (
                  <>
                    <button onClick={() => setModal({ kind: 'cancel' })} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', color: 'var(--status-red-text)' }}><Ban size={13} /> Cancel</button>
                    <button onClick={() => setModal({ kind: 'bad_debt' })} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', color: 'var(--status-red-text)' }}><ShieldAlert size={13} /> Bad Debt</button>
                  </>
                )}
                {/* Also reachable here (not just the escalation banner above)
                    once escalation_dismissed — dismissing the PROMPT doesn't
                    mean the invoice stopped being severely overdue, per
                    invoice_send_formal_notice's own gating rule. Hidden
                    entirely, not shown-disabled, when the freelancer has
                    turned the feature off in Settings — the real, enforced
                    gate is still server-side either way. */}
                {(invoice.escalation_required || invoice.status === 'bad_debt') && formalNoticeEnabled && (
                  <button onClick={() => setModal({ kind: 'formal_notice' })} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', color: 'var(--status-red-text)' }}>
                    <Gavel size={13} /> Formal Notice
                  </button>
                )}
                {['draft', 'created'].includes(invoice.status) && (
                  <button onClick={() => setModal({ kind: 'delete' })} disabled={busy} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', color: 'var(--status-red-text)' }}><Trash2 size={13} /> Delete</button>
                )}
              </div>
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
      {modal?.kind === 'mark_paid' && (
        <MarkPaidModal invoice={invoice} busy={busyKey === 'mark_paid'} onConfirm={handleMarkPaid} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'add_payment' && (
        <AddPaymentModal invoice={invoice} busy={busyKey === 'add_payment'} onConfirm={handleAddPayment} onClose={() => setModal(null)} />
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
      {modal?.kind === 'preview_as_client' && (
        <PreviewAsClientModal invoice={invoice} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'confirm_claim' && (
        <ConfirmModal
          title="Confirm this claim?"
          body={`Records ${formatMoney(modal.claim.amount_claimed, modal.claim.currency)} as a real payment on this invoice via ${modal.claim.payment_source}, using the same payment-recording path as Add Payment / Mark Paid.`}
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
    </>
  )
}

const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 100 }
const panelStyle = {
  position: 'fixed', top: 'var(--header-h)', right: 0, bottom: 0, width: '100%', maxWidth: 600,
  background: 'var(--bg-surface)', boxShadow: '-8px 0 32px rgba(0,0,0,0.2)', zIndex: 101,
  overflowY: 'auto', animation: 'panel-slide-in 0.2s cubic-bezier(0.22,1,0.36,1)',
  display: 'flex', flexDirection: 'column',
}

// ── SaveStatusIndicator ───────────────────────────────────────────
// Small, passive, text-only status line — deliberately not a FosAlert
// (too heavy/visually loud for something that changes every few
// seconds while typing) and not a toast (would compete with the
// header/toolbar exactly as the spec warns against). No existing
// "Saving…/All changes saved" pattern exists elsewhere in this codebase
// (checked Settings/Profile directly — NotificationsSection.jsx has a
// per-toggle debounced-save spinner, but nothing resembling a persistent
// Gmail-style status line), so this is a new, minimal, one-off text
// treatment using only DESIGN.md's existing tokens/spinner/icons.
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
function DetailsTab({ invoice }) {
  return (
    <div>
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
      {invoice.terms && (
        <div style={{ marginBottom: 16 }}>
          <p style={sectionLabelStyle}>Payment Terms</p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{invoice.terms}</p>
        </div>
      )}
      {invoice.late_fee_enabled && Number(invoice.late_fee_amount) > 0 && (
        <FosAlert type="warning">+ {formatMoney(invoice.late_fee_amount, invoice.currency)} late fee accrued ({invoice.late_fee_rate}%/month)</FosAlert>
      )}
    </div>
  )
}

const sectionLabelStyle = { fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }

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
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px',
        background: 'none', border: 'none', cursor: 'pointer',
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
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// Full-screen, not ModalShell's card style — needs real room to show the
// actual invoice document. The "You're previewing as..." banner lives
// here, entirely OUTSIDE the iframe's own document (pure React chrome),
// so it can never be mistaken for real portal chrome — the iframe's
// content is the exact same bare invoice-document HTML the PDF/portal
// renderer produces, which has no banner or navigation of its own.
// This hits invoice_preview_as_client (apps/invoices/views_portal.py),
// a freelancer-authenticated endpoint that never mints a real
// ClientPortalSession and never logs a view — confirmed directly against
// that endpoint's own docstring, not assumed from the URL alone.
function PreviewAsClientModal({ invoice, onClose }) {
  const previewUrl = `${api.defaults.baseURL}/invoices/${invoice.id}/preview-as-client/`
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 24px', background: 'var(--status-amber)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: 12 }}>
        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Eye size={15} /> You're previewing as {invoice.client_name || 'this client'} — this is not the real portal
        </p>
        <button onClick={onClose} className="fos-btn fos-btn-ghost" style={{ color: '#fff', padding: 6, flexShrink: 0 }} aria-label="Close preview"><X size={16} /></button>
      </div>
      <iframe
        src={previewUrl}
        title={`Preview as ${invoice.client_name || 'client'}`}
        style={{ flex: 1, border: 'none', background: '#fff' }}
      />
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

function MarkPaidModal({ invoice, busy, onConfirm, onClose }) {
  const [source, setSource] = useState('other')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  return (
    <ModalShell title="Mark as Paid" onClose={onClose}>
      <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        Records the full outstanding balance of <strong>{formatMoney(invoice.outstanding_amount, invoice.currency)}</strong> as a payment.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        <FormSelect label="Source" value={source} onChange={(e) => setSource(e.target.value)} options={PAYMENT_SOURCE_OPTIONS} />
        <FormField label="Payment Date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        <FormField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="fos-btn fos-btn-accent" onClick={() => onConfirm({ source, payment_date: paymentDate, notes })} disabled={busy}>
          {busy ? <span className="fos-spinner" /> : <CheckCircle2 size={14} />} Confirm
        </button>
      </div>
    </ModalShell>
  )
}

function AddPaymentModal({ invoice, busy, onConfirm, onClose }) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(invoice.currency)
  const [source, setSource] = useState('other')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  function submit() {
    if (!amount || parseFloat(amount) <= 0) { setError('Enter a valid amount.'); return }
    // Immediate client-side feedback — the real, authoritative check is
    // the same comparison server-side (InvoicePartialPaymentSerializer.
    // validate_amount), which is what actually matters if this value is
    // ever stale (e.g. another payment recorded concurrently) by the time
    // this reaches the backend.
    if (parseFloat(amount) > Number(invoice.outstanding_amount)) {
      setError(`Amount cannot exceed the outstanding balance of ${formatMoney(invoice.outstanding_amount, invoice.currency)}.`)
      return
    }
    setError('')
    onConfirm({ amount, currency, source, payment_date: paymentDate, notes })
  }

  return (
    <ModalShell title="Record Payment" onClose={onClose}>
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
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

  // invoice_refund is a one-shot, terminal transition (apps/invoices/views.py) —
  // a second refund call on an already-refunded invoice is rejected by the
  // backend, so the trigger button for this modal is never rendered once
  // status is 'refunded' (see the action footer's ['paid','partially_paid']
  // gate above). This guard is a second, defensive line, not the real gate.
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

// "Edit the whole series going forward" — only recurring_interval_days/
// recurring_auto_send are sent, matching invoice_detail's own narrow PUT
// allowance for a recurring root past its own draft status exactly.
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
