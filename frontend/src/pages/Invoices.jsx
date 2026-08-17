// src/pages/Invoices.jsx
//
// Invoice list — List/Table restructure pass (real screenshots at
// 375/768/1280/1920 covered in DECISIONS.md's own entry for this pass).
// Rebuilt this pass, on top of everything Steps 5-19 + prior verification
// rounds already established:
//
//   - Pagination: the old tiered "10 -> Show More -> 20 -> server-paged"
//     system is GONE. Every filter/search/sort/currency combination is
//     now a uniform, real server-paginated query — 20 per page (see
//     Pagination.jsx's PAGE_SIZE), real numbered navigation, resetting to
//     page 1 on any filter/search/sort/currency change. See
//     DECISIONS.md for the simplification reasoning.
//   - Header actions (Analytics / Manage Designs / From Preset / New
//     Invoice) moved out of this page's own inline header into AppShell's
//     shared header via usePageHeaderActions — desktop renders them as
//     real buttons next to the bell; mobile folds them into AppShell's
//     3-dot menu (New Invoice stays on the FAB, never duplicated there).
//   - KPI strip (Outstanding/Collected/Overdue) extracted to
//     InvoiceKPIStrip.jsx — it now owns its own period + currency
//     controls, entirely independent of this page's own list filters.
//   - Sort moved onto the search row; the currency LIST filter (a real
//     WHERE-clause filter on invoice.currency, unrelated to the KPI
//     strip's currency selector) joins the status/Overdue pill row, with
//     real measured-width overflow into a "More filters" dropdown
//     (useFilterOverflow.js) rather than a fixed breakpoint guess.
//   - Desktop list is now a real table (InvoiceTable.jsx); mobile keeps
//     the existing card layout (InvoiceCard, below) — unchanged visually
//     from before this pass except for the real currency filter now
//     applying to it too.
//
// Untouched by this pass: the wizard/detail-panel/preset/bulk-delete
// logic itself (still delayed-creation, still panel-vs-wizard-by-status,
// still a client-side loop over the single-delete endpoint) — only the
// list's OWN chrome (header/KPIs/filters/pagination/desktop layout)
// changed. Overdue is still never a stored status value — see
// apps/invoices/models.py's days_overdue docstring; the "Overdue" FILTER
// TOGGLE is still a separate, mutually-exclusive-with-status-pills
// control, unchanged from the 11 August reload-feel fix.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search, X, Plus, FileText, BookmarkPlus, LayoutTemplate, BarChart3, Trash2, ArrowUpDown,
} from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import usePageHeaderActions from '@/hooks/usePageHeaderActions'
import useFilterOverflow from '@/hooks/useFilterOverflow'
import DropdownMenu from '@/components/DropdownMenu'
import FilterPill from '@/components/FilterPill'
import FilterOverflowMenu from '@/components/FilterOverflowMenu'
import FosAlert from '@/components/FosAlert'
import InvoiceDetailPanel from '@/components/InvoiceDetailPanel'
import InvoiceKPIStrip from '@/components/InvoiceKPIStrip'
import InvoiceTable from '@/components/InvoiceTable'
import NewInvoiceWizard from '@/components/NewInvoiceWizard'
import InvoiceStatusBadge from '@/components/InvoiceStatusBadge'
import Pagination, { PAGE_SIZE } from '@/components/Pagination'
import {
  INVOICE_STATUS_META, OVERDUE_BADGE, STATUS_BADGE_STYLE, badgeBaseStyle, formatMoney,
  STATUS_FILTER_OPTIONS, SORT_OPTIONS, daysOverdueLabel,
} from './invoiceHelpers'

// Matches apps/invoices/views.py's invoice_detail DELETE rule exactly
// ("Only draft or created invoices can be deleted") — reused here, not
// re-derived, so this can never silently drift from the real server-side
// rule.
const DELETE_ELIGIBLE_STATUSES = ['draft', 'created']

