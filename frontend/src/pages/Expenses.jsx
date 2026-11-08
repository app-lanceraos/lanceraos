// src/pages/Expenses.jsx
//
// The Expenses page (/expenses): the person's money-out list (Prompt 15). A deliberate mirror of Payments.jsx. Top to
// bottom — a flash message, the three headline numbers (This month / This year / All time, in ExpensesKpiStrip), a row
// with the 12-month spending chart (2/3) and the "where this year's spending went" card (1/3), the "excluded / estimated"
// notes, search + sort, the filters, the list (a table on desktop, cards at <= 768px) and the pagination. The KPI strip,
// chart and category card cover ALL expenses and never change with the list filters.
//
// Requests, each with its own request-id guard (a late response never overwrites a newer one, and a loading flag is cleared
// only by the latest request): the list (GET /expenses/), the summary (GET /expenses/summary/, with `currency` only once
// the person has picked one) and the currencies filter list (GET /expenses/currencies/). After any write — create, edit,
// delete — all three are reloaded; a page that comes back empty falls back one page, exactly as Payments does. Filters are
// page state, not URL state.
//
// There is no side panel (decision X2): a row opens the edit dialog, and each row has an Edit / Duplicate / Delete menu.
// Dialogs are feature-local components (ExpenseFormModal, ExpenseDeleteDialog): this page only decides which one is open.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Info, Plus, Receipt, Search, X } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import useTimedMessage from '@/hooks/useTimedMessage'
import usePageHeaderActions from '@/hooks/usePageHeaderActions'
import usePaymentCurrencies from '@/hooks/usePaymentCurrencies'
import DropdownMenu from '@/components/DropdownMenu'
import ExpenseDeleteDialog from '@/components/ExpenseDeleteDialog'
import ExpenseFormModal from '@/components/ExpenseFormModal'
import ExpenseTable, { ExpenseCard } from '@/components/ExpenseTable'
import ExpensesCategoryCard from '@/components/ExpensesCategoryCard'
import ExpensesKpiStrip from '@/components/ExpensesKpiStrip'
import ExpensesSpendingChart from '@/components/ExpensesSpendingChart'
import FosAlert from '@/components/FosAlert'
import Pagination from '@/components/Pagination'
import {
  CATEGORY_FILTER_OPTIONS, DEDUCTIBLE_FILTERS, EXPENSE_SORT_OPTIONS, FLASH, buildListParams, dateRangeProblem, errorMessage,
  expenseEstimatedNote, expenseUnconvertedNote, hasActiveFilters,
} from './expensesHelpers'

const INITIAL_FILTERS = { search: '', category: '', deductible: '', currency: '', start: '', end: '', sort: 'recent' }
// A stable reference: a fresh [] each render would re-register the header actions forever.
const NO_MOBILE_ITEMS = []

