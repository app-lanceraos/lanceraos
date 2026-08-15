// src/components/ClientDetailPanel.jsx
//
// Slide-in side panel for a single client's full record — DESIGN.md
// Section 7's slide-in panel recipe (overlay z-index 100), not a separate
// route. v1's ClientDetail.jsx was a full page (maxWidth: 900) with the
// same content; this panel keeps the same information (contact info,
// stat cards, Invoices/Analytics/Notes tabs, edit/archive/flag actions)
// but widens the recipe's example maxWidth (480 -> 600) so four stat
// cards and the tab content have room to breathe — the overlay/zIndex/
// animation contract itself is unchanged from the documented recipe.
//
// Lives in components/, not pages/, because — unlike everything in
// pages/ — it is never routed directly; Clients.jsx mounts it
// conditionally when a client is selected, the same way DeletionModal.jsx
// is a components/ file that isn't a route either.
import { useEffect, useState } from 'react'
import {
  X, Flag, Archive, RotateCcw, Pencil, Plus, FileText, StickyNote, BarChart3, Tag as TagIcon, FileDown,
} from 'lucide-react'

import api from '@/lib/api'
import FormField from './FormField'
import FormSelect from './FormSelect'
import FosAlert from './FosAlert'
import {
  reliabilityBand, STATUS_BADGE_STYLE, badgeBaseStyle, tagPillStyle, formatMoney,
  FLAG_TYPE_OPTIONS, CURRENCY_OPTIONS, PAYMENT_TERMS_OPTIONS,
} from '@/pages/clientHelpers'

const TABS = [
  { id: 'invoices', label: 'Invoices', Icon: FileText },
  { id: 'analytics', label: 'Analytics', Icon: BarChart3 },
  { id: 'notes', label: 'Notes', Icon: StickyNote },
]

// Provisional — apps.invoices doesn't exist yet, so this mapping has
// never been exercised against a real invoice status. Kept local to this
// file rather than in clientHelpers.js since it'll likely need revision
// once that module actually lands.
function invoiceStatusBand(status) {
  if (status === 'paid') return 'green'
  if (status === 'partially_paid' || status === 'sent' || status === 'viewed') return 'blue'
  if (status === 'overdue' || status === 'bad_debt') return 'red'
  return 'gray'
}

