// src/pages/Clients.jsx
//
// Client CRM list — apps/clients/ backend only, no apps/invoices/ code.
// List/Table restructure pass (see Invoices.jsx's own header comment for
// the full reasoning shared across both pages — this file applies the
// identical pattern minus anything invoice-specific):
//   - Header action ("+ Add Client") moved out of this page's own inline
//     header into AppShell's shared header via usePageHeaderActions.
//     Mobile keeps the existing FAB as the real entry point; no 3-dot
//     menu appears here at all (mobileItems is empty — there's nothing
//     else to fold into one), matching AppShell's own "absent when
//     empty" convention.
//   - Sort moved onto the search row.
//   - The currency filter (a real WHERE-clause filter on
//     Client.default_currency) joins the existing filter-pill row, with
//     the same real measured-width overflow (useFilterOverflow.js) into
//     a "More filters" dropdown Invoices.jsx uses.
//   - Pagination: the old flat single-fetch list is now uniform, real
//     server-paginated (20/page, numbered nav) — see Pagination.jsx.
// No KPI cards, no period/currency-conversion controls — Clients has no
// financial summary concept, unlike Invoices' own KPI strip. No bulk
// selection either — never existed here and isn't being added now
// (deferred, confirmed with Ali — see DECISIONS.md).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, X, Plus, Users, Flag, Archive, RotateCcw, ChevronRight, ArrowUpDown,
} from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import usePageHeaderActions from '@/hooks/usePageHeaderActions'
import useFilterOverflow from '@/hooks/useFilterOverflow'
import DropdownMenu from '@/components/DropdownMenu'
import FilterPill from '@/components/FilterPill'
import FilterOverflowMenu from '@/components/FilterOverflowMenu'
import FormField from '@/components/FormField'
import FormSelect from '@/components/FormSelect'
import FosAlert from '@/components/FosAlert'
import ClientDetailPanel from '@/components/ClientDetailPanel'
import Pagination from '@/components/Pagination'
import {
  reliabilityBand, STATUS_BADGE_STYLE, badgeBaseStyle, tagPillStyle, formatMoney,
  CURRENCY_OPTIONS, PAYMENT_TERMS_OPTIONS,
} from './clientHelpers'

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
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('active')
  const [currencyFilter, setCurrencyFilter] = useState('')
  const [availableCurrencies, setAvailableCurrencies] = useState([])
  const [sort, setSort] = useState('name')

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM)
  const [createErrors, setCreateErrors] = useState({})
  const [createSaving, setCreateSaving] = useState(false)

  const [selectedClientId, setSelectedClientId] = useState(null)
  const [selectedInitialAction, setSelectedInitialAction] = useState(null)
  const [rowBusyId, setRowBusyId] = useState(null)

  const searchTimer = useRef(null)
  const latestRequestId = useRef(0)

  function openCreateForm() {
    setCreateForm(EMPTY_CREATE_FORM)
    setCreateErrors({})
    setShowCreateForm(true)
  }

  // Memoized for the same reason as Invoices.jsx's own header actions —
  // AppShell re-renders on every setPageHeaderActions call, which
  // re-renders this unmemoized page too; a fresh JSX node every render
  // would re-fire usePageHeaderActions' effect every time, a real
  // infinite loop.
  const desktopHeaderActions = useMemo(() => (
    <button className="fos-btn fos-btn-accent" onClick={openCreateForm}>
      <Plus size={15} /> Add Client
    </button>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [])
  usePageHeaderActions({ desktop: desktopHeaderActions, mobileItems: [] })

  function buildParams(targetPage, overrides = {}) {
    const params = { offset: (targetPage - 1) * 20, limit: 20 }
    const searchVal = 'search' in overrides ? overrides.search : search
    const filterVal = 'filter' in overrides ? overrides.filter : filter
    const currencyVal = 'currency' in overrides ? overrides.currency : currencyFilter
    if (searchVal) params.search = searchVal
    if (filterVal) params.filter = filterVal
    if (sort) params.sort = sort
    if (currencyVal) params.currency = currencyVal
    return params
  }

  const load = useCallback(async (targetPage, overrides = {}) => {
    const requestId = ++latestRequestId.current
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/clients/', { params: buildParams(targetPage, overrides) })
      if (requestId !== latestRequestId.current) return
      const results = data.results || []
      const totalCount = data.total ?? results.length
      if (results.length === 0 && targetPage > 1 && totalCount > 0) {
        return load(targetPage - 1, overrides)
      }
      setPage(targetPage)
      setClients(results)
      setTotal(totalCount)
    } catch {
      if (requestId !== latestRequestId.current) return
      setError('Failed to load clients. Please try again.')
    } finally {
      if (requestId === latestRequestId.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, currencyFilter, sort])

  useEffect(() => { load(1) }, [filter, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/clients/currencies/').then(({ data }) => setAvailableCurrencies(data.currencies || [])).catch(() => setAvailableCurrencies([]))
  }, [])

  function handleSearchChange(value) {
    setSearch(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(1, { search: value }), 300)
  }

  function selectCurrencyFilter(value) {
    setCurrencyFilter(value)
    load(1, { currency: value })
  }

  function goToPage(n) {
    load(n)
  }

  async function handleCreateClient() {
    setCreateSaving(true)
    setCreateErrors({})
    try {
      await api.post('/clients/', createForm)
      setShowCreateForm(false)
      load(1)
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
      load(page)
    } catch { /* no-op */ } finally {
      setRowBusyId(null)
    }
  }

  async function handleQuickRestore(client) {
    setRowBusyId(client.id)
    try {
      await api.post(`/clients/${client.id}/restore/`)
      load(page)
    } catch { /* no-op */ } finally {
      setRowBusyId(null)
    }
  }

  function openDetail(clientId, initialAction = null) {
    setSelectedClientId(clientId)
    setSelectedInitialAction(initialAction)
  }

  // ── Filter row chips + real measured-width overflow ──
  const pillChips = FILTER_PILLS.map((pill) => ({
    type: 'pill', key: pill.key, label: pill.label, active: filter === pill.key,
    onClick: () => { setFilter(pill.key); load(1, { filter: pill.key }) },
  }))
  const currencyChip = { type: 'currency', key: 'currency', value: currencyFilter, options: availableCurrencies, onChange: selectCurrencyFilter }
  const allChips = [...pillChips, currencyChip]
  const { containerRef, measureRefs, moreRef, visibleCount } = useFilterOverflow(allChips.length)
  const visibleChips = allChips.slice(0, visibleCount)
  const overflowChips = allChips.slice(visibleCount)

  return (
    <>
      {/* Page title + client-count line removed (bug-fix round) — redundant
          with AppShell's own header title, which already shows "Clients". */}

      {/* ── Search + Sort row ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <input
            type="text" className="fos-input" style={{ paddingLeft: 36, paddingRight: search ? 36 : 14 }}
            placeholder="Search by name, email, or company…"
            value={search} onChange={(e) => handleSearchChange(e.target.value)}
          />
          {search && (
            <button onClick={() => handleSearchChange('')} aria-label="Clear search" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 0 }}>
              <X size={15} />
            </button>
          )}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="fos-input fos-select sort-select-desktop" style={{ width: 'auto', minWidth: 180, flexShrink: 0 }}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="sort-icon-mobile" style={{ display: 'none' }}>
          <DropdownMenu
            trigger={<ArrowUpDown size={17} />}
            triggerLabel="Sort"
            bareTrigger
            triggerStyle={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', border: '1.5px solid var(--border-subtle)' }}
            items={SORT_OPTIONS.map((o) => ({ key: o.value, label: o.label, onClick: () => setSort(o.value) }))}
          />
        </div>
      </div>

      {/* ── Filter row — desktop: pills + currency, real measured overflow into "More filters". ── */}
      <div className="filter-row-desktop" style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <div ref={containerRef} style={{ display: 'flex', gap: 8, overflow: 'hidden', flexWrap: 'nowrap', flex: 1, minWidth: 0 }}>
          {visibleChips.map((chip) => (
            chip.type === 'currency' ? (
              <select key={chip.key} value={chip.value} onChange={(e) => chip.onChange(e.target.value)} className="fos-input fos-select" style={{ width: 'auto', minWidth: 130, flexShrink: 0, fontSize: '0.78rem' }} aria-label="Filter by currency">
                <option value="">All Currencies</option>
                {chip.options.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <FilterPill key={chip.key} active={chip.active} onClick={chip.onClick}>{chip.label}</FilterPill>
            )
          ))}
        </div>
        {overflowChips.length > 0 && <FilterOverflowMenu chips={overflowChips} />}

        <div aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', top: -9999, left: 0, display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
          {allChips.map((chip, i) => (
            chip.type === 'currency' ? (
              <select key={chip.key} ref={(el) => { measureRefs.current[i] = el }} className="fos-input fos-select" style={{ width: 'auto', minWidth: 130, fontSize: '0.78rem' }} tabIndex={-1}>
                <option>All Currencies</option>
              </select>
            ) : (
              <FilterPill key={chip.key} ref={(el) => { measureRefs.current[i] = el }} active={chip.active} tabIndex={-1}>{chip.label}</FilterPill>
            )
          ))}
          <button ref={moreRef} className="fos-btn" style={{ padding: '6px 14px', fontSize: '0.78rem', borderRadius: 'var(--radius-full)' }} tabIndex={-1}>More filters (9)</button>
        </div>
      </div>

      {/* Mobile (≤768px): pills as one dropdown + currency as a second — same collapsed pattern as Invoices.jsx. */}
      <div className="filter-row-mobile" style={{ display: 'none', gap: 8, marginBottom: 20 }}>
        <select value={filter} onChange={(e) => { setFilter(e.target.value); load(1, { filter: e.target.value }) }} className="fos-input fos-select" style={{ flex: 1, minWidth: 0 }}>
          {FILTER_PILLS.map((pill) => <option key={pill.key} value={pill.key}>{pill.label}</option>)}
        </select>
        {availableCurrencies.length > 0 && (
          <select value={currencyFilter} onChange={(e) => selectCurrencyFilter(e.target.value)} className="fos-input fos-select" style={{ flex: 1, minWidth: 0 }} aria-label="Filter by currency">
            <option value="">All Currencies</option>
            {availableCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* ── Content ── */}
      {loading && clients.length === 0 && !error && <ClientGridSkeleton />}

      {error && clients.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>{error}</FosAlert>
          <br />
          <button className="fos-btn fos-btn-ghost" onClick={() => load(page)}>Retry</button>
        </div>
      )}

      {!loading && !error && clients.length === 0 && (
        <EmptyState search={search} filter={filter} onAddClient={openCreateForm} />
      )}

      {clients.length > 0 && (
        <>
          {error && (
            <FosAlert type="error" style={{ marginBottom: 12 }}>
              {error} <button className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={() => load(page)}>Retry</button>
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

          <div className="pagination-desktop">
            <Pagination page={page} total={total} itemLabel="clients" onPageChange={goToPage} loading={loading} />
          </div>
          <div className="pagination-mobile" style={{ display: 'none' }}>
            <Pagination page={page} total={total} itemLabel="clients" onPageChange={goToPage} loading={loading} compact />
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

      {selectedClientId && (
        <ClientDetailPanel
          clientId={selectedClientId}
          initialAction={selectedInitialAction}
          onClose={() => setSelectedClientId(null)}
          onChanged={() => load(page)}
        />
      )}

      <style>{`
        @media (max-width: 768px) {
          .page-fab { display: flex !important; }
          .filter-row-desktop { display: none !important; }
          .filter-row-mobile { display: flex !important; }
          .sort-select-desktop { display: none !important; }
          .sort-icon-mobile { display: flex !important; }
          .pagination-desktop { display: none !important; }
          .pagination-mobile { display: block !important; }
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
