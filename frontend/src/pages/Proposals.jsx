// src/pages/Proposals.jsx
//
// Proposal list (03 November 2026, Proposals frontend part A). Structured like
// Invoices.jsx on purpose — server-paginated at PAGE_SIZE, a request-id guard
// against stale responses, a loading dim instead of unmounting, measured-width
// filter overflow, header actions registered into AppShell — but the rows lead
// to ROUTED pages (/proposals/:id), not a slide-in panel: a proposal is a long
// document (DECISIONS.md, D1).
//
// The API supports exactly two filters (?status=, ?search=) and one order
// (newest first); this page offers no more than that. "Expired" is computed
// on read and cannot be filtered server-side, so there is no Expired pill.
//
// Notification and email links look like /proposals?proposal=<id>; that is
// redirected to /proposals/<id> before the list is even requested.
import { hoverProps } from '@/lib/hoverProps'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Plus, Search, X } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import useFlashMessage from '@/hooks/useFlashMessage'
import usePageHeaderActions from '@/hooks/usePageHeaderActions'
import useFilterOverflow from '@/hooks/useFilterOverflow'
import FilterPill from '@/components/FilterPill'
import FilterOverflowMenu from '@/components/FilterOverflowMenu'
import FosAlert from '@/components/FosAlert'
import Pagination, { PAGE_SIZE } from '@/components/Pagination'
import ProposalStatusBadge from '@/components/ProposalStatusBadge'
import ProposalTable from '@/components/ProposalTable'
import {
  PROPOSAL_STATUS_META, STATUS_FILTER_OPTIONS, formatDate, formatProposalMoney, isUuid,
} from './proposalHelpers'

const SEARCH_DEBOUNCE_MS = 300

export default function Proposals() {
  const [searchParams] = useSearchParams()
  const linkedId = searchParams.get('proposal')
  // Decided synchronously, before any state or request: a notification link
  // must not flash the list, and a junk value must not redirect to a 404.
  if (isUuid(linkedId)) return <Navigate to={`/proposals/${linkedId}`} replace />
  return <ProposalList />
}

function ProposalList() {
  useTitle('LanceraOS | Proposals')
  const navigate = useNavigate()

  const [proposals, setProposals] = useState([])
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

  const handleNewProposal = useCallback(() => navigate('/proposals/new'), [navigate])

  // Memoised for the reason Invoices.jsx documents at length: the header
  // registration effect keys off these objects' identity, and a fresh JSX node
  // every render would re-fire it forever.
  const desktopHeaderActions = useMemo(() => (
    <button className="fos-btn fos-btn-accent" onClick={handleNewProposal}>
      <Plus size={15} /> New Proposal
    </button>
  ), [handleNewProposal])
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
      const { data } = await api.get('/proposals/', { params: buildParams(targetPage, overrides) })
      if (requestId !== latestRequestId.current) return
      const results = data.results || []
      const totalCount = data.total ?? 0
      // The page this just emptied (the last row of the last page was deleted
      // elsewhere) — step back instead of showing a blank page that has real
      // proposals behind it.
      if (results.length === 0 && targetPage > 1 && totalCount > 0) {
        await load(targetPage - 1, overrides)
        return
      }
      setPage(targetPage)
      setProposals(results)
      setTotal(totalCount)
    } catch {
      if (requestId !== latestRequestId.current) return
      setError('Failed to load proposals. Please try again.')
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

  const openProposal = (proposal) => navigate(`/proposals/${proposal.id}`)

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
          type="text" className="fos-input" aria-label="Search proposals"
          style={{ paddingLeft: 36, paddingRight: search ? 36 : 14 }}
          placeholder="Search by title, client name or company…"
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

        {/* Hidden measurement row — every pill's true width, independent of the
            visible container (see useFilterOverflow.js). */}
        <div aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', top: -9999, left: 0, display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
          {allChips.map((chip, i) => (
            <FilterPill key={chip.key} ref={(el) => { measureRefs.current[i] = el }} active={chip.active} tabIndex={-1}>{chip.label}</FilterPill>
          ))}
          <button ref={moreRef} className="fos-btn" style={{ padding: '6px 14px', fontSize: '0.78rem', borderRadius: 'var(--radius-full)' }} tabIndex={-1}>More filters (9)</button>
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

      {loading && proposals.length === 0 && !error && <ListSkeleton />}

      {error && proposals.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>{error}</FosAlert>
          <br />
          <button className="fos-btn fos-btn-ghost" onClick={() => load(page)}>Retry</button>
        </div>
      )}

      {proposals.length > 0 && (
        <>
          {error && (
            <FosAlert type="error" style={{ marginBottom: 12 }}>
              {error} <button className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={() => load(page)}>Retry</button>
            </FosAlert>
          )}

          <div className="list-desktop" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
            <ProposalTable proposals={proposals} onOpen={openProposal} />
          </div>
          <div
            className="list-mobile"
            style={{ display: 'none', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}
          >
            {proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} />)}
          </div>

          <div className="pagination-desktop">
            <Pagination page={page} total={total} itemLabel="proposals" onPageChange={(n) => load(n)} loading={loading} />
          </div>
          <div className="pagination-mobile" style={{ display: 'none' }}>
            <Pagination page={page} total={total} itemLabel="proposals" onPageChange={(n) => load(n)} loading={loading} compact />
          </div>
        </>
      )}

      {!loading && !error && proposals.length === 0 && (
        <EmptyState search={search} statusFilter={statusFilter} onCreate={handleNewProposal} />
      )}

      <button
        className="page-fab" onClick={handleNewProposal} aria-label="New proposal"
        style={{
          display: 'none', position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
          borderRadius: '50%', background: 'var(--accent)', color: '#000', border: 'none',
          boxShadow: '0 4px 20px var(--accent-glow-lg)', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', zIndex: 90,
        }}
      >
        <Plus size={24} />
      </button>

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

// ── ProposalCard — mobile-only list item. A real <Link>, so it is focusable
// and keyboard-operable without any extra handling. ──
function ProposalCard({ proposal }) {
  const [hovered, setHovered] = useState(false)
  return (
    <Link
      to={`/proposals/${proposal.id}`}
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
            {proposal.title}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {proposal.client_name || 'No client yet'}
          </p>
        </div>
        <div style={{ flexShrink: 0 }}>
          <ProposalStatusBadge status={proposal.status} expired={proposal.is_expired} />
        </div>
      </div>
      <div>
        <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {formatProposalMoney(proposal.total, proposal.currency)}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
          {proposal.proposal_number || 'Draft'} · Valid until {formatDate(proposal.valid_until)}
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

function EmptyState({ search, statusFilter, onCreate }) {
  const isFiltered = Boolean(search) || Boolean(statusFilter)
  const copy = search
    ? `No proposals matching "${search}".`
    : statusFilter
      ? `No ${(PROPOSAL_STATUS_META[statusFilter]?.label || statusFilter).toLowerCase()} proposals.`
      : 'No proposals yet.'
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <FileText size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 10 }} />
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{copy}</p>
      {!isFiltered && (
        <>
          <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
            Paste a job post and get a first draft in seconds, or start from a blank page.
          </p>
          <button className="fos-btn fos-btn-accent" style={{ marginTop: 16 }} onClick={onCreate}>
            <Plus size={15} /> Write your first proposal
          </button>
        </>
      )}
    </div>
  )
}
