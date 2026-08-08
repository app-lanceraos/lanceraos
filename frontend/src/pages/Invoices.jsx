// src/pages/Invoices.jsx
//
// Invoice list — apps/invoices/ CRUD + lifecycle endpoints from Step 5 only
// (no /send/, no /pdf/, no portal/comments/claims/designs — those are later
// steps, not stubbed here, same "don't build a placeholder" convention as
// the backend). Ports v1's Invoices.jsx interaction patterns (search/filter/
// sort, card list, create flow, mobile FAB) against v2's real endpoints and
// response shapes — v1's stored 'overdue' status badge and its Cash Flow
// Forecast / Currency Diversification sections are deliberately NOT ported
// (see this build's summary for why the latter two are flagged as a product
// conversation, not a default inclusion).
//
// Critical display rule: Overdue is never a status value in v2 — it's
// invoice.days_overdue > 0, a computed flag shown as an orthogonal badge
// alongside whatever the real status is (see apps/invoices/models.py's
// days_overdue docstring). The "Overdue" filter below is a separate toggle
// from the status filter, not a 10th status option, because a sent-and-
// overdue invoice must be reachable by both filters at once.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Search, X, Plus, FileText, ChevronDown, ChevronUp, Layers, BookmarkPlus,
} from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import FosAlert from '@/components/FosAlert'
import InvoiceDetailPanel from '@/components/InvoiceDetailPanel'
import InvoiceFormFields from '@/components/InvoiceFormFields'
import {
  INVOICE_STATUS_META, OVERDUE_BADGE, STATUS_BADGE_STYLE, badgeBaseStyle, formatMoney,
  STATUS_FILTER_OPTIONS, SORT_OPTIONS, formatAggregate, daysOverdueLabel,
  blankInvoiceForm, formToPayload,
} from './invoiceHelpers'

const LIMIT = 60

