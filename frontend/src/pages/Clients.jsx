// src/pages/Clients.jsx
//
// Client CRM list — apps/clients/ backend only (Step 2), no apps/invoices/
// code. Ports v1's Clients.jsx interaction patterns (search/filter/sort,
// add-client form, archive/restore/flag) against the real v2 endpoints
// and response shape, not v1's API calls. Switched from v1's vertical
// row-list to a fluid card grid per this build's hard layout rule
// (repeat(auto-fit, minmax(240px, 1fr))). Bulk select/bulk-archive/
// bulk-flag from v1 were NOT ported — not asked for in this pass, and
// real added scope (a second toast system, per-row checkboxes) beyond
// the single-client actions this prompt scoped.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Search, X, Plus, Users, Flag, Archive, RotateCcw, ChevronRight,
} from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import FormField from '@/components/FormField'
import FormSelect from '@/components/FormSelect'
import FosAlert from '@/components/FosAlert'
import ClientDetailPanel from '@/components/ClientDetailPanel'
import {
  reliabilityBand, STATUS_BADGE_STYLE, badgeBaseStyle, tagPillStyle, formatMoney,
  CURRENCY_OPTIONS, PAYMENT_TERMS_OPTIONS,
} from './clientHelpers'

// 'all' deliberately removed as a filter pill — search already covers
// "show me everyone" (clearing search/filter is the equivalent), so a
// dedicated pill for it was redundant. The 'all' filter VALUE itself is
// left alone in the backend/EmptyState copy below in case it's ever
// reachable another way; only the pill entry point is gone.
const FILTER_PILLS = [
  { key: 'active', label: 'Active' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'archived', label: 'Archived' },
  { key: 'with_overdue', label: 'Has Overdue' },
  { key: 'new_this_month', label: 'New This Month' },
]

const SORT_OPTIONS = [
  { value: 'name', label: 'Name A → Z' },
  { value: 'recent', label: 'Recently Added' },
  { value: 'total_invoiced', label: 'Highest Value' },
  { value: 'overdue', label: 'Most Overdue' },
]

const EMPTY_CREATE_FORM = {
  name: '', email: '', company: '', phone: '', address: '', country: '',
  default_currency: 'USD', default_payment_terms: 30, notes: '',
}

