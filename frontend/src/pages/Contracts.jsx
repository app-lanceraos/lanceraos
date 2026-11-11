// src/pages/Contracts.jsx
//
// Contract list (Prompt 23, Part 6). Structured like Proposals.jsx on purpose: server-paginated at PAGE_SIZE, a request-id
// guard against stale responses, a loading dim instead of unmounting, measured-width filter overflow, header actions
// registered into AppShell, rows that lead to ROUTED pages (/contracts/:id).
//
// The API supports exactly two filters (?status=, ?search=) and one order (newest first); this page offers no more than
// that. "Expired" is computed on read and cannot be filtered server-side, so there is no Expired pill; it is an amber badge.
//
// Notification and email links look like /contracts?contract=<id>; that is redirected to /contracts/<id> BEFORE the list is
// requested. A value that is not a UUID is ignored and removed from the URL: it is never put into a request path.
import { hoverProps } from '@/lib/hoverProps'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { FileSignature, Plus, Search, X } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import useFlashMessage from '@/hooks/useFlashMessage'
import usePageHeaderActions from '@/hooks/usePageHeaderActions'
import useFilterOverflow from '@/hooks/useFilterOverflow'
import ContractStatusBadge from '@/components/ContractStatusBadge'
import ContractTable, { ExpiredBadge } from '@/components/ContractTable'
import FilterPill from '@/components/FilterPill'
import FilterOverflowMenu from '@/components/FilterOverflowMenu'
import FosAlert from '@/components/FosAlert'
import Pagination, { PAGE_SIZE } from '@/components/Pagination'
import { OWNER_COPY } from './contractCopy'
import { STATUS_FILTER_OPTIONS, errorMessage, isUuid, moneyLabel } from './contractHelpers'
import { formatDate } from './proposalHelpers'

const SEARCH_DEBOUNCE_MS = 300