export default function Invoices() {
  useTitle('LanceraOS | Invoices')

  const [invoices, setInvoices] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [clientFilter, setClientFilter] = useState('')
  const [sort, setSort] = useState('recent')

  const [clients, setClients] = useState([])
  const [presets, setPresets] = useState([])

  const [summary, setSummary] = useState(null)
  const [agingOpen, setAgingOpen] = useState(false)
  const [aging, setAging] = useState(null)
  const [agingLoading, setAgingLoading] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)

  const searchTimer = useRef(null)

  const load = useCallback(async (params, append = false) => {
    if (append) setLoadingMore(true); else { setLoading(true); setError(null) }
    try {
      const { data } = await api.get('/invoices/', { params: { limit: LIMIT, ...params } })
      setInvoices((prev) => (append ? [...prev, ...(data.results || [])] : data.results || []))
      setTotal(data.total ?? 0)
    } catch {
      if (!append) setError('Failed to load invoices. Please try again.')
    } finally {
      if (append) setLoadingMore(false); else setLoading(false)
    }
  }, [])

  function buildParams(offset = 0) {
    const params = { offset }
    if (search) params.search = search
    if (statusFilter) params.status = statusFilter
    if (overdueOnly) params.overdue = 'true'
    if (clientFilter) params.client = clientFilter
    if (sort) params.sort = sort
    return params
  }

  useEffect(() => { load(buildParams(0)) }, [statusFilter, overdueOnly, clientFilter, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/invoices/summary/').then(({ data }) => setSummary(data)).catch(() => setSummary(null))
    api.get('/clients/', { params: { filter: 'all' } }).then(({ data }) => setClients(data.results || [])).catch(() => setClients([]))
    api.get('/invoices/presets/').then(({ data }) => setPresets(data)).catch(() => setPresets([]))
  }, [])

  function handleSearchChange(value) {
    setSearch(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(buildParams(0)), 300)
  }

  function loadMore() {
    load(buildParams(invoices.length), true)
  }

  function refreshAfterChange() {
    load(buildParams(0))
    api.get('/invoices/summary/').then(({ data }) => setSummary(data)).catch(() => {})
    if (agingOpen) loadAging()
  }

  function toggleAging() {
    setAgingOpen((v) => !v)
    if (!aging && !agingOpen) loadAging()
  }

  async function loadAging() {
    setAgingLoading(true)
    try {
      const { data } = await api.get('/invoices/aging-report/')
      setAging(data)
    } catch {
      setAging(null)
    } finally {
      setAgingLoading(false)
    }
  }

  function openDetail(id) {
    setSelectedInvoiceId(id)
  }

  function handleInvoiceChanged(updated, opts) {
    if (opts?.deleted) {
      setInvoices((prev) => prev.filter((inv) => inv.id !== selectedInvoiceId))
      setSelectedInvoiceId(null)
    } else if (updated) {
      setInvoices((prev) => {
        const exists = prev.some((inv) => inv.id === updated.id)
        return exists ? prev.map((inv) => (inv.id === updated.id ? updated : inv)) : [updated, ...prev]
      })
    }
    refreshAfterChange()
  }

  function handleCreated(invoice) {
    setShowCreate(false)
    refreshAfterChange()
    setSelectedInvoiceId(invoice.id)
  }

  return (
    <>
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>Invoices</h1>
          {!loading && (
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              {total} invoice{total !== 1 ? 's' : ''} in this view
            </p>
          )}
        </div>
        <button className="fos-btn fos-btn-accent header-add-btn" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> New Invoice
        </button>
      </div>

      {/* ── Dashboard KPI strip ── */}
      <SummaryStrip summary={summary} />

      {/* ── AR Aging report — collapsible ── */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', marginBottom: 20, overflow: 'hidden' }}>
        <button
          onClick={toggleAging}
          style={{ width: '100%', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-primary)' }}
        >
          <span style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={15} /> Accounts Receivable Aging
          </span>
          {agingOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {agingOpen && (
          <div style={{ padding: '0 16px 16px' }}>
            <AgingReport data={aging} loading={agingLoading} />
          </div>
        )}
      </div>

      {/* ── Search ── */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
        <input
          type="text" className="fos-input" style={{ paddingLeft: 36, paddingRight: search ? 36 : 14 }}
          placeholder="Search by invoice number, client name, or email…"
          value={search} onChange={(e) => handleSearchChange(e.target.value)}
        />
        {search && (
          <button onClick={() => handleSearchChange('')} aria-label="Clear search" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 0 }}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* ── Filters row ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="fos-input fos-select" style={{ width: 'auto', minWidth: 160 }}>
          <option value="">All Clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="fos-input fos-select" style={{ width: 'auto', minWidth: 170 }}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {/* Overdue is a separate toggle, not a status pill — a sent-and-overdue
            invoice must be reachable together with any status pill at once. */}
        <button
          onClick={() => setOverdueOnly((v) => !v)}
          className="fos-btn"
          style={{
            padding: '6px 14px', fontSize: '0.78rem', borderRadius: 'var(--radius-full)',
            background: overdueOnly ? 'var(--status-red-bg)' : 'var(--bg-surface)',
            color: overdueOnly ? 'var(--status-red-text)' : 'var(--text-secondary)',
            border: `1.5px solid ${overdueOnly ? 'var(--status-red)' : 'var(--border-subtle)'}`,
            fontWeight: overdueOnly ? 700 : 500,
          }}
        >
          Overdue Only
        </button>
      </div>

      {/* ── Status pills ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
        {STATUS_FILTER_OPTIONS.map((opt) => {
          const isActive = statusFilter === opt.key
          return (
            <button
              key={opt.key || 'all'}
              onClick={() => setStatusFilter(opt.key)}
              className="fos-btn"
              style={{
                flexShrink: 0, padding: '6px 14px', fontSize: '0.78rem', borderRadius: 'var(--radius-full)',
                background: isActive ? 'var(--accent-glow)' : 'var(--bg-surface)',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                border: `1.5px solid ${isActive ? 'var(--accent)' : 'var(--border-subtle)'}`,
                fontWeight: isActive ? 700 : 500,
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* ── Content ── */}
      {loading && <InvoiceGridSkeleton />}

      {!loading && error && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>{error}</FosAlert>
          <br />
          <button className="fos-btn fos-btn-ghost" onClick={() => load(buildParams(0))}>Retry</button>
        </div>
      )}

      {!loading && !error && invoices.length === 0 && (
        <EmptyState search={search} statusFilter={statusFilter} overdueOnly={overdueOnly} onCreate={() => setShowCreate(true)} />
      )}

      {!loading && !error && invoices.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {invoices.map((inv) => (
              <InvoiceCard key={inv.id} invoice={inv} onOpen={() => openDetail(inv.id)} />
            ))}
          </div>
          {invoices.length < total && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button className="fos-btn fos-btn-ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <span className="fos-spinner" /> : null}
                {loadingMore ? 'Loading…' : `Load More (${invoices.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Mobile FAB ── */}
      <button className="page-fab" onClick={() => setShowCreate(true)} aria-label="New invoice" style={{
        display: 'none', position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
        borderRadius: '50%', background: 'var(--accent)', color: '#000', border: 'none',
        boxShadow: '0 4px 20px var(--accent-glow-lg)', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: 90,
      }}>
        <Plus size={24} />
      </button>

      {/* ── Create invoice panel ── */}
      {showCreate && (
        <CreateInvoicePanel
          clients={clients}
          presets={presets}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {/* ── Detail panel ── */}
      {selectedInvoiceId && (
        <InvoiceDetailPanel
          invoiceId={selectedInvoiceId}
          clients={clients}
          onClose={() => setSelectedInvoiceId(null)}
          onChanged={handleInvoiceChanged}
        />
      )}

      <style>{`
        @media (max-width: 768px) {
          .page-fab { display: flex !important; }
          .header-add-btn { display: none !important; }
        }
      `}</style>
    </>
  )
}

// ── SummaryStrip ──────────────────────────────────────────────────
// Deliberately no currency symbol: invoice_summary sums raw totals across
// every invoice's own currency with no conversion and returns no currency
// field at all (verified directly against apps/invoices/views.py) — see
// formatAggregate's own docstring in invoiceHelpers.js.
function SummaryStrip({ summary }) {
  const cards = [
    { label: 'Outstanding', data: summary?.outstanding, hint: 'sent_via_platform invoices — always zero until Step 10 (/send/) exists', statusKey: 'amber' },
    { label: 'Total Paid', data: summary?.total_paid, hint: 'All-time, net of refunds', statusKey: 'green' },
    { label: 'Past-Due', data: summary?.past_due, hint: 'Outstanding + overdue', statusKey: 'red' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
          <p style={{ margin: 0, fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{c.label}</p>
          {summary ? (
            <>
              <p style={{ margin: '5px 0 2px', fontSize: '1.3rem', fontWeight: 800, color: `var(--status-${c.statusKey}-text)`, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {formatAggregate(c.data?.total)}
              </p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{c.data?.count ?? 0} invoice{c.data?.count !== 1 ? 's' : ''}</p>
            </>
          ) : (
            <div style={{ height: 34, marginTop: 6, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── AgingReport ───────────────────────────────────────────────────
const AGING_BUCKETS = [
  { key: 'current', label: 'Current', statusKey: 'blue' },
  { key: '1_30', label: '1-30 Days', statusKey: 'amber' },
  { key: '31_60', label: '31-60 Days', statusKey: 'amber' },
  { key: '61_90', label: '61-90 Days', statusKey: 'red' },
  { key: 'over_90', label: '90+ Days', statusKey: 'red' },
]
function AgingReport({ data, loading }) {
  if (loading || !data) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        {AGING_BUCKETS.map((b) => <div key={b.key} style={{ height: 64, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />)}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
      {AGING_BUCKETS.map((b) => (
        <div key={b.key} style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
          <p style={{ margin: 0, fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{b.label}</p>
          <p style={{ margin: '4px 0 2px', fontSize: '1.05rem', fontWeight: 800, color: `var(--status-${b.statusKey}-text)`, fontVariantNumeric: 'tabular-nums' }}>{formatAggregate(data[b.key]?.total)}</p>
          <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{data[b.key]?.count ?? 0} invoice{data[b.key]?.count !== 1 ? 's' : ''}</p>
        </div>
      ))}
    </div>
  )
}

// ── InvoiceCard ───────────────────────────────────────────────────
function InvoiceCard({ invoice, onOpen }) {
  const [hovered, setHovered] = useState(false)
  const meta = INVOICE_STATUS_META[invoice.status] || INVOICE_STATUS_META.draft
  const isOverdue = invoice.days_overdue > 0

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: 'pointer', background: hovered ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
        border: `1px solid ${isOverdue ? 'var(--status-red)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-lg)', padding: '16px 18px',
        transition: 'background var(--transition-fast)', display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {invoice.invoice_number || '(unnumbered draft)'}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {invoice.client_name}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
          {isOverdue && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[OVERDUE_BADGE.statusKey] }}>{OVERDUE_BADGE.label}</span>}
          <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[meta.statusKey] }}>{meta.label}</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 }}>
        <div>
          <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(invoice.total, invoice.currency)}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
            Due {invoice.due_date || '—'}
            {isOverdue && <span style={{ color: 'var(--status-red-text)', fontWeight: 600 }}> · {daysOverdueLabel(invoice.days_overdue)}</span>}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── InvoiceGridSkeleton ───────────────────────────────────────────
function InvoiceGridSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} style={{ height: 116, background: 'var(--bg-surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────────
function EmptyState({ search, statusFilter, overdueOnly, onCreate }) {
  const isFiltered = Boolean(search) || Boolean(statusFilter) || overdueOnly
  const copy = search
    ? `No invoices matching "${search}".`
    : overdueOnly
      ? 'No overdue invoices right now.'
      : statusFilter
        ? `No ${(INVOICE_STATUS_META[statusFilter]?.label || statusFilter).toLowerCase()} invoices.`
        : 'No invoices yet.'

  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <FileText size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 10 }} />
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{copy}</p>
      {!isFiltered && (
        <>
          <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
            Create your first invoice to start tracking payments and due dates.
          </p>
          <button className="fos-btn fos-btn-accent" style={{ marginTop: 16 }} onClick={onCreate}>
            <Plus size={15} /> Create your first invoice
          </button>
        </>
      )}
    </div>
  )
}