export default function Clients() {
  useTitle('LanceraOS | Clients')

  const [clients, setClients] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('active')
  const [sort, setSort] = useState('name')

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM)
  const [createErrors, setCreateErrors] = useState({})
  const [createSaving, setCreateSaving] = useState(false)

  const [selectedClientId, setSelectedClientId] = useState(null)
  const [selectedInitialAction, setSelectedInitialAction] = useState(null)
  const [rowBusyId, setRowBusyId] = useState(null)

  const searchTimer = useRef(null)
  // Same stale-response protection as Invoices.jsx's load() — a
  // monotonically increasing request-id checked before committing to
  // state, so an out-of-order response from an earlier filter/search/sort
  // change can never overwrite state with stale data. handleSearchChange
  // below already passes `value` straight into `load()` as an explicit
  // argument rather than reading `search` state inside `load` itself, so
  // (unlike Invoices.jsx before this pass) there was no separate stale-
  // closure bug here to fix — confirmed directly, not assumed identical.
  const latestRequestId = useRef(0)

  const load = useCallback(async (q, f, s) => {
    const requestId = ++latestRequestId.current
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (q) params.search = q
      if (f) params.filter = f
      if (s) params.sort = s
      const { data } = await api.get('/clients/', { params })
      if (requestId !== latestRequestId.current) return // superseded by a newer request — discard
      setClients(data.results || [])
      setTotal(data.total ?? (data.results || []).length)
    } catch {
      if (requestId !== latestRequestId.current) return
      setError('Failed to load clients. Please try again.')
    } finally {
      if (requestId === latestRequestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load(search, filter, sort) }, [filter, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearchChange(value) {
    setSearch(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(value, filter, sort), 300)
  }

  function openCreateForm() {
    setCreateForm(EMPTY_CREATE_FORM)
    setCreateErrors({})
    setShowCreateForm(true)
  }

  async function handleCreateClient() {
    setCreateSaving(true)
    setCreateErrors({})
    try {
      await api.post('/clients/', createForm)
      setShowCreateForm(false)
      load(search, filter, sort)
    } catch (e) {
      const body = e.response?.data
      if (body && typeof body === 'object') {
        setCreateErrors(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])))
      } else {
        setCreateErrors({ general: 'Failed to create client.' })
      }
    } finally {
      setCreateSaving(false)
    }
  }

  async function handleQuickArchive(client) {
    setRowBusyId(client.id)
    try {
      await api.post(`/clients/${client.id}/archive/`)
      load(search, filter, sort)
    } catch { /* no-op */ } finally {
      setRowBusyId(null)
    }
  }

  async function handleQuickRestore(client) {
    setRowBusyId(client.id)
    try {
      await api.post(`/clients/${client.id}/restore/`)
      load(search, filter, sort)
    } catch { /* no-op */ } finally {
      setRowBusyId(null)
    }
  }

  function openDetail(clientId, initialAction = null) {
    setSelectedClientId(clientId)
    setSelectedInitialAction(initialAction)
  }

  return (
    <>
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>Clients</h1>
          {!loading && (
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              {total} client{total !== 1 ? 's' : ''} in this view
            </p>
          )}
        </div>
        <button className="fos-btn fos-btn-accent header-add-btn" onClick={openCreateForm}>
          <Plus size={15} /> Add Client
        </button>
      </div>

      {/* ── Search ── */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
        <input
          type="text"
          className="fos-input"
          style={{ paddingLeft: 36, paddingRight: search ? 36 : 14 }}
          placeholder="Search by name, email, or company…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        {search && (
          <button
            onClick={() => handleSearchChange('')}
            aria-label="Clear search"
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 0 }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* ── Filter pills + Sort, trailing at the right as the row's one
          secondary control (matches Invoices.jsx's identical layout) ──
          Desktop/tablet only — hidden ≤768px in favor of the dropdown
          version below (see that block's comment for why). */}
      <div className="filter-row-desktop" style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', overscrollBehaviorX: 'contain', paddingBottom: 4, flex: 1, minWidth: 0 }}>
          {FILTER_PILLS.map((pill) => {
          const isActive = filter === pill.key
          return (
            <button
              key={pill.key}
              onClick={() => setFilter(pill.key)}
              className="fos-btn"
              style={{
                flexShrink: 0, padding: '6px 14px', fontSize: '0.78rem',
                borderRadius: 'var(--radius-full)',
                background: isActive ? 'var(--accent-glow)' : 'var(--bg-surface)',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                border: `1.5px solid ${isActive ? 'var(--accent)' : 'var(--border-subtle)'}`,
                fontWeight: isActive ? 700 : 500,
              }}
            >
              {pill.label}
            </button>
          )
        })}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="fos-input fos-select" style={{ width: 'auto', minWidth: 180, flexShrink: 0 }}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Mobile (≤768px): same pills as a Filter <select>, same reasoning
          as Invoices.jsx's mobile dropdown — a horizontally-scrollable
          pill row is an awkward fit at phone width. Sits next to the same
          Sort dropdown. Hidden by default so it never flashes before CSS
          loads; shown via the media query below. */}
      <div className="filter-row-mobile" style={{ display: 'none', gap: 8, marginBottom: 20 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="fos-input fos-select" style={{ flex: 1, minWidth: 0 }}>
          {FILTER_PILLS.map((pill) => <option key={pill.key} value={pill.key}>{pill.label}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="fos-input fos-select" style={{ flex: 1, minWidth: 0 }}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* ── Content — same fix as Invoices.jsx: only a genuine first load
          (nothing rendered yet) shows the full skeleton; every subsequent
          refetch keeps the current grid mounted and just dims it, instead
          of unmounting and rebuilding the whole thing on every filter/
          search/sort change. ── */}
      {loading && clients.length === 0 && !error && <ClientGridSkeleton />}

      {error && clients.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>{error}</FosAlert>
          <br />
          <button className="fos-btn fos-btn-ghost" onClick={() => load(search, filter, sort)}>Retry</button>
        </div>
      )}

      {!loading && !error && clients.length === 0 && (
        <EmptyState search={search} filter={filter} onAddClient={openCreateForm} />
      )}

      {clients.length > 0 && (
        <>
          {error && (
            <FosAlert type="error" style={{ marginBottom: 12 }}>
              {error} <button className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={() => load(search, filter, sort)}>Retry</button>
            </FosAlert>
          )}
          <div
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12,
              opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease',
            }}
          >
            {clients.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                busy={rowBusyId === client.id}
                onOpen={() => openDetail(client.id)}
                onFlag={() => openDetail(client.id, 'flag')}
                onArchive={() => handleQuickArchive(client)}
                onRestore={() => handleQuickRestore(client)}
              />
            ))}
          </div>
        </>
      )}

      {/* ── Mobile FAB ── */}
      <button className="page-fab" onClick={openCreateForm} aria-label="Add client" style={{
        display: 'none', position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
        borderRadius: '50%', background: 'var(--accent)', color: '#000', border: 'none',
        boxShadow: '0 4px 20px var(--accent-glow-lg)', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: 90,
      }}>
        <Plus size={24} />
      </button>

      {/* ── Create client modal ── */}
      {showCreateForm && (
        <CreateClientModal
          form={createForm}
          errors={createErrors}
          saving={createSaving}
          onChange={(field, value) => {
            setCreateForm((f) => ({ ...f, [field]: value }))
            if (createErrors[field]) setCreateErrors((prev) => { const n = { ...prev }; delete n[field]; return n })
          }}
          onSubmit={handleCreateClient}
          onClose={() => setShowCreateForm(false)}
        />
      )}

      {/* ── Detail panel ── */}
      {selectedClientId && (
        <ClientDetailPanel
          clientId={selectedClientId}
          initialAction={selectedInitialAction}
          onClose={() => setSelectedClientId(null)}
          onChanged={() => load(search, filter, sort)}
        />
      )}

      <style>{`
        @media (max-width: 768px) {
          .page-fab { display: flex !important; }
          .header-add-btn { display: none !important; }
          .filter-row-desktop { display: none !important; }
          .filter-row-mobile { display: flex !important; }
        }
      `}</style>
    </>
  )
}