export default function Contracts() {
  const [searchParams, setSearchParams] = useSearchParams()
  const linked = searchParams.get('contract')
  const valid = isUuid(linked)

  // A junk value is dropped from the URL (once), never requested and never redirected to.
  useEffect(() => {
    if (linked !== null && !valid) {
      const next = new URLSearchParams(searchParams)
      next.delete('contract')
      setSearchParams(next, { replace: true })
    }
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Decided synchronously, before any state or request: a notification link must not flash the list.
  if (valid) return <Navigate to={`/contracts/${linked}`} replace />
  return <ContractList />
}

function ContractList() {
  useTitle('LanceraOS | Contracts')
  const navigate = useNavigate()

  const [contracts, setContracts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  // A one-shot message from delete, handed over in history state.
  const [flash, dismissFlash] = useFlashMessage()

  const searchTimer = useRef(null)
  const latestRequestId = useRef(0)

  useEffect(() => () => {
    clearTimeout(searchTimer.current)
    latestRequestId.current += 1
  }, [])

  // Memoised for the reason Invoices.jsx documents at length: the header registration effect keys off these objects'
  // identity, and a fresh JSX node every render would re-fire it forever.
  const desktopHeaderActions = useMemo(() => (
    <Link className="fos-btn fos-btn-accent" to="/contracts/new">
      <Plus size={15} /> {OWNER_COPY.newButton}
    </Link>
  ), [])
  const mobileHeaderItems = useMemo(() => [], [])
  usePageHeaderActions({ desktop: desktopHeaderActions, mobileItems: mobileHeaderItems })

  function buildParams(targetPage, overrides) {
    const params = { offset: (targetPage - 1) * PAGE_SIZE, limit: PAGE_SIZE }
    const searchValue = 'search' in overrides ? overrides.search : search
    const statusValue = 'status' in overrides ? overrides.status : statusFilter
    if (searchValue) params.search = searchValue
    if (statusValue) params.status = statusValue
    return params
  }

  async function load(targetPage, overrides = {}) {
    const requestId = ++latestRequestId.current
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/contracts/', { params: buildParams(targetPage, overrides) })
      if (requestId !== latestRequestId.current) return
      const results = data.results || []
      const totalCount = data.total ?? 0
      // The page this just emptied (the last row of the last page was deleted elsewhere): step back instead of showing a
      // blank page that has real contracts behind it.
      if (results.length === 0 && targetPage > 1 && totalCount > 0) {
        await load(targetPage - 1, overrides)
        return
      }
      setPage(targetPage)
      setContracts(results)
      setTotal(totalCount)
    } catch (e) {
      if (requestId !== latestRequestId.current) return
      // Only a 429 carries a sentence of ours worth showing; any other failure gets the fixed one, never a raw body.
      setError(e?.response?.status === 429 ? errorMessage(e, OWNER_COPY.listLoadFailed).message : OWNER_COPY.listLoadFailed)
    } finally {
      if (requestId === latestRequestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectStatusFilter(key) {
    setStatusFilter(key)
    load(1, { status: key })
  }

  function handleSearchChange(value) {
    setSearch(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(1, { search: value }), SEARCH_DEBOUNCE_MS)
  }

  const openContract = useCallback((contract) => navigate(`/contracts/${contract.id}`), [navigate])

  // ── Filter pills with measured-width overflow ──
  const allChips = STATUS_FILTER_OPTIONS.map((option) => ({
    type: 'pill', key: option.key || 'all', label: option.label,
    active: statusFilter === option.key, onClick: () => selectStatusFilter(option.key),
  }))
  const { containerRef, measureRefs, moreRef, visibleCount } = useFilterOverflow(allChips.length)
  const visibleChips = allChips.slice(0, visibleCount)
  const overflowChips = allChips.slice(visibleCount)

  return (
    <>
      {flash && <FosAlert type="success" onDismiss={dismissFlash} style={{ marginBottom: 16 }}>{flash}</FosAlert>}

      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
        <input
          type="text" className="fos-input" aria-label="Search contracts"
          style={{ paddingLeft: 36, paddingRight: search ? 36 : 14 }}
          placeholder={OWNER_COPY.searchPlaceholder}
          value={search} onChange={(e) => handleSearchChange(e.target.value)}
        />
        {search && (
          <button
            onClick={() => handleSearchChange('')} aria-label="Clear search"
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 0 }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className="filter-row-desktop" style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <div ref={containerRef} style={{ display: 'flex', gap: 8, overflow: 'hidden', flexWrap: 'nowrap', flex: 1, minWidth: 0 }}>
          {visibleChips.map((chip) => (
            <FilterPill key={chip.key} active={chip.active} onClick={chip.onClick}>{chip.label}</FilterPill>
          ))}
        </div>
        {overflowChips.length > 0 && <FilterOverflowMenu chips={overflowChips} />}

        {/* Hidden measurement row: every pill's true width, independent of the visible container (see useFilterOverflow.js). */}
        <div aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', top: -9999, left: 0, display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
          {allChips.map((chip, i) => (
            <FilterPill key={chip.key} ref={(el) => { measureRefs.current[i] = el }} active={chip.active} tabIndex={-1}>{chip.label}</FilterPill>
          ))}
          <button ref={moreRef} className="fos-btn" style={{ padding: '6px 14px', fontSize: '0.78rem', borderRadius: 'var(--radius-full)' }} tabIndex={-1}>More filters (7)</button>
        </div>
      </div>

      <div className="filter-row-mobile" style={{ display: 'none', gap: 8, marginBottom: 20 }}>
        <select
          value={statusFilter} onChange={(e) => selectStatusFilter(e.target.value)}
          className="fos-input fos-select" style={{ flex: 1, minWidth: 0 }} aria-label="Filter by status"
        >
          {STATUS_FILTER_OPTIONS.map((option) => <option key={option.key || 'all'} value={option.key}>{option.label}</option>)}
        </select>
      </div>

      {loading && contracts.length === 0 && !error && <ListSkeleton />}

      {error && contracts.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>{error}</FosAlert>
          <br />
          <button className="fos-btn fos-btn-ghost" onClick={() => load(page)}>Retry</button>
        </div>
      )}

      {contracts.length > 0 && (
        <>
          {error && (
            <FosAlert type="error" style={{ marginBottom: 12 }}>
              {error} <button className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={() => load(page)}>Retry</button>
            </FosAlert>
          )}

          <div className="list-desktop" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
            <ContractTable contracts={contracts} onOpen={openContract} />
          </div>
          <div
            className="list-mobile"
            style={{ display: 'none', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}
          >
            {contracts.map((contract) => <ContractCard key={contract.id} contract={contract} />)}
          </div>

          <div className="pagination-desktop">
            <Pagination page={page} total={total} itemLabel="contracts" onPageChange={(n) => load(n)} loading={loading} />
          </div>
          <div className="pagination-mobile" style={{ display: 'none' }}>
            <Pagination page={page} total={total} itemLabel="contracts" onPageChange={(n) => load(n)} loading={loading} compact />
          </div>
        </>
      )}

      {!loading && !error && contracts.length === 0 && <EmptyState search={search} statusFilter={statusFilter} />}

      <Link
        className="page-fab" to="/contracts/new" aria-label={OWNER_COPY.newButton}
        style={{
          display: 'none', position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
          borderRadius: '50%', background: 'var(--accent)', color: '#000', border: 'none',
          boxShadow: '0 4px 20px var(--accent-glow-lg)', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', zIndex: 90,
        }}
      >
        <Plus size={24} />
      </Link>

      <style>{`
        @media (max-width: 768px) {
          .page-fab { display: flex !important; }
          .filter-row-desktop { display: none !important; }
          .filter-row-mobile { display: flex !important; }
          .list-desktop { display: none !important; }
          .list-mobile { display: grid !important; }
          .pagination-desktop { display: none !important; }
          .pagination-mobile { display: block !important; }
        }
      `}</style>
    </>
  )
}

// ── ContractCard: mobile-only list item. A real <Link>, so it is focusable and keyboard-operable without extra handling. ──
function ContractCard({ contract }) {
  const [hovered, setHovered] = useState(false)
  return (
    <Link
      to={`/contracts/${contract.id}`}
      {...hoverProps(() => setHovered(true), () => setHovered(false))}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none',
        background: hovered ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 18px',
        transition: 'background var(--transition-fast)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contract.title}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contract.client_name || OWNER_COPY.noClient}
          </p>
        </div>
        <div style={{ flexShrink: 0 }}>
          <ContractStatusBadge status={contract.status} expired={contract.is_expired} />
        </div>
      </div>
      <div>
        <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {moneyLabel(contract.fee_amount, contract.currency)}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{contract.contract_number || OWNER_COPY.noNumber} · {OWNER_COPY.columns.signBy} {formatDate(contract.valid_until)}</span>
          {contract.is_expired && <ExpiredBadge />}
        </p>
      </div>
    </Link>
  )
}

function ListSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }} aria-hidden="true">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} style={{ height: 116, background: 'var(--bg-surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  )
}

function EmptyState({ search, statusFilter }) {
  const filtered = Boolean(search) || Boolean(statusFilter)
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <FileSignature size={28} aria-hidden="true" style={{ color: 'var(--text-tertiary)', marginBottom: 10 }} />
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
        {filtered ? OWNER_COPY.noResultsTitle : OWNER_COPY.emptyTitle}
      </p>
      <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
        {filtered ? OWNER_COPY.noResultsBody : OWNER_COPY.emptyBody}
      </p>
      {!filtered && (
        <Link className="fos-btn fos-btn-accent" to="/contracts/new" style={{ marginTop: 16, display: 'inline-flex' }}>
          <Plus size={15} /> {OWNER_COPY.newButton}
        </Link>
      )}
    </div>
  )
}

