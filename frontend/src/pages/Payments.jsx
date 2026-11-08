// src/pages/Payments.jsx
//
// The Payments page (/payments): the person's income ledger. Top to bottom — a flash message, the three headline numbers
// (This month / This year / All time, in PaymentsKpiStrip), a row with the 12-month income chart (2/3) and the "where
// this year's income came from" card (1/3), the "excluded / estimated" notes, search + sort, the filters, the list
// (a table on desktop, cards at <= 768px) and the pagination. The KPI strip, chart and by-source card cover ALL payments
// and never change with the list filters.
//
// Requests, each with its own request-id guard (a late response never overwrites a newer one, and a loading flag is
// cleared only by the latest request): the list (GET /payments/), the summary (GET /payments/summary/, with `currency`
// only once the person has picked one) and the currencies filter list (GET /payments/currencies/). After any write —
// create, edit, delete, link, unlink — all three are reloaded; a page that comes back empty falls back one page, exactly
// as Clients.jsx does. Filters are page state, not URL state.
//
// Dialogs and the side panel are feature-local components (PaymentFormModal, PaymentDetailPanel, PaymentLinkModal): this
// page only decides which one is open.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Info, Plus, Search, Upload, Wallet, X } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import useTimedMessage from '@/hooks/useTimedMessage'
import usePageHeaderActions from '@/hooks/usePageHeaderActions'
import usePaymentCurrencies from '@/hooks/usePaymentCurrencies'
import DropdownMenu from '@/components/DropdownMenu'
import FilterPill from '@/components/FilterPill'
import FosAlert from '@/components/FosAlert'
import Pagination from '@/components/Pagination'
import PaymentDetailPanel from '@/components/PaymentDetailPanel'
import PaymentFormModal from '@/components/PaymentFormModal'
import PaymentImportDialog from '@/components/PaymentImportDialog'
import PaymentTable, { PaymentCard } from '@/components/PaymentTable'
import PaymentsIncomeChart from '@/components/PaymentsIncomeChart'
import PaymentsKpiStrip from '@/components/PaymentsKpiStrip'
import PaymentsSourceCard from '@/components/PaymentsSourceCard'
import { PAYMENT_SOURCE_OPTIONS } from './invoiceHelpers'
import {
  LINK_FILTERS, PAYMENT_SORT_OPTIONS, buildListParams, dateRangeProblem, errorMessage, estimatedNote, hasActiveFilters, paymentNote,
} from './paymentsHelpers'

const INITIAL_FILTERS = { search: '', link: 'all', source: '', currency: '', start: '', end: '', sort: 'recent' }