export default function Invoices() {
  useTitle('LanceraOS | Invoices')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [invoices, setInvoices] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [currencyFilter, setCurrencyFilter] = useState('')
  const [availableCurrencies, setAvailableCurrencies] = useState([])
  const [sort, setSort] = useState('recent')

  const [presets, setPresets] = useState([])

  const [createError, setCreateError] = useState(null)
  const [showPresetPicker, setShowPresetPicker] = useState(false)
  const [presetBusyId, setPresetBusyId] = useState(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)
  const [showNewWizard, setShowNewWizard] = useState(false)
  const [wizardEditId, setWizardEditId] = useState(null)
  const [pendingDetailMessage, setPendingDetailMessage] = useState(null)
  const [pendingDetailTab, setPendingDetailTab] = useState(null)

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)

  const searchTimer = useRef(null)
  const latestRequestId = useRef(0)

  // ── Header actions — registered into AppShell's own header, not
  // rendered inline on this page anymore (item 1/7 of this pass).
  // Memoized: usePageHeaderActions' effect keys off these objects'
  // identity, and AppShell re-renders (its own state update) re-render
  // this whole page too (children aren't memoized) — without useMemo/
  // useCallback here, a fresh JSX/array every render would re-fire the
  // effect every time, which updates AppShell's state again, which
  // re-renders this page again: a real infinite loop, not a hypothetical
  // one. useNavigate()'s return value is itself stable across renders
  // (react-router), so `[navigate, handleNewInvoice]` only actually
  // changes on a real remount. ──
  const handleNewInvoice = useCallback(() => {
    setCreateError(null)
    setShowNewWizard(true)
  }, [])

  const desktopHeaderActions = useMemo(() => (
    <div style={{ display: 'flex', gap: 8 }}>
      <button className="fos-btn fos-btn-ghost" onClick={() => navigate('/invoices/analytics')}>
        <BarChart3 size={15} /> Analytics
      </button>
      <DropdownMenu
        trigger="More" showChevron
        triggerClassName="fos-btn fos-btn-ghost"
        items={[
          { key: 'designs', label: 'Manage Designs', Icon: LayoutTemplate, onClick: () => navigate('/invoices/designs') },
          { key: 'preset', label: 'From Preset', Icon: BookmarkPlus, onClick: () => setShowPresetPicker(true) },
        ]}
      />
      <button className="fos-btn fos-btn-accent" onClick={handleNewInvoice}>
        <Plus size={15} /> New Invoice
      </button>
    </div>
  ), [navigate, handleNewInvoice])

  const mobileHeaderItems = useMemo(() => [
    { key: 'analytics', label: 'Analytics', Icon: BarChart3, onClick: () => navigate('/invoices/analytics') },
    { key: 'designs', label: 'Manage Designs', Icon: LayoutTemplate, onClick: () => navigate('/invoices/designs') },
    { key: 'preset', label: 'From Preset', Icon: BookmarkPlus, onClick: () => setShowPresetPicker(true) },
  ], [navigate])

  usePageHeaderActions({ desktop: desktopHeaderActions, mobileItems: mobileHeaderItems })

  function buildParams(targetPage, overrides = {}) {
    const params = { offset: (targetPage - 1) * PAGE_SIZE, limit: PAGE_SIZE }
    const searchVal = 'search' in overrides ? overrides.search : search
    if (searchVal) params.search = searchVal
    if (sort) params.sort = sort
    const statusVal = 'status' in overrides ? overrides.status : statusFilter
    const overdueVal = 'overdue' in overrides ? overrides.overdue : overdueOnly
    const currencyVal = 'currency' in overrides ? overrides.currency : currencyFilter
    if (statusVal) params.status = statusVal
    if (overdueVal) params.overdue = 'true'
    if (currencyVal) params.currency = currencyVal
    return params
  }

  async function load(targetPage, overrides = {}) {
    const requestId = ++latestRequestId.current
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/invoices/', { params: buildParams(targetPage, overrides) })
      if (requestId !== latestRequestId.current) return
      const results = data.results || []
      const totalCount = data.total ?? 0
      // The page a mutation (e.g. bulk delete) just emptied out — step
      // back one page and re-fetch, rather than showing a blank page
      // with real invoices still on the page before it.
      if (results.length === 0 && targetPage > 1 && totalCount > 0) {
        return load(targetPage - 1, overrides)
      }
      setPage(targetPage)
      setInvoices(results)
      setTotal(totalCount)
      setSelectedIds(new Set())
    } catch {
      if (requestId !== latestRequestId.current) return
      setError('Failed to load invoices. Please try again.')
    } finally {
      if (requestId === latestRequestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort])

  useEffect(() => {
    api.get('/invoices/presets/').then(({ data }) => setPresets(data)).catch(() => setPresets([]))
    api.get('/invoices/currencies/').then(({ data }) => setAvailableCurrencies(data.currencies || [])).catch(() => setAvailableCurrencies([]))
  }, [])

  // Notification click-through — unchanged from the prior round.
  useEffect(() => {
    const invoiceParam = searchParams.get('invoice')
    if (!invoiceParam) return
    setSelectedInvoiceId(invoiceParam)
    setPendingDetailTab(searchParams.get('tab'))
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function selectStatusFilter(key) {
    setStatusFilter(key)
    setOverdueOnly(false)
    load(1, { status: key, overdue: false })
  }

  function toggleOverdueFilter(forceOn) {
    const next = forceOn !== undefined ? forceOn : !overdueOnly
    setOverdueOnly(next)
    setStatusFilter('')
    load(1, { status: '', overdue: next })
  }

  function selectCurrencyFilter(value) {
    setCurrencyFilter(value)
    load(1, { currency: value })
  }

  function handleSearchChange(value) {
    setSearch(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(1, { search: value }), 300)
  }

  function goToPage(n) {
    load(n)
  }

  function refreshAfterChange() {
    load(page)
  }

  function toggleSelectForDelete(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllEligible() {
    setSelectedIds(new Set(invoices.filter((inv) => DELETE_ELIGIBLE_STATUSES.includes(inv.status)).map((inv) => inv.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    const ids = Array.from(selectedIds)
    let failures = 0
    for (const id of ids) {
      try {
        await api.delete(`/invoices/${id}/`)
      } catch {
        failures += 1
      }
    }
    setShowBulkDeleteConfirm(false)
    setBulkDeleting(false)
    setSelectedIds(new Set())
    if (failures > 0) {
      setCreateError(`${failures} of ${ids.length} selected invoice${ids.length !== 1 ? 's' : ''} could not be deleted.`)
    }
    refreshAfterChange()
  }

  function openDetail(invoice) {
    if (invoice.status === 'draft') setWizardEditId(invoice.id)
    else setSelectedInvoiceId(invoice.id)
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

  function handleWizardClosed(createdId) {
    setShowNewWizard(false)
    setWizardEditId(null)
    if (createdId) refreshAfterChange()
  }

  function handleWizardFinalised(id, message) {
    setShowNewWizard(false)
    setWizardEditId(null)
    setSelectedInvoiceId(id)
    setPendingDetailMessage(message || null)
    refreshAfterChange()
  }

  async function handlePickPreset(preset) {
    setPresetBusyId(preset.id)
    setCreateError(null)
    try {
      const { data } = await api.post(`/invoices/presets/${preset.id}/create-invoice/`)
      setShowPresetPicker(false)
      setWizardEditId(data.id)
      refreshAfterChange()
    } catch {
      setCreateError('Failed to create an invoice from this preset. Please try again.')
    } finally {
      setPresetBusyId(null)
    }
  }

  // ── Filter row chips + real measured-width overflow ──
  const statusChips = STATUS_FILTER_OPTIONS.map((opt) => ({
    type: 'pill', key: opt.key || 'all', label: opt.label,
    active: statusFilter === opt.key && !overdueOnly,
    onClick: () => selectStatusFilter(opt.key),
  }))
  const overdueChip = { type: 'pill', key: 'overdue', label: 'Overdue', active: overdueOnly, onClick: () => toggleOverdueFilter() }
  const currencyChip = { type: 'currency', key: 'currency', value: currencyFilter, options: availableCurrencies, onChange: selectCurrencyFilter }
  const allChips = [...statusChips, overdueChip, currencyChip]
  const { containerRef, measureRefs, moreRef, visibleCount } = useFilterOverflow(allChips.length)
  const visibleChips = allChips.slice(0, visibleCount)
  const overflowChips = allChips.slice(visibleCount)

  return (
    <>
      {/* Page title + invoice-count line removed (bug-fix round) — redundant
          with AppShell's own header title, which already shows "Invoices". */}
      {createError && (
        <FosAlert type="error" onDismiss={() => setCreateError(null)} style={{ marginBottom: 16 }}>{createError}</FosAlert>
      )}

      {/* ── KPI strip — Outstanding / Collected / Overdue, own period + currency controls ── */}
      <InvoiceKPIStrip />

      {/* ── Search + Sort row ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: 1 }}>
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
        {/* Desktop: full sort dropdown. Mobile: a compact icon opening the same real options. */}
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="fos-input fos-select sort-select-desktop" style={{ width: 'auto', minWidth: 170, flexShrink: 0 }}>
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
              <FilterPill key={chip.key} active={chip.active} danger={chip.key === 'overdue'} onClick={chip.onClick}>{chip.label}</FilterPill>
            )
          ))}
        </div>
        {overflowChips.length > 0 && <FilterOverflowMenu chips={overflowChips} />}

        {/* Hidden measurement row — every chip's true intrinsic width,
            independent of the visible container's current width. See
            useFilterOverflow.js. */}
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

      {/* Mobile (≤768px): status/Overdue as one dropdown, currency as a second — folded into the existing mobile filter-dropdown pattern. */}
      <div className="filter-row-mobile" style={{ display: 'none', gap: 8, marginBottom: 20 }}>
        <select
          value={overdueOnly ? '__overdue__' : statusFilter}
          onChange={(e) => (e.target.value === '__overdue__' ? toggleOverdueFilter(true) : selectStatusFilter(e.target.value))}
          className="fos-input fos-select" style={{ flex: 1, minWidth: 0 }}
        >
          {STATUS_FILTER_OPTIONS.map((opt) => <option key={opt.key || 'all'} value={opt.key}>{opt.label}</option>)}
          <option value="__overdue__">Overdue</option>
        </select>
        {availableCurrencies.length > 0 && (
          <select value={currencyFilter} onChange={(e) => selectCurrencyFilter(e.target.value)} className="fos-input fos-select" style={{ flex: 1, minWidth: 0 }} aria-label="Filter by currency">
            <option value="">All Currencies</option>
            {availableCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* ── Content ── */}
      {loading && invoices.length === 0 && !error && <InvoiceGridSkeleton />}

      {error && invoices.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>{error}</FosAlert>
          <br />
          <button className="fos-btn fos-btn-ghost" onClick={() => load(page)}>Retry</button>
        </div>
      )}

      {invoices.length > 0 && (
        <>
          {error && (
            <FosAlert type="error" style={{ marginBottom: 12 }}>
              {error} <button className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={() => load(page)}>Retry</button>
            </FosAlert>
          )}

          {/* Desktop: real table. Mobile: card list (unchanged pattern). */}
          <div className="list-desktop" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
            <InvoiceTable
              invoices={invoices}
              deleteEligibleStatuses={DELETE_ELIGIBLE_STATUSES}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelectForDelete}
              onSelectAllEligible={selectAllEligible}
              onClearSelection={clearSelection}
              onOpen={openDetail}
            />
          </div>
          <div
            className="list-mobile"
            style={{
              display: 'none', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12,
              opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease',
            }}
          >
            {invoices.map((inv) => (
              <InvoiceCard
                key={inv.id} invoice={inv} onOpen={() => openDetail(inv)}
                selectable={DELETE_ELIGIBLE_STATUSES.includes(inv.status)}
                selected={selectedIds.has(inv.id)}
                onToggleSelect={() => toggleSelectForDelete(inv.id)}
              />
            ))}
          </div>

          <div className="pagination-desktop">
            <Pagination page={page} total={total} itemLabel="invoices" onPageChange={goToPage} loading={loading} />
          </div>
          <div className="pagination-mobile" style={{ display: 'none' }}>
            <Pagination page={page} total={total} itemLabel="invoices" onPageChange={goToPage} loading={loading} compact />
          </div>
        </>
      )}

      {!loading && !error && invoices.length === 0 && (
        <EmptyState search={search} statusFilter={statusFilter} overdueOnly={overdueOnly} onCreate={handleNewInvoice} />
      )}

      {/* ── Bulk-select floating action bar — unified across desktop and
          mobile this round (InvoiceDetailPanel redesign, item 6): the
          desktop table lost its own header-cell bulk-delete control when
          its Action column (the control's home since the previous
          bug-hardening pass) was removed entirely in favor of whole-row
          click-to-open. Rather than inventing a second, desktop-only
          bulk-action home, this reuses the exact bar already built for
          mobile cards' own selection affordance — it now renders at
          every width instead of being CSS-gated to ≤768px. ── */}
      {selectedIds.size > 0 && (
        <div className="bulk-bar-mobile" style={{
          display: 'flex', position: 'fixed', bottom: 24, right: 24, zIndex: 95,
          background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)', padding: '10px 14px', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
            {selectedIds.size} selected
          </span>
          <button className="fos-btn fos-btn-ghost" style={{ fontSize: '0.76rem' }} onClick={selectAllEligible}>Select all</button>
          <button className="fos-btn fos-btn-ghost" style={{ fontSize: '0.76rem' }} onClick={clearSelection}>Clear</button>
          <button className="fos-btn fos-btn-danger" style={{ fontSize: '0.76rem' }} onClick={() => setShowBulkDeleteConfirm(true)}>
            <Trash2 size={13} /> Delete selected
          </button>
        </div>
      )}

      {showBulkDeleteConfirm && (
        <BulkDeleteConfirmModal
          count={selectedIds.size} busy={bulkDeleting}
          onConfirm={handleBulkDelete} onClose={() => setShowBulkDeleteConfirm(false)}
        />
      )}

      {/* ── Mobile FAB — the real "New Invoice" entry point at phone width, never duplicated in the header's 3-dot menu. ── */}
      <button className="page-fab" onClick={handleNewInvoice} aria-label="New invoice" style={{
        display: 'none', position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
        borderRadius: '50%', background: 'var(--accent)', color: '#000', border: 'none',
        boxShadow: '0 4px 20px var(--accent-glow-lg)', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: 90,
      }}>
        <Plus size={24} />
      </button>

      {showPresetPicker && (
        <PresetPickerModal
          presets={presets}
          busyId={presetBusyId}
          onPick={handlePickPreset}
          onClose={() => setShowPresetPicker(false)}
        />
      )}

      {selectedInvoiceId && (
        <InvoiceDetailPanel
          invoiceId={selectedInvoiceId}
          onClose={() => { setSelectedInvoiceId(null); setPendingDetailTab(null) }}
          onChanged={handleInvoiceChanged}
          onPresetSaved={(preset) => setPresets((prev) => [...prev, preset])}
          initialMessage={pendingDetailMessage}
          onInitialMessageShown={() => setPendingDetailMessage(null)}
          initialTab={pendingDetailTab}
        />
      )}

      {(showNewWizard || wizardEditId) && (
        <NewInvoiceWizard
          editInvoiceId={wizardEditId}
          onClose={handleWizardClosed}
          onFinalised={handleWizardFinalised}
        />
      )}

      <style>{`
        @media (max-width: 768px) {
          .page-fab { display: flex !important; }
          .filter-row-desktop { display: none !important; }
          .filter-row-mobile { display: flex !important; }
          .sort-select-desktop { display: none !important; }
          .sort-icon-mobile { display: flex !important; }
          .list-desktop { display: none !important; }
          .list-mobile { display: grid !important; }
          .pagination-desktop { display: none !important; }
          .pagination-mobile { display: block !important; }
        }
      `}</style>
    </>
  )
}

// ── InvoiceCard — mobile-only list item (unchanged visually from before this pass) ──
function InvoiceCard({ invoice, onOpen, selectable = false, selected = false, onToggleSelect }) {
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
        border: `1px solid ${selected ? 'var(--accent)' : isOverdue ? 'var(--status-red)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-lg)', padding: '16px 18px',
        transition: 'background var(--transition-fast)', display: 'flex', flexDirection: 'column', gap: 8,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {selectable && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect() }}
              aria-label={selected ? 'Deselect invoice' : 'Select invoice'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 1, flexShrink: 0, display: 'flex' }}
            >
              <input type="checkbox" readOnly checked={selected} style={{ accentColor: 'var(--accent)', width: 16, height: 16, pointerEvents: 'none' }} />
            </button>
          )}
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {invoice.invoice_number || '(unnumbered draft)'}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {invoice.client_name || 'No client yet'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
          {isOverdue && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[OVERDUE_BADGE.statusKey] }}>{OVERDUE_BADGE.label}</span>}
          <InvoiceStatusBadge meta={meta} />
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

// ── BulkDeleteConfirmModal ───────────────────────────────────────────
function BulkDeleteConfirmModal({ count, busy, onConfirm, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '24px 28px', width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Delete {count} invoice{count !== 1 ? 's' : ''}?
          </h3>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          This permanently removes the selected invoice{count !== 1 ? 's' : ''}. This cannot be undone.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fos-btn fos-btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? <span className="fos-spinner" /> : <Trash2 size={14} />} Delete
          </button>
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

// ── PresetPickerModal ─────────────────────────────────────────────
function PresetPickerModal({ presets, busyId, onPick, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '24px 28px', width: '100%', maxWidth: 440, maxHeight: '80vh', overflowY: 'auto', animation: 'modal-in 0.2s cubic-bezier(0.22,1,0.36,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>Start from Preset</h3>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <PresetPicker presets={presets} busyId={busyId} onPick={onPick} />
      </div>
    </div>
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