// ── ClientCard ────────────────────────────────────────────────────
function ClientCard({ client, busy, onOpen, onFlag, onArchive, onRestore }) {
  const [hovered, setHovered] = useState(false)
  const hasFlag = client.is_flagged || client.auto_flagged
  const band = reliabilityBand(client.payment_stats?.reliability_score)

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative', overflow: 'hidden', cursor: 'pointer',
        background: hovered ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
        border: `1px solid ${hasFlag ? 'var(--status-red)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-lg)', padding: '16px 18px',
        transition: 'background var(--transition-fast)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: hasFlag ? 'var(--status-red-bg)' : 'var(--accent)',
          color: hasFlag ? 'var(--status-red-text)' : '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem', fontWeight: 700,
        }}>
          {(client.name || 'C').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{client.name}</span>
            {!client.is_active && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.gray }}>Archived</span>}
          </div>
          <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {client.email}{client.company && ` · ${client.company}`}
          </p>
        </div>
        <ChevronRight size={15} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
      </div>

      {client.tags?.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {client.tags.map((tag) => (
            <span key={tag.id} style={{ ...tagPillStyle(tag.color), fontSize: '0.66rem', padding: '2px 7px' }}>{tag.name}</span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        <div>
          <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(client.payment_stats?.total_invoiced, client.default_currency)}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>
            {client.payment_stats?.invoice_count ?? 0} invoice{client.payment_stats?.invoice_count !== 1 ? 's' : ''}
          </p>
        </div>
        <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[band.statusKey] }}>{band.label}</span>
      </div>

      {/* Quick actions — stop propagation so they don't also open the panel */}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
        {!hasFlag && (
          <button className="fos-btn fos-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.72rem' }} onClick={onFlag} disabled={busy}>
            <Flag size={12} /> Flag
          </button>
        )}
        {client.is_active ? (
          <button className="fos-btn fos-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.72rem' }} onClick={onArchive} disabled={busy}>
            <Archive size={12} /> Archive
          </button>
        ) : (
          <button className="fos-btn fos-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.72rem' }} onClick={onRestore} disabled={busy}>
            <RotateCcw size={12} /> Restore
          </button>
        )}
      </div>
    </div>
  )
}

// ── ClientGridSkeleton ────────────────────────────────────────────
function ClientGridSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} style={{ height: 148, background: 'var(--bg-surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────────
function EmptyState({ search, filter, onAddClient }) {
  const isSearch = Boolean(search)
  const copy = isSearch
    ? `No clients matching "${search}".`
    : {
        flagged: 'No flagged clients — clients you flag will show up here.',
        archived: 'No archived clients.',
        with_overdue: 'No clients with overdue invoices right now.',
        new_this_month: 'No clients added this month yet.',
        active: 'No active clients yet.',
      }[filter] || 'No clients yet.'

  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <Users size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 10 }} />
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{copy}</p>
      {!isSearch && filter === 'active' && (
        <>
          <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
            Add your first client to start tracking their contact info and invoices.
          </p>
          <button className="fos-btn fos-btn-accent" style={{ marginTop: 16 }} onClick={onAddClient}>
            <Plus size={15} /> Add your first client
          </button>
        </>
      )}
    </div>
  )
}

// ── CreateClientModal ─────────────────────────────────────────────
function CreateClientModal({ form, errors, saving, onChange, onSubmit, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '24px 28px', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', animation: 'modal-in 0.2s cubic-bezier(0.22,1,0.36,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>Add New Client</h2>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField label="Full Name" required value={form.name} onChange={(e) => onChange('name', e.target.value)} error={errors.name} autoFocus />
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

          {errors.general && <FosAlert type="error">{errors.general}</FosAlert>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fos-btn fos-btn-accent" onClick={onSubmit} disabled={saving}>
            {saving ? <span className="fos-spinner" /> : <Plus size={14} />}
            {saving ? 'Adding…' : 'Add Client'}
          </button>
        </div>
      </div>
    </div>
  )
}