export default function Payments() {
  useTitle('LanceraOS | Payments')

  const [payments, setPayments] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [availableCurrencies, setAvailableCurrencies] = useState([])

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(false)
  const [summaryCurrency, setSummaryCurrency] = useState('')
  const [profileCurrency, setProfileCurrency] = useState('')

  const [formState, setFormState] = useState(null) // null | { mode: 'create' }
  const [importOpen, setImportOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const flash = useTimedMessage()
  const currencies = usePaymentCurrencies()

  // The latest values, readable from callbacks that outlive a render.
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const pageRef = useRef(page)
  pageRef.current = page
  const summaryCurrencyRef = useRef(summaryCurrency)
  summaryCurrencyRef.current = summaryCurrency
  const listRequest = useRef(0)
  const summaryRequest = useRef(0)
  const currenciesRequest = useRef(0)
  const searchTimer = useRef(null)

  const rangeProblem = dateRangeProblem(filters.start, filters.end)

  const openCreate = useCallback(() => setFormState({ mode: 'create' }), [])
  const openImport = useCallback(() => setImportOpen(true), [])
  // Memoised: AppShell re-renders on every header-action change, and a fresh JSX node each render would re-fire the
  // registration effect forever (the same trap Clients.jsx documents).
  const desktopHeaderActions = useMemo(() => (
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" className="fos-btn fos-btn-ghost" onClick={openImport}><Upload size={15} aria-hidden="true" /> Import</button>
      <button type="button" className="fos-btn fos-btn-accent" onClick={openCreate}><Plus size={15} aria-hidden="true" /> Add payment</button>
    </div>
  ), [openCreate, openImport])
  const mobileHeaderItems = useMemo(() => [{ key: 'import', label: 'Import payments', Icon: Upload, onClick: openImport }], [openImport])
  usePageHeaderActions({ desktop: desktopHeaderActions, mobileItems: mobileHeaderItems })

  const loadList = useCallback(async (targetPage) => {
    const requestId = ++listRequest.current
    if (dateRangeProblem(filtersRef.current.start, filtersRef.current.end)) {
      setLoading(false) // an inverted range sends nothing; the message beside the dates says why
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/payments/', { params: buildListParams({ ...filtersRef.current, page: targetPage }) })
      if (requestId !== listRequest.current) return
      const results = data.results || []
      const count = data.total ?? results.length
      if (results.length === 0 && targetPage > 1 && count > 0) return loadList(targetPage - 1)
      setPage(targetPage)
      setPayments(results)
      setTotal(count)
    } catch (e) {
      if (requestId !== listRequest.current) return
      setError(errorMessage(e, 'Failed to load your payments. Please try again.'))
    } finally {
      if (requestId === listRequest.current) setLoading(false)
    }
  }, [])

  const loadSummary = useCallback(async (currency) => {
    const requestId = ++summaryRequest.current
    setSummaryLoading(true)
    setSummaryError(false)
    try {
      const { data } = await api.get('/payments/summary/', { params: currency ? { currency } : {} })
      if (requestId !== summaryRequest.current) return
      setSummary(data)
      if (!currency) setProfileCurrency((current) => current || data.currency)
    } catch {
      if (requestId !== summaryRequest.current) return
      setSummaryError(true)
    } finally {
      if (requestId === summaryRequest.current) setSummaryLoading(false)
    }
  }, [])

  const loadCurrencies = useCallback(async () => {
    const requestId = ++currenciesRequest.current
    try {
      const { data } = await api.get('/payments/currencies/')
      if (requestId === currenciesRequest.current) setAvailableCurrencies(data.currencies || [])
    } catch {
      if (requestId === currenciesRequest.current) setAvailableCurrencies([])
    }
  }, [])

  // First load, and every change to a filter, the search or the sort goes back to page 1.
  useEffect(() => { loadList(1) }, [filters, loadList])
  useEffect(() => { loadSummary(''); loadCurrencies() }, [loadSummary, loadCurrencies])
  useEffect(() => () => clearTimeout(searchTimer.current), [])

  const refresh = useCallback(({ firstPage = false } = {}) => {
    loadList(firstPage ? 1 : pageRef.current)
    loadSummary(summaryCurrencyRef.current)
    loadCurrencies()
  }, [loadList, loadSummary, loadCurrencies])

  function changeFilter(patch) {
    setFilters((f) => ({ ...f, ...patch }))
  }

  function handleSearchChange(value, immediate = false) {
    setSearchInput(value)
    clearTimeout(searchTimer.current)
    if (immediate) { changeFilter({ search: value }); return }
    searchTimer.current = setTimeout(() => changeFilter({ search: value }), 300)
  }

  function clearFilters() {
    clearTimeout(searchTimer.current)
    setSearchInput('')
    setFilters((f) => ({ ...INITIAL_FILTERS, sort: f.sort }))
  }

  function changeSummaryCurrency(code) {
    setSummaryCurrency(code)
    loadSummary(code)
  }

  const filtersActive = hasActiveFilters({ ...filters, search: searchInput || filters.search })
  const nothingYet = !loading && !error && payments.length === 0 && !filtersActive
  const noMatches = !loading && !error && payments.length === 0 && filtersActive

  return (
    <>
      {flash.message && <FosAlert type={flash.message.type} onDismiss={flash.clear} style={{ marginBottom: 14 }}>{flash.message.text}</FosAlert>}

      <PaymentsKpiStrip
        summary={summary} loading={summaryLoading} error={summaryError}
        currency={summaryCurrency || summary?.currency || ''} onCurrencyChange={changeSummaryCurrency}
        onReload={() => loadSummary(summaryCurrency)}
      />

      <div className="pay-top-grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 12, alignItems: 'start' }}>
        <PaymentsIncomeChart summary={summary} error={summaryError} onReload={() => loadSummary(summaryCurrency)} />
        <PaymentsSourceCard summary={summary} />
      </div>

      {summary && (summary.unconverted_count > 0 || summary.estimated_count > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          {summary.unconverted_count > 0 && <Note>{paymentNote(summary.unconverted_count)}</Note>}
          {summary.estimated_count > 0 && <Note>{estimatedNote(summary.estimated_count)}</Note>}
        </div>
      )}

      {/* ── Search + sort ── */}
      <div style={{ display: 'flex', gap: 8, margin: '20px 0 14px' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <input
            type="text" className="fos-input" style={{ paddingLeft: 36, paddingRight: searchInput ? 36 : 14 }}
            placeholder="Search by who paid, notes, invoice or client…" aria-label="Search payments"
            value={searchInput} onChange={(e) => handleSearchChange(e.target.value)}
          />
          {searchInput && (
            <button type="button" onClick={() => handleSearchChange('', true)} aria-label="Clear search" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 0 }}>
              <X size={15} />
            </button>
          )}
        </div>
        <select value={filters.sort} onChange={(e) => changeFilter({ sort: e.target.value })} aria-label="Sort payments" className="fos-input fos-select pay-sort-desktop" style={{ width: 'auto', minWidth: 210, flexShrink: 0 }}>
          {PAYMENT_SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="pay-sort-mobile" style={{ display: 'none' }}>
          <DropdownMenu
            trigger={<ArrowUpDown size={17} />} triggerLabel="Sort" bareTrigger
            triggerStyle={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', border: '1.5px solid var(--border-subtle)' }}
            items={PAYMENT_SORT_OPTIONS.map((o) => ({ key: o.value, label: o.label, onClick: () => changeFilter({ sort: o.value }) }))}
          />
        </div>
      </div>

      {/* ── Filters — desktop: one wrapping row ── */}
      <div className="pay-filter-desktop" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        {LINK_FILTERS.map((pill) => (
          <FilterPill key={pill.key} active={filters.link === pill.key} onClick={() => changeFilter({ link: pill.key })}>{pill.label}</FilterPill>
        ))}
        <SourceSelect value={filters.source} onChange={(v) => changeFilter({ source: v })} />
        <CurrencySelect value={filters.currency} options={availableCurrencies} onChange={(v) => changeFilter({ currency: v })} />
        <DateRange filters={filters} onChange={changeFilter} problem={rangeProblem} />
        {filtersActive && <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '6px 12px' }} onClick={clearFilters}>Clear filters</button>}
      </div>

      {/* ── Filters — mobile (<= 768px): the same controls as selects/inputs ── */}
      <div className="pay-filter-mobile" style={{ display: 'none', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        <select value={filters.link} onChange={(e) => changeFilter({ link: e.target.value })} aria-label="Filter by link state" className="fos-input fos-select" style={{ flex: '1 1 140px', minWidth: 0 }}>
          {LINK_FILTERS.map((pill) => <option key={pill.key} value={pill.key}>{pill.label}</option>)}
        </select>
        <SourceSelect value={filters.source} onChange={(v) => changeFilter({ source: v })} grow />
        <CurrencySelect value={filters.currency} options={availableCurrencies} onChange={(v) => changeFilter({ currency: v })} grow />
        <DateRange filters={filters} onChange={changeFilter} problem={rangeProblem} grow />
        {filtersActive && <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '6px 12px' }} onClick={clearFilters}>Clear filters</button>}
      </div>

      {/* ── List ── */}
      {loading && payments.length === 0 && !error && <ListSkeleton />}

      {error && payments.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>{error}</FosAlert>
          <br />
          <button type="button" className="fos-btn fos-btn-ghost" onClick={() => loadList(page)}>Retry</button>
        </div>
      )}

      {nothingYet && <EmptyState onAdd={openCreate} onImport={openImport} />}
      {noMatches && <NoMatches onClear={clearFilters} />}

      {payments.length > 0 && (
        <>
          {error && (
            <FosAlert type="error" style={{ marginBottom: 12 }}>
              {error} <button type="button" className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={() => loadList(page)}>Retry</button>
            </FosAlert>
          )}
          <div className="list-desktop" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
            <PaymentTable payments={payments} onOpen={(p) => setSelectedId(p.id)} />
          </div>
          <div className="list-mobile" style={{ display: 'none', flexDirection: 'column', gap: 10, opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
            {payments.map((p) => <PaymentCard key={p.id} payment={p} onOpen={() => setSelectedId(p.id)} />)}
          </div>
          <div className="pay-pagination-desktop">
            <Pagination page={page} total={total} itemLabel="payments" onPageChange={(n) => loadList(n)} loading={loading} />
          </div>
          <div className="pay-pagination-mobile" style={{ display: 'none' }}>
            <Pagination page={page} total={total} itemLabel="payments" onPageChange={(n) => loadList(n)} loading={loading} compact />
          </div>
        </>
      )}

      {/* ── Mobile FAB ── */}
      <button type="button" className="page-fab" onClick={openCreate} aria-label="Add payment" style={{
        display: 'none', position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
        borderRadius: '50%', background: 'var(--accent)', color: '#000', border: 'none',
        boxShadow: '0 4px 20px var(--accent-glow-lg)', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: 90,
      }}>
        <Plus size={24} />
      </button>

      {formState && (
        <PaymentFormModal
          profileCurrency={profileCurrency} currencies={currencies}
          onCreated={() => refresh({ firstPage: true })}
          onChanged={() => refresh()}
          onFinish={(text) => { setFormState(null); flash.show('success', text) }}
          onViewPayment={(id) => { setFormState(null); setSelectedId(id) }}
          onClose={() => setFormState(null)}
        />
      )}

      {importOpen && (
        <PaymentImportDialog
          currencies={currencies}
          onImported={() => refresh({ firstPage: true })}
          onUndone={() => refresh()}
          onClose={(text) => { setImportOpen(false); if (text) flash.show('success', text) }}
        />
      )}

      {selectedId && (
        <PaymentDetailPanel
          paymentId={selectedId} currencies={currencies}
          onClose={() => setSelectedId(null)}
          onChanged={(text) => { refresh(); if (text) flash.show('success', text) }}
        />
      )}

      <style>{`
        @media (max-width: 768px) {
          .page-fab { display: flex !important; }
          .pay-top-grid { grid-template-columns: 1fr !important; }
          .pay-filter-desktop { display: none !important; }
          .pay-filter-mobile { display: flex !important; }
          .pay-sort-desktop { display: none !important; }
          .pay-sort-mobile { display: flex !important; }
          .list-desktop { display: none !important; }
          .list-mobile { display: flex !important; }
          .pay-pagination-desktop { display: none !important; }
          .pay-pagination-mobile { display: block !important; }
        }
      `}</style>
    </>
  )
}

function Note({ children }) {
  return (
    <p style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
      <Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </p>
  )
}

function SourceSelect({ value, onChange, grow = false }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter by source" className="fos-input fos-select" style={grow ? { flex: '1 1 140px', minWidth: 0 } : { width: 'auto', minWidth: 130, fontSize: '0.78rem' }}>
      <option value="">All sources</option>
      {PAYMENT_SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function CurrencySelect({ value, options, onChange, grow = false }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter by currency" className="fos-input fos-select" style={grow ? { flex: '1 1 140px', minWidth: 0 } : { width: 'auto', minWidth: 130, fontSize: '0.78rem' }}>
      <option value="">All currencies</option>
      {options.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}

function DateRange({ filters, onChange, problem, grow = false }) {
  const inputStyle = grow ? { flex: '1 1 140px', minWidth: 0 } : { width: 'auto', fontSize: '0.78rem' }
  return (
    <>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: 'var(--text-tertiary)', ...(grow ? { flex: '1 1 140px' } : {}) }}>
        From
        <input type="date" className="fos-input" value={filters.start} max={filters.end || undefined} onChange={(e) => onChange({ start: e.target.value })} style={inputStyle} />
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: 'var(--text-tertiary)', ...(grow ? { flex: '1 1 140px' } : {}) }}>
        To
        <input type="date" className="fos-input" value={filters.end} min={filters.start || undefined} onChange={(e) => onChange({ end: e.target.value })} style={inputStyle} />
      </label>
      {problem && <span role="alert" style={{ fontSize: '0.76rem', color: 'var(--status-red-text)', flexBasis: grow ? '100%' : 'auto' }}>{problem}</span>}
    </>
  )
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading payments" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} style={{ height: 52, background: 'var(--bg-surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  )
}

function EmptyState({ onAdd, onImport }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <Wallet size={28} aria-hidden="true" style={{ color: 'var(--text-tertiary)', marginBottom: 10 }} />
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>No payments recorded yet</p>
      <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
        Add money you have received here. A payment you mark as paid on an invoice also appears in this list.
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
        <button type="button" className="fos-btn fos-btn-accent" onClick={onAdd}><Plus size={15} aria-hidden="true" /> Add payment</button>
        <button type="button" className="fos-btn fos-btn-ghost" onClick={onImport}><Upload size={15} aria-hidden="true" /> Import from a file</button>
      </div>
    </div>
  )
}

function NoMatches({ onClear }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>No payments match these filters.</p>
      <button type="button" className="fos-btn fos-btn-ghost" style={{ marginTop: 14 }} onClick={onClear}>Clear filters</button>
    </div>
  )
}