// ── CreateInvoicePanel ────────────────────────────────────────────
function CreateInvoicePanel({ clients, presets, onClose, onCreated }) {
  const [tab, setTab] = useState('blank')
  const [form, setForm] = useState(blankInvoiceForm)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [presetBusyId, setPresetBusyId] = useState(null)

  async function handleSubmit() {
    setSaving(true)
    setErrors({})
    try {
      const { data } = await api.post('/invoices/', formToPayload(form))
      onCreated(data)
    } catch (e) {
      const body = e.response?.data
      if (body && typeof body === 'object') {
        setErrors(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])))
      } else {
        setErrors({ general: 'Failed to create invoice.' })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleFromPreset(preset) {
    setPresetBusyId(preset.id)
    try {
      const { data } = await api.post(`/invoices/presets/${preset.id}/create-invoice/`)
      onCreated(data)
    } catch {
      setErrors({ general: 'Failed to create invoice from this preset.' })
    } finally {
      setPresetBusyId(null)
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 100 }} />
      <div style={{
        position: 'fixed', top: 'var(--header-h)', right: 0, bottom: 0, width: '100%', maxWidth: 600,
        background: 'var(--bg-surface)', boxShadow: '-8px 0 32px rgba(0,0,0,0.2)', zIndex: 101,
        overflowY: 'auto', animation: 'panel-slide-in 0.2s cubic-bezier(0.22,1,0.36,1)',
      }}>
        <div style={{ padding: '20px 24px 40px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>New Invoice</h2>
            <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 8 }}><X size={16} /></button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border-subtle)' }}>
            <button
              onClick={() => setTab('blank')}
              style={{ padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: tab === 'blank' ? 600 : 500, color: tab === 'blank' ? 'var(--text-primary)' : 'var(--text-tertiary)', borderBottom: tab === 'blank' ? '2px solid var(--accent)' : '2px solid transparent' }}
            >
              Blank Invoice
            </button>
            <button
              onClick={() => setTab('preset')}
              style={{ padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: tab === 'preset' ? 600 : 500, color: tab === 'preset' ? 'var(--text-primary)' : 'var(--text-tertiary)', borderBottom: tab === 'preset' ? '2px solid var(--accent)' : '2px solid transparent' }}
            >
              Start from Preset
            </button>
          </div>

          {errors.general && <FosAlert type="error" style={{ marginBottom: 16 }}>{errors.general}</FosAlert>}

          {tab === 'blank' ? (
            <>
              <InvoiceFormFields form={form} setForm={setForm} errors={errors} clients={clients} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
                <button className="fos-btn fos-btn-accent" onClick={handleSubmit} disabled={saving}>
                  {saving ? <span className="fos-spinner" /> : <Plus size={14} />}
                  {saving ? 'Creating…' : 'Create Draft'}
                </button>
              </div>
            </>
          ) : (
            <PresetPicker presets={presets} busyId={presetBusyId} onPick={handleFromPreset} />
          )}
        </div>
      </div>
    </>
  )
}

function PresetPicker({ presets, busyId, onPick }) {
  if (presets.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 32, background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        <BookmarkPlus size={24} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
          No presets yet. Save one from an existing invoice's "Save as Preset" action.
        </p>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {presets.map((p) => (
        <button
          key={p.id} onClick={() => onPick(p)} disabled={busyId === p.id}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', padding: '12px 14px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
        >
          <div>
            <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {p.name}{p.is_default && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.blue, marginLeft: 8 }}>Default</span>}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
              {p.currency} · {p.items?.length || 0} item{p.items?.length !== 1 ? 's' : ''}{p.include_client ? ` · ${p.client_name}` : ''}
            </p>
          </div>
          {busyId === p.id && <span className="fos-spinner" />}
        </button>
      ))}
    </div>
  )
}