export default function ClientDetailPanel({ clientId, initialAction, onClose, onChanged }) {
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [notes, setNotes] = useState([])
  const [noteInput, setNoteInput] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  const [allTags, setAllTags] = useState([])
  const [tagBusyId, setTagBusyId] = useState(null)
  const [showNewTagForm, setShowNewTagForm] = useState(false)
  const [newTag, setNewTag] = useState({ name: '', color: '#00c896' })
  const [newTagError, setNewTagError] = useState('')

  const [invoices, setInvoices] = useState([])
  const [invoicesLoading, setInvoicesLoading] = useState(true)

  const [activeTab, setActiveTab] = useState('invoices')

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [editErrors, setEditErrors] = useState({})
  const [editSaving, setEditSaving] = useState(false)

  const [flagging, setFlagging] = useState(false)
  const [flagForm, setFlagForm] = useState({ flag_type: 'payment_risk', flag_reason: '' })
  const [flagError, setFlagError] = useState('')
  const [flagSaving, setFlagSaving] = useState(false)

  const [showStatementModal, setShowStatementModal] = useState(false)

  const [actionBusy, setActionBusy] = useState(false)

  useEffect(() => { loadClient() }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadNotesAndTags() }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadInvoices() }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Entry point from the list card's one-click "Flag" quick action — opens
  // straight into the flag modal once the client record is loaded, rather
  // than making flag a true one-click card action (it needs a reason, so
  // it can't be a single click regardless of where it's triggered from).
  useEffect(() => {
    if (initialAction === 'flag' && client && !loading) {
      setFlagging(true)
    }
  }, [initialAction, client, loading])

  async function loadClient() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get(`/clients/${clientId}/`)
      setClient(data)
      setEditForm({
        name: data.name, email: data.email, company: data.company || '',
        phone: data.phone || '', address: data.address || '', country: data.country || '',
        default_currency: data.default_currency, default_payment_terms: data.default_payment_terms,
        notes: data.notes || '',
      })
    } catch {
      setError('Failed to load this client. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function loadNotesAndTags() {
    try {
      const { data } = await api.get(`/clients/${clientId}/notes/`)
      setNotes(data)
    } catch {
      setNotes([])
    }
    try {
      const { data } = await api.get('/clients/tags/')
      setAllTags(data)
    } catch {
      setAllTags([])
    }
  }

  async function loadInvoices() {
    setInvoicesLoading(true)
    try {
      // apps.invoices doesn't exist yet — this 404s today. Caught and
      // treated identically to a genuinely-empty result, the same
      // pattern AppShell.jsx already uses for the notification bell.
      const { data } = await api.get('/invoices/', { params: { client: clientId } })
      setInvoices(Array.isArray(data) ? data : data.results || [])
    } catch {
      setInvoices([])
    } finally {
      setInvoicesLoading(false)
    }
  }

  function notifyChanged() {
    onChanged?.()
  }

  async function handleArchive() {
    setActionBusy(true)
    try {
      const { data } = await api.post(`/clients/${clientId}/archive/`)
      setClient(data)
      notifyChanged()
    } catch { /* surfaced by the button simply not changing state */ } finally {
      setActionBusy(false)
    }
  }

  async function handleRestore() {
    setActionBusy(true)
    try {
      const { data } = await api.post(`/clients/${clientId}/restore/`)
      setClient(data)
      notifyChanged()
    } catch { /* no-op */ } finally {
      setActionBusy(false)
    }
  }

  async function handleUnflag() {
    setActionBusy(true)
    try {
      const { data } = await api.post(`/clients/${clientId}/flag/`, { clear: true })
      setClient(data)
      notifyChanged()
    } catch { /* no-op */ } finally {
      setActionBusy(false)
    }
  }

  async function handleFlag() {
    if (!flagForm.flag_reason.trim()) {
      setFlagError('A reason is required to flag a client.')
      return
    }
    setFlagSaving(true)
    setFlagError('')
    try {
      const { data } = await api.post(`/clients/${clientId}/flag/`, flagForm)
      setClient(data)
      setFlagging(false)
      notifyChanged()
    } catch (e) {
      setFlagError(e.response?.data?.error || 'Failed to flag this client.')
    } finally {
      setFlagSaving(false)
    }
  }

  async function handleSaveEdit() {
    setEditSaving(true)
    setEditErrors({})
    try {
      const { data } = await api.put(`/clients/${clientId}/`, editForm)
      setClient(data)
      setEditing(false)
      notifyChanged()
    } catch (e) {
      const body = e.response?.data
      if (body && typeof body === 'object') {
        setEditErrors(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])))
      } else {
        setEditErrors({ general: 'Failed to save changes.' })
      }
    } finally {
      setEditSaving(false)
    }
  }

  async function handleAddNote() {
    if (!noteInput.trim()) return
    setNoteSaving(true)
    try {
      const { data } = await api.post(`/clients/${clientId}/notes/`, { content: noteInput })
      setNotes((prev) => [data, ...prev])
      setNoteInput('')
    } catch { /* no-op — input keeps the unsent text so nothing is lost */ } finally {
      setNoteSaving(false)
    }
  }

  async function handleDeleteNote(noteId) {
    try {
      await api.delete(`/clients/${clientId}/notes/${noteId}/`)
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
    } catch { /* no-op */ }
  }

  async function handleAttachTag(tagId) {
    setTagBusyId(tagId)
    try {
      const { data } = await api.post(`/clients/${clientId}/tags/${tagId}/attach/`)
      setClient(data)
      notifyChanged()
    } catch { /* no-op */ } finally {
      setTagBusyId(null)
    }
  }

  async function handleDetachTag(tagId) {
    setTagBusyId(tagId)
    try {
      const { data } = await api.delete(`/clients/${clientId}/tags/${tagId}/`)
      setClient(data)
      notifyChanged()
    } catch { /* no-op */ } finally {
      setTagBusyId(null)
    }
  }

  async function handleCreateTag() {
    if (!newTag.name.trim()) { setNewTagError('Tag name is required.'); return }
    setNewTagError('')
    try {
      const { data } = await api.post('/clients/tags/', newTag)
      setAllTags((prev) => [...prev, data])
      await handleAttachTag(data.id)
      setNewTag({ name: '', color: '#00c896' })
      setShowNewTagForm(false)
    } catch (e) {
      setNewTagError(e.response?.data?.name?.[0] || e.response?.data?.color?.[0] || 'Failed to create tag.')
    }
  }

  const hasFlag = client && (client.is_flagged || client.auto_flagged)
  const attachedTagIds = new Set((client?.tags || []).map((t) => t.id))
  const availableTags = allTags.filter((t) => !attachedTagIds.has(t.id))

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 100 }} />
      <div style={{
        position: 'fixed', top: 'var(--header-h)', right: 0, bottom: 0, width: '100%', maxWidth: 600,
        background: 'var(--bg-surface)', boxShadow: '-8px 0 32px rgba(0,0,0,0.2)', zIndex: 101,
        overflowY: 'auto', animation: 'panel-slide-in 0.2s cubic-bezier(0.22,1,0.36,1)',
      }}>
        <div style={{ padding: '20px 24px 32px' }}>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 8, marginBottom: 12 }}>
            <X size={16} />
          </button>

          {loading && <PanelSkeleton />}

          {!loading && error && (
            <FosAlert type="error">{error}</FosAlert>
          )}

          {!loading && !error && client && (
            <>
              {/* ── Header ── */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{
                  width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
                  background: hasFlag ? 'var(--status-red-bg)' : 'var(--accent)',
                  color: hasFlag ? 'var(--status-red-text)' : '#000',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.3rem', fontWeight: 700,
                }}>
                  {(client.name || 'C').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>{client.name}</h2>
                    {hasFlag && (
                      <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.red }}>
                        <Flag size={11} style={{ marginRight: 4 }} />
                        {client.auto_flagged ? 'Auto-flagged' : 'Flagged'}
                      </span>
                    )}
                    {!client.is_active && (
                      <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.gray }}>Archived</span>
                    )}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
                    {client.email}{client.company && ` · ${client.company}`}{client.phone && ` · ${client.phone}`}
                  </p>
                  {(client.address || client.country) && (
                    <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                      {[client.address, client.country].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>

              {/* ── Quick actions ── */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                <button className="fos-btn fos-btn-ghost" onClick={() => setEditing(true)}>
                  <Pencil size={14} /> Edit
                </button>
                {hasFlag ? (
                  <button className="fos-btn fos-btn-ghost" onClick={handleUnflag} disabled={actionBusy}>
                    <Flag size={14} /> Remove Flag
                  </button>
                ) : (
                  <button className="fos-btn fos-btn-ghost" onClick={() => setFlagging(true)}>
                    <Flag size={14} /> Flag
                  </button>
                )}
                {client.is_active ? (
                  <button className="fos-btn fos-btn-ghost" onClick={handleArchive} disabled={actionBusy}>
                    <Archive size={14} /> Archive
                  </button>
                ) : (
                  <button className="fos-btn fos-btn-ghost" onClick={handleRestore} disabled={actionBusy}>
                    <RotateCcw size={14} /> Restore
                  </button>
                )}
                <button className="fos-btn fos-btn-ghost" onClick={() => setShowStatementModal(true)}>
                  <FileDown size={14} /> Statement
                </button>
              </div>

              {/* ── Tags ── */}
              <div style={{ marginBottom: 24 }}>
                <p className="fos-label" style={{ marginBottom: 8 }}>Tags</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(client.tags || []).map((tag) => (
                    <span key={tag.id} style={tagPillStyle(tag.color)}>
                      <TagIcon size={11} style={{ marginRight: 4 }} />
                      {tag.name}
                      <button
                        onClick={() => handleDetachTag(tag.id)}
                        disabled={tagBusyId === tag.id}
                        aria-label={`Remove ${tag.name} tag`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 0, marginLeft: 5 }}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  {availableTags.length > 0 && (
                    <select
                      className="fos-input fos-select"
                      style={{ width: 'auto', padding: '4px 28px 4px 10px', fontSize: '0.78rem' }}
                      value=""
                      onChange={(e) => e.target.value && handleAttachTag(e.target.value)}
                    >
                      <option value="">Attach a tag…</option>
                      {availableTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                    </select>
                  )}
                  <button className="fos-btn fos-btn-ghost" style={{ padding: '5px 12px' }} onClick={() => setShowNewTagForm((v) => !v)}>
                    <Plus size={13} /> New tag
                  </button>
                </div>
                {showNewTagForm && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
                    <input
                      className="fos-input" style={{ width: 160 }} placeholder="Tag name"
                      value={newTag.name} onChange={(e) => setNewTag((t) => ({ ...t, name: e.target.value }))}
                    />
                    <input
                      type="color" value={newTag.color}
                      onChange={(e) => setNewTag((t) => ({ ...t, color: e.target.value }))}
                      style={{ width: 40, height: 38, border: '1.5px solid var(--input-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'var(--input-bg)' }}
                    />
                    <button className="fos-btn fos-btn-accent" onClick={handleCreateTag}>Add</button>
                  </div>
                )}
                {newTagError && <p className="fos-error">{newTagError}</p>}
              </div>

              {/* ── Stat cards — real numbers, genuinely zero until apps.invoices exists ── */}
              <StatCards paymentStats={client.payment_stats} currency={client.default_currency} />

              {/* ── Tabs ── */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
                {TABS.map((tab) => {
                  const isActive = activeTab === tab.id
                  const count = tab.id === 'notes' ? ` (${notes.length})` : ''
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px',
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: '0.85rem', fontWeight: isActive ? 600 : 500,
                        color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
                        borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                        transition: 'color var(--transition-fast), border-color var(--transition-fast)',
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      <tab.Icon size={14} />
                      {tab.label}{count}
                    </button>
                  )
                })}
              </div>

              {activeTab === 'invoices' && (
                <InvoicesTab loading={invoicesLoading} invoices={invoices} />
              )}
              {activeTab === 'analytics' && (
                <AnalyticsTab paymentStats={client.payment_stats} />
              )}
              {activeTab === 'notes' && (
                <NotesTab
                  notes={notes} input={noteInput} saving={noteSaving}
                  onInputChange={setNoteInput} onAdd={handleAddNote} onDelete={handleDeleteNote}
                />
              )}
            </>
          )}
        </div>
      </div>

      {editing && client && (
        <EditClientModal
          form={editForm} errors={editErrors} saving={editSaving}
          onChange={(field, value) => setEditForm((f) => ({ ...f, [field]: value }))}
          onSave={handleSaveEdit}
          onClose={() => { setEditing(false); setEditErrors({}) }}
        />
      )}

      {flagging && client && (
        <FlagClientModal
          clientName={client.name} form={flagForm} error={flagError} saving={flagSaving}
          onChange={(field, value) => setFlagForm((f) => ({ ...f, [field]: value }))}
          onFlag={handleFlag}
          onClose={() => { setFlagging(false); setFlagError('') }}
        />
      )}

      {showStatementModal && client && (
        <StatementModal clientId={client.id} onClose={() => setShowStatementModal(false)} />
      )}
    </>
  )
}

// ── StatCards ─────────────────────────────────────────────────────
function StatCards({ paymentStats, currency }) {
  const stats = paymentStats || {}
  const band = reliabilityBand(stats.reliability_score)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 24 }}>
      <StatCard label="Total Invoiced" value={formatMoney(stats.total_invoiced, currency)} />
      <StatCard label="Total Paid" value={formatMoney(stats.total_paid, currency)} />
      <StatCard label="Invoices" value={stats.invoice_count ?? 0} />
      <StatCard
        label="Reliability"
        value={band.label}
        sub={stats.reliability_score !== null && stats.reliability_score !== undefined ? `Score: ${stats.reliability_score}` : undefined}
      />
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
      <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{sub}</p>}
    </div>
  )
}