export default function Expenses() {
  useTitle('LanceraOS | Expenses')

  const [expenses, setExpenses] = useState([])
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

  const [formState, setFormState] = useState(null) // null | { mode: 'create' } | { mode: 'edit', expense } | { mode: 'copy', expense }
  const [deleting, setDeleting] = useState(null) // null | expense
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
  // Memoised: AppShell re-renders on every header-action change, and a fresh JSX node each render would re-fire the
  // registration effect forever (the same trap Clients.jsx and Payments.jsx document).
  const desktopHeaderActions = useMemo(() => (
    <button type="button" className="fos-btn fos-btn-accent" onClick={openCreate}><Plus size={15} aria-hidden="true" /> Add expense</button>
  ), [openCreate])
  usePageHeaderActions({ desktop: desktopHeaderActions, mobileItems: NO_MOBILE_ITEMS })

  const loadList = useCallback(async (targetPage) => {
    const requestId = ++listRequest.current
    if (dateRangeProblem(filtersRef.current.start, filtersRef.current.end)) {
      setLoading(false) // an inverted range sends nothing; the message beside the dates says why
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/expenses/', { params: buildListParams({ ...filtersRef.current, page: targetPage }) })
      if (requestId !== listRequest.current) return
      const results = data.results || []
      const count = data.total ?? results.length
      if (results.length === 0 && targetPage > 1 && count > 0) return loadList(targetPage - 1)
      setPage(targetPage)
      setExpenses(results)
      setTotal(count)
    } catch (e) {
      if (requestId !== listRequest.current) return
      setError(errorMessage(e, 'Failed to load your expenses. Please try again.'))
    } finally {
      if (requestId === listRequest.current) setLoading(false)
    }
  }, [])

  const loadSummary = useCallback(async (currency) => {
    const requestId = ++summaryRequest.current
    setSummaryLoading(true)
    setSummaryError(false)
    try {
      const { data } = await api.get('/expenses/summary/', { params: currency ? { currency } : {} })
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
      const { data } = await api.get('/expenses/currencies/')
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

  function showFlash(text) {
    flash.show(text === FLASH.alreadyRemoved ? 'info' : 'success', text)
  }

  const openEdit = useCallback((expense) => setFormState({ mode: 'edit', expense }), [])
  const openCopy = useCallback((expense) => setFormState({ mode: 'copy', expense }), [])
  const openDelete = useCallback((expense) => setDeleting(expense), [])

  const filtersActive = hasActiveFilters({ ...filters, search: searchInput || filters.search })
  const nothingYet = !loading && !error && expenses.length === 0 && !filtersActive
  const noMatches = !loading && !error && expenses.length === 0 && filtersActive

  return (
    <>
      {flash.message && <FosAlert type={flash.message.type} onDismiss={flash.clear} style={{ marginBottom: 14 }}>{flash.message.text}</FosAlert>}

      <ExpensesKpiStrip
        summary={summary} loading={summaryLoading} error={summaryError}
        currency={summaryCurrency || summary?.currency || ''} onCurrencyChange={changeSummaryCurrency}
        onReload={() => loadSummary(summaryCurrency)}
      />

      <div className="exp-top-grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 12, alignItems: 'start' }}>
        <ExpensesSpendingChart summary={summary} error={summaryError} onReload={() => loadSummary(summaryCurrency)} />
        <ExpensesCategoryCard summary={summary} />
      </div>

      {summary && (summary.unconverted_count > 0 || summary.estimated_count > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          {summary.unconverted_count > 0 && <Note>{expenseUnconvertedNote(summary.unconverted_count)}</Note>}
          {summary.estimated_count > 0 && <Note>{expenseEstimatedNote(summary.estimated_count)}</Note>}
        </div>
      )}

      {/* ── Search + sort ── */}
      <div style={{ display: 'flex', gap: 8, margin: '20px 0 14px' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <input
            type="text" className="fos-input" style={{ paddingLeft: 36, paddingRight: searchInput ? 36 : 14 }}
            placeholder="Search by who you paid or what it was for…" aria-label="Search expenses"
            value={searchInput} onChange={(e) => handleSearchChange(e.target.value)}
          />
          {searchInput && (
            <button type="button" onClick={() => handleSearchChange('', true)} aria-label="Clear search" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 0 }}>
              <X size={15} />
            </button>
          )}
        </div>
        <select value={filters.sort} onChange={(e) => changeFilter({ sort: e.target.value })} aria-label="Sort expenses" className="fos-input fos-select exp-sort-desktop" style={{ width: 'auto', minWidth: 210, flexShrink: 0 }}>
          {EXPENSE_SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="exp-sort-mobile" style={{ display: 'none' }}>
          <DropdownMenu
            trigger={<ArrowUpDown size={17} />} triggerLabel="Sort" bareTrigger
            triggerStyle={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', border: '1.5px solid var(--border-subtle)' }}
            items={EXPENSE_SORT_OPTIONS.map((o) => ({ key: o.value, label: o.label, onClick: () => changeFilter({ sort: o.value }) }))}
          />
        </div>
      </div>

      {/* ── Filters — one wrapping row; at <= 768px each control grows to share the width ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        <select value={filters.category} onChange={(e) => changeFilter({ category: e.target.value })} aria-label="Filter by category" className="fos-input fos-select exp-filter-control" style={{ width: 'auto', minWidth: 130, fontSize: '0.78rem' }}>
          {CATEGORY_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filters.deductible} onChange={(e) => changeFilter({ deductible: e.target.value })} aria-label="Filter by deductible" className="fos-input fos-select exp-filter-control" style={{ width: 'auto', minWidth: 130, fontSize: '0.78rem' }}>
          {DEDUCTIBLE_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filters.currency} onChange={(e) => changeFilter({ currency: e.target.value })} aria-label="Filter by currency" className="fos-input fos-select exp-filter-control" style={{ width: 'auto', minWidth: 130, fontSize: '0.78rem' }}>
          <option value="">All currencies</option>
          {availableCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <DateRange filters={filters} onChange={changeFilter} problem={rangeProblem} />
        {filtersActive && <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '6px 12px' }} onClick={clearFilters}>Clear filters</button>}
      </div>

      {/* ── List ── */}
      {loading && expenses.length === 0 && !error && <ListSkeleton />}

      {error && expenses.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>{error}</FosAlert>
          <br />
          <button type="button" className="fos-btn fos-btn-ghost" onClick={() => loadList(page)}>Retry</button>
        </div>
      )}

      {nothingYet && <EmptyState onAdd={openCreate} />}
      {noMatches && <NoMatches onClear={clearFilters} />}

      {expenses.length > 0 && (
        <>
          {error && (
            <FosAlert type="error" style={{ marginBottom: 12 }}>
              {error} <button type="button" className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={() => loadList(page)}>Retry</button>
            </FosAlert>
          )}
          <div className="list-desktop" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
            <ExpenseTable expenses={expenses} onOpen={openEdit} onDuplicate={openCopy} onDelete={openDelete} />
          </div>
          <div className="list-mobile" style={{ display: 'none', flexDirection: 'column', gap: 10, opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
            {expenses.map((e) => <ExpenseCard key={e.id} expense={e} onOpen={openEdit} onDuplicate={openCopy} onDelete={openDelete} />)}
          </div>
          <div className="exp-pagination-desktop">
            <Pagination page={page} total={total} itemLabel="expenses" onPageChange={(n) => loadList(n)} loading={loading} />
          </div>
          <div className="exp-pagination-mobile" style={{ display: 'none' }}>
            <Pagination page={page} total={total} itemLabel="expenses" onPageChange={(n) => loadList(n)} loading={loading} compact />
          </div>
        </>
      )}

      {/* ── Mobile FAB ── */}
      <button type="button" className="page-fab" onClick={openCreate} aria-label="Add expense" style={{
        display: 'none', position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
        borderRadius: '50%', background: 'var(--accent)', color: '#000', border: 'none',
        boxShadow: '0 4px 20px var(--accent-glow-lg)', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: 90,
      }}>
        <Plus size={24} />
      </button>

      {formState && (
        <ExpenseFormModal
          key={formState.mode + (formState.expense?.id || '')}
          expense={formState.mode === 'edit' ? formState.expense : null}
          copyFrom={formState.mode === 'copy' ? formState.expense : null}
          profileCurrency={profileCurrency} currencies={currencies}
          onCreated={() => refresh({ firstPage: true })}
          onSaved={() => { setFormState(null); showFlash(FLASH.updated); refresh() }}
          onChanged={() => refresh()}
          onFinish={(text) => { setFormState(null); showFlash(text) }}
          onClose={() => setFormState(null)}
        />
      )}

      {deleting && (
        <ExpenseDeleteDialog
          expense={deleting}
          onDeleted={(text) => { setDeleting(null); showFlash(text); refresh() }}
          onClose={() => setDeleting(null)}
        />
      )}

      <style>{`
        @media (max-width: 768px) {
          .page-fab { display: flex !important; }
          .exp-top-grid { grid-template-columns: 1fr !important; }
          .exp-filter-control { flex: 1 1 140px !important; min-width: 0 !important; }
          .exp-date-field { flex: 1 1 140px !important; }
          .exp-date-field input { flex: 1 1 140px !important; min-width: 0 !important; }
          .exp-range-problem { flex-basis: 100% !important; }
          .exp-sort-desktop { display: none !important; }
          .exp-sort-mobile { display: flex !important; }
          .list-desktop { display: none !important; }
          .list-mobile { display: flex !important; }
          .exp-pagination-desktop { display: none !important; }
          .exp-pagination-mobile { display: block !important; }
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

function DateRange({ filters, onChange, problem }) {
  const labelStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: 'var(--text-tertiary)' }
  const inputStyle = { width: 'auto', fontSize: '0.78rem' }
  return (
    <>
      <label className="exp-date-field" style={labelStyle}>
        From
        <input type="date" className="fos-input" value={filters.start} max={filters.end || undefined} onChange={(e) => onChange({ start: e.target.value })} style={inputStyle} />
      </label>
      <label className="exp-date-field" style={labelStyle}>
        To
        <input type="date" className="fos-input" value={filters.end} min={filters.start || undefined} onChange={(e) => onChange({ end: e.target.value })} style={inputStyle} />
      </label>
      {problem && <span className="fos-error exp-range-problem" role="alert" style={{ margin: 0, fontSize: '0.76rem' }}>{problem}</span>}
    </>
  )
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading expenses" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} style={{ height: 52, background: 'var(--bg-surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  )
}

function EmptyState({ onAdd }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <Receipt size={28} aria-hidden="true" style={{ color: 'var(--text-tertiary)', marginBottom: 10 }} />
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>No expenses recorded yet</p>
      <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
        Add what you spend on your business, like software, internet or equipment, so you can see what you actually keep.
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
        <button type="button" className="fos-btn fos-btn-accent" onClick={onAdd}><Plus size={15} aria-hidden="true" /> Add expense</button>
      </div>
    </div>
  )
}

function NoMatches({ onClear }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>No expenses match these filters.</p>
      <button type="button" className="fos-btn fos-btn-ghost" style={{ marginTop: 14 }} onClick={onClear}>Clear filters</button>
    </div>
  )
}