// ── InvoicesTab ───────────────────────────────────────────────────
function InvoicesTab({ loading, invoices }) {
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ height: 56, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-lg)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
        ))}
      </div>
    )
  }
  if (invoices.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 32, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
        No invoices yet. Invoices you create for this client will show up here.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {invoices.map((inv) => (
        <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
          <div>
            <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{inv.invoice_number}</p>
            {inv.due_date && <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Due {inv.due_date}</p>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(inv.total, inv.currency)}
            </p>
            <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[invoiceStatusBand(inv.status)], marginTop: 3 }}>
              {inv.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── AnalyticsTab ──────────────────────────────────────────────────
function AnalyticsTab({ paymentStats }) {
  const stats = paymentStats || {}
  const breakdown = stats.reliability_breakdown || {}
  const band = reliabilityBand(stats.reliability_score)
  const rows = [
    { key: 'paid_on_time', label: 'Paid on time', statusKey: 'green' },
    { key: 'late_1_to_30_days', label: 'Paid 1-30 days late', statusKey: 'amber' },
    { key: 'late_31_plus_days', label: 'Paid 31+ days late', statusKey: 'red' },
    { key: 'bad_debt', label: 'Bad debt', statusKey: 'red' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 20px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Reliability
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[band.statusKey], fontSize: '0.8rem', padding: '4px 12px' }}>{band.label}</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
            {breakdown.qualifying_invoices
              ? `Based on ${breakdown.qualifying_invoices} completed invoice${breakdown.qualifying_invoices !== 1 ? 's' : ''}`
              : 'No completed invoices yet — this fills in automatically once invoices exist.'}
          </span>
        </div>
      </div>

      {breakdown.qualifying_invoices > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Payment Outcome Breakdown
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((row) => (
              <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{row.label}</span>
                <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[row.statusKey] }}>{breakdown[row.key] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── NotesTab ──────────────────────────────────────────────────────
// Add + list + delete only. ClientNote's model carries `updated_at` (it
// is NOT specified as immutable the way InvoiceComment is), but
// apps/clients' Step 2 backend never actually added an update endpoint
// for it (no PUT/PATCH route exists) — so editing isn't built here. Real
// gap, not an oversight; flagged in this build's summary.
function NotesTab({ notes, input, saving, onInputChange, onAdd, onDelete }) {
  return (
    <div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 16 }}>
        <textarea
          className="fos-input"
          style={{ minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Add a private note about this client…"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onAdd() }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <p className="fos-hint" style={{ margin: 0 }}>Ctrl+Enter to save</p>
          <button className="fos-btn fos-btn-accent" onClick={onAdd} disabled={!input.trim() || saving}>
            {saving ? <span className="fos-spinner" /> : null}
            {saving ? 'Saving…' : 'Add Note'}
          </button>
        </div>
      </div>

      {notes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
          No notes yet. Add your first note above — only you can see these.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {notes.map((note) => (
          <div key={note.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{note.content}</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
              <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{new Date(note.created_at).toLocaleString()}</p>
              <button
                onClick={() => onDelete(note.id)}
                className="fos-btn fos-btn-ghost"
                style={{ padding: '4px 10px', fontSize: '0.72rem' }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── EditClientModal — centered modal, z-index 200 (above the panel's 100/101) ──
function EditClientModal({ form, errors, saving, onChange, onSave, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '24px 28px', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', animation: 'modal-in 0.2s cubic-bezier(0.22,1,0.36,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>Edit Client</h2>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField label="Full Name" required value={form.name} onChange={(e) => onChange('name', e.target.value)} error={errors.name} />
          <FormField label="Email" type="email" required value={form.email} onChange={(e) => onChange('email', e.target.value)} error={errors.email} />
          <FormField label="Company" value={form.company} onChange={(e) => onChange('company', e.target.value)} error={errors.company} />
          <FormField label="Phone" value={form.phone} onChange={(e) => onChange('phone', e.target.value)} error={errors.phone} />
          <FormField label="Address" value={form.address} onChange={(e) => onChange('address', e.target.value)} error={errors.address} />
          <FormField label="Country" value={form.country} onChange={(e) => onChange('country', e.target.value)} error={errors.country} />

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <FormSelect label="Default Currency" value={form.default_currency} onChange={(e) => onChange('default_currency', e.target.value)} options={CURRENCY_OPTIONS} />
              {errors.default_currency && <p className="fos-error">{errors.default_currency}</p>}
            </div>
            <div style={{ flex: 1 }}>
              <FormSelect label="Payment Terms" value={form.default_payment_terms} onChange={(e) => onChange('default_payment_terms', Number(e.target.value))} options={PAYMENT_TERMS_OPTIONS} />
            </div>
          </div>

          <div>
            <label className="fos-label">Internal Notes</label>
            <textarea
              className="fos-input" style={{ minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
              value={form.notes || ''} onChange={(e) => onChange('notes', e.target.value)}
              placeholder="Private notes — never shown to the client"
            />
          </div>

          {errors.general && <FosAlert type="error">{errors.general}</FosAlert>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fos-btn fos-btn-accent" onClick={onSave} disabled={saving}>
            {saving ? <span className="fos-spinner" /> : null}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── FlagClientModal ───────────────────────────────────────────────
function FlagClientModal({ clientName, form, error, saving, onChange, onFlag, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '24px 28px', width: '100%', maxWidth: 440, animation: 'modal-in 0.2s cubic-bezier(0.22,1,0.36,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>Flag {clientName}</h2>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormSelect label="Flag Type" value={form.flag_type} onChange={(e) => onChange('flag_type', e.target.value)} options={FLAG_TYPE_OPTIONS} />
          <div>
            <label className="fos-label">Reason<span className="required"> *</span></label>
            <textarea
              className="fos-input" style={{ minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
              value={form.flag_reason} onChange={(e) => onChange('flag_reason', e.target.value)}
              placeholder="Describe why you're flagging this client…"
            />
          </div>
          {error && <p className="fos-error">{error}</p>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fos-btn fos-btn-danger" onClick={onFlag} disabled={saving}>
            {saving ? <span className="fos-spinner" /> : <Flag size={14} />}
            {saving ? 'Flagging…' : 'Flag Client'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── StatementModal ────────────────────────────────────────────────
// GET /api/clients/<pk>/statement/pdf/ is auth-cookie-protected but
// deliberately reached via a plain browser navigation (window.open),
// never an Axios blob-fetch dance — the httpOnly session cookie already
// travels on a normal top-level GET navigation to the API's own origin
// (COOKIE_SAMESITE=Lax explicitly allows this), the exact same real
// precedent ClientPortal.jsx's own portal_view_url <a href> already
// established for a protected/credentialed PDF-ish document. The
// endpoint responds with Content-Disposition: attachment, so the
// browser downloads it directly — no client-side blob/save-as code
// needed either.
const ONE_YEAR_AGO = (() => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().slice(0, 10)
})()
const TODAY = new Date().toISOString().slice(0, 10)

function StatementModal({ clientId, onClose }) {
  const [start, setStart] = useState(ONE_YEAR_AGO)
  const [end, setEnd] = useState(TODAY)
  const [error, setError] = useState('')

  function handleDownload() {
    if (start > end) { setError('Start date must be on or before the end date.'); return }
    setError('')
    const url = `${api.defaults.baseURL}/clients/${clientId}/statement/pdf/?start=${start}&end=${end}`
    window.open(url, '_blank')
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '24px 28px', width: '100%', maxWidth: 400, animation: 'modal-in 0.2s cubic-bezier(0.22,1,0.36,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>Generate Statement</h2>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="settings-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FormField label="Start Date" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            <FormField label="End Date" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          {error && <p className="fos-error">{error}</p>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fos-btn fos-btn-accent" onClick={handleDownload}>
            <FileDown size={14} /> Download PDF
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PanelSkeleton ─────────────────────────────────────────────────
function PanelSkeleton() {
  const bar = (w, h = 16) => (
    <div style={{ width: w, height: h, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
  )
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, alignItems: 'flex-start' }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--bg-surface-3)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bar('50%', 22)}
          {bar('70%', 14)}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ height: 68, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-lg)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  )
}
