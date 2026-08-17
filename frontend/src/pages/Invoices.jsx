// src/pages/Invoices.jsx
//
// Invoice list — apps/invoices/ CRUD + lifecycle endpoints from Step 5, plus
// GET .../pdf/ (Step 7b) and a "Manage Designs" entry point into Step 8b's
// design gallery/editor (no per-invoice design override at creation time
// yet — InvoiceFormFields.jsx has no design-picker field, confirmed
// directly; flagged in DECISIONS.md rather than added here, out of this
// step's scope). No /send/, no portal/comments/claims — those are later
// steps, not stubbed here, same "don't build a placeholder" convention as
// the backend. Ports v1's Invoices.jsx interaction patterns (search/filter/
// sort, card list, create flow, mobile FAB) against v2's real endpoints and
// response shapes — v1's stored 'overdue' status badge and its Cash Flow
// Forecast / Currency Diversification sections are deliberately NOT ported
// (see this build's summary for why the latter two are flagged as a product
// conversation, not a default inclusion).
//
// Critical display rule: Overdue is never a status value in v2 — it's
// invoice.days_overdue > 0, a computed flag shown as an orthogonal badge
// alongside whatever the real status is (see apps/invoices/models.py's
// days_overdue docstring), and that data-model fact is unchanged here.
// The "Overdue" FILTER TOGGLE below is a separate control from the status
// pills, not a 10th status option — but as of this pass it's mutually
// EXCLUSIVE with them in the UI (confirmed directly, not independently
// combinable as an earlier version of this comment claimed): picking a
// status pill clears Overdue, and toggling Overdue clears the status
// pill. A sent-and-overdue invoice is still reachable (via the Overdue
// toggle alone, or the "Sent" pill alone) — it's just not reachable by
// both filters applied together anymore.
//
// FILTER ARCHITECTURE — reworked again in this pass; read this before
// touching statusFilter/overdueOnly. History: v1's status pills filtered
// an already-loaded array in memory and never called `load()` on a pill
// click at all (traced directly against v1-reference/frontend/src/pages/
// Invoices.jsx). v2's earlier version filtered server-side (a real GET on
// every pill click) but that felt like a reload because of a SEPARATE bug
// — `load()` unconditionally set `loading=true`, and the render logic
// unmounted the whole grid whenever `loading` was true. The 11 August fix
// ported v1's client-side-filter architecture wholesale to make the
// symptom go away, but that was treating the loading-skeleton bug as if
// it were the filter architecture's fault — it wasn't. With the REAL root
// cause (skeleton-on-every-refetch) fixed on its own terms (see below),
// server-side filtering no longer has any reload-feel problem to hide
// from, so this pass reverses that part of the 11 August change:
//   - "All" (statusFilter='' && !overdueOnly): unchanged — a client-side
//     window over the loaded page (10 -> Show More (20) -> real
//     server-paged beyond that, see PaginationControls below).
//   - Any specific status filter, or Overdue: now a REAL, independently-
//     paginated server query (`?status=X` or `?overdue=true`, same tiered
//     pagination shape, its own real `total`) — never capped to whatever
//     happened to already be loaded for "All". Switching filters always
//     shows genuinely complete, correct results for that filter, not a
//     window that might be missing older matches. `buildParams` accepts
//     explicit status/overdue overrides (mirroring how `search` already
//     avoids reading a stale closure right after its own setState) so
//     `selectStatusFilter`/`toggleOverdueFilter` send the right params on
//     the very same click, not the run after.
// Search/sort remain real server round-trips as they always were. The
// loading-state fix (skeleton only on a genuine first load with nothing
// rendered yet; every other refetch — filter, search, sort — keeps the
// current list mounted and just dims it) applies identically to a filter
// change now, same as it already did for search/sort — see the render
// below and DECISIONS.md for the full reversal reasoning.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search, X, Plus, FileText, BookmarkPlus, LayoutTemplate, BarChart3, Trash2, CheckSquare, Square,
} from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import FosAlert from '@/components/FosAlert'
import InvoiceDetailPanel from '@/components/InvoiceDetailPanel'
import NewInvoiceWizard from '@/components/NewInvoiceWizard'
import InvoiceStatusBadge from '@/components/InvoiceStatusBadge'
import {
  INVOICE_STATUS_META, OVERDUE_BADGE, STATUS_BADGE_STYLE, badgeBaseStyle, formatMoney,
  STATUS_FILTER_OPTIONS, SORT_OPTIONS, formatAggregate, daysOverdueLabel,
} from './invoiceHelpers'

// Real, tiered pagination (item 5 of the verification pass — replaces
// the earlier flat "60, then +60" Load More): 10 most recent by default;
// Show More loads 10 more client-side (append, matching the existing
// "loaded, filtered client-side" architecture the header comment above
// describes for status/Overdue filtering); beyond COMPACT_MAX total
// available, the UI switches to real server-paged navigation in pages of
// PAGE_SIZE — each page a fresh, REPLACING fetch (never an append) with
// its own offset — rather than trying to "load more" indefinitely. Show
// fewer collapses back to the first COMPACT_INITIAL from anywhere.
const COMPACT_INITIAL = 10
const COMPACT_MAX = 20
const PAGE_SIZE = 20

// Matches apps/invoices/views.py's invoice_detail DELETE rule exactly
// ("Only draft or created invoices can be deleted") — reused here, not
// re-derived, so this can never silently drift from the real server-side
// rule (item 7 of the verification pass).
const DELETE_ELIGIBLE_STATUSES = ['draft', 'created']

export default function Invoices() {
  useTitle('LanceraOS | Invoices')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [invoices, setInvoices] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // 'compact': 10 -> (Show More) -> 20, client-side append, matches the
  //   status/Overdue filter's own "whatever's currently loaded" model.
  // 'paged': real server-paged navigation, PAGE_SIZE per page, each page
  //   REPLACES the loaded set rather than appending to it.
  const [viewMode, setViewMode] = useState('compact')
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [sort, setSort] = useState('recent')

  const [presets, setPresets] = useState([])

  const [summary, setSummary] = useState(null)

  const [createError, setCreateError] = useState(null)
  const [showPresetPicker, setShowPresetPicker] = useState(false)
  const [presetBusyId, setPresetBusyId] = useState(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)
  const [showNewWizard, setShowNewWizard] = useState(false)
  const [wizardEditId, setWizardEditId] = useState(null)
  const [pendingDetailMessage, setPendingDetailMessage] = useState(null)
  // Opens the detail panel directly on a specific tab — item 2 of this
  // round's verification pass. Real source: a comment/claim notification
  // click-through (?invoice=<id>&tab=comments|claims), see the mount
  // effect below.
  const [pendingDetailTab, setPendingDetailTab] = useState(null)

  // Bulk delete (item 7) — only draft/created invoices are ever selectable
  // at all (matches invoice_detail's own server-side DELETE rule exactly:
  // apps/invoices/views.py rejects anything else with a 403 regardless of
  // what the frontend allows). A Set of ids, not a boolean-per-invoice
  // map, so "Select all" only ever needs to know which ids are currently
  // eligible+visible.
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)

  const searchTimer = useRef(null)
  // Stale-response protection — no existing AbortController/request-id
  // pattern in the app to match (the only mention of AbortController
  // anywhere is useInvoiceAutosave.js's own comment explaining why it was
  // REJECTED for that hook's problem — aborting a client-side promise
  // doesn't stop Django from finishing an in-flight PUT, so an aborted
  // write could still land after a newer one). That reasoning doesn't
  // apply here: these are reads, and all we need is "don't let an
  // out-of-order response overwrite state with stale data" — a
  // monotonically increasing request-id, checked before every commit to
  // state, is the simpler mechanism for that and needs no special
  // abort-error handling.
  const latestRequestId = useRef(0)

  const load = useCallback(async (params, append = false) => {
    const requestId = ++latestRequestId.current
    if (append) setLoadingMore(true); else { setLoading(true); setError(null) }
    try {
      const { data } = await api.get('/invoices/', { params })
      if (requestId !== latestRequestId.current) return // superseded by a newer request — discard
      setInvoices((prev) => (append ? [...prev, ...(data.results || [])] : data.results || []))
      setTotal(data.total ?? 0)
      // A non-append load REPLACES the visible set (filter/search/sort/
      // page change, or a refresh) — any prior bulk-delete selection no
      // longer refers to what's actually on screen, so clear it rather
      // than risk "Select all"/"Delete selected" acting on stale ids.
      if (!append) setSelectedIds(new Set())
    } catch {
      if (requestId !== latestRequestId.current) return
      if (!append) setError('Failed to load invoices. Please try again.')
    } finally {
      if (requestId === latestRequestId.current) {
        if (append) setLoadingMore(false); else setLoading(false)
      }
    }
  }, [])

  // `overrides` lets a caller supply a status/overdue value that hasn't
  // landed in state yet — the same technique handleSearchChange already
  // uses for `search` (setState is async; reading statusFilter/overdueOnly
  // right after calling their own setter in the same handler would still
  // see the PREVIOUS value). Every other call site (sort change, Show
  // More, page nav, Show fewer, retry) omits overrides entirely and just
  // reads the already-committed statusFilter/overdueOnly from state.
  function buildParams(offset, limit, overrides = {}) {
    const params = { offset, limit }
    if (search) params.search = search
    if (sort) params.sort = sort
    const status = 'status' in overrides ? overrides.status : statusFilter
    const overdue = 'overdue' in overrides ? overrides.overdue : overdueOnly
    if (status) params.status = status
    if (overdue) params.overdue = 'true'
    return params
  }

  useEffect(() => {
    setViewMode('compact')
    setPage(1)
    load(buildParams(0, COMPACT_INITIAL))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort])

  // Real, independently-paginated server query per filter (item 4 of this
  // pass — see the header comment's full FILTER ARCHITECTURE note).
  // Mutual exclusivity with Overdue preserved exactly as before.
  function selectStatusFilter(key) {
    setStatusFilter(key)
    setOverdueOnly(false)
    setViewMode('compact')
    setPage(1)
    load(buildParams(0, COMPACT_INITIAL, { status: key, overdue: false }))
  }

  // forceOn: the desktop pill toggles (clicking an already-active Overdue
  // pill turns it back off, matching its existing behavior); the mobile
  // <select> always means "choose this option", so it passes `true`
  // explicitly rather than toggling off an already-selected value.
  function toggleOverdueFilter(forceOn) {
    const next = forceOn !== undefined ? forceOn : !overdueOnly
    setOverdueOnly(next)
    setStatusFilter('')
    setViewMode('compact')
    setPage(1)
    load(buildParams(0, COMPACT_INITIAL, { status: '', overdue: next }))
  }

  useEffect(() => {
    api.get('/invoices/summary/').then(({ data }) => setSummary(data)).catch(() => setSummary(null))
    api.get('/invoices/presets/').then(({ data }) => setPresets(data)).catch(() => setPresets([]))
  }, [])

  // Notification click-through (item 2 of this round) — core.notifications.
  // EVENT_ACTION_URLS' comment_posted/payment_claim_submitted/
  // invoice_acknowledged/invoice_escalation_required/
  // recurring_invoice_generated entries all point here
  // (/invoices?invoice=<id>&tab=<tab>), since there is no /invoices/:id
  // ROUTE at all in this app (confirmed directly against App.jsx) — the
  // detail view is a panel driven by state, not a routed page. Opens the
  // panel directly on the requested tab (falls back to Details for a
  // missing/unrecognized tab — InvoiceDetailPanel's own VALID_TABS
  // allowlist), then strips the query params so a refresh or Back doesn't
  // reopen the same target.
  useEffect(() => {
    const invoiceParam = searchParams.get('invoice')
    if (!invoiceParam) return
    setSelectedInvoiceId(invoiceParam)
    setPendingDetailTab(searchParams.get('tab'))
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Passes the just-typed value directly into the debounced call instead
  // of relying on closure over `search` state — the old version captured
  // whatever `search` was AT THE TIME setTimeout was scheduled, which is
  // one keystroke behind by the time it actually fires for rapid typing.
  // `buildParams(0)` still reads its own (possibly stale) `search` closure
  // internally, but the explicit `search: value || undefined` spread
  // after it always wins, so the request that actually goes out carries
  // the real, current typed text.
  function handleSearchChange(value) {
    setSearch(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setViewMode('compact')
      setPage(1)
      load({ ...buildParams(0, COMPACT_INITIAL), search: value || undefined })
    }, 300)
  }

  // Compact mode's own "load a few more, append" step — 10 -> 20, never
  // past COMPACT_MAX. Once 20 are loaded and more still exist on the
  // server, real page controls take over instead (see the render below).
  function showMore() {
    load(buildParams(invoices.length, COMPACT_MAX - invoices.length), true)
  }

  // Real server-paged navigation — REPLACES the loaded set (append=false),
  // unlike showMore above. Reachable once total exceeds COMPACT_MAX.
  function goToPage(n) {
    setViewMode('paged')
    setPage(n)
    load(buildParams((n - 1) * PAGE_SIZE, PAGE_SIZE))
  }

  // Collapses back to the first COMPACT_INITIAL, from either compact/20
  // or any page of paged mode — a real fresh fetch, not a client-side
  // slice, since paged mode's current page may not even include the
  // true first COMPACT_INITIAL invoices.
  function showFewer() {
    setViewMode('compact')
    setPage(1)
    load(buildParams(0, COMPACT_INITIAL))
  }

  // Re-fetches whatever's currently visible, in place — a real page stays
  // on that same page (paged mode); compact mode keeps its current 10-or-
  // 20 count rather than silently collapsing back to 10 after an edit.
  // Shared by refreshAfterChange (below) and the error banner's Retry.
  function reloadCurrentView() {
    if (viewMode === 'paged') {
      load(buildParams((page - 1) * PAGE_SIZE, PAGE_SIZE))
    } else {
      const count = invoices.length > COMPACT_INITIAL ? COMPACT_MAX : COMPACT_INITIAL
      load(buildParams(0, count))
    }
  }

  function refreshAfterChange() {
    reloadCurrentView()
    api.get('/invoices/summary/').then(({ data }) => setSummary(data)).catch(() => {})
  }

  function toggleSelectForDelete(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Only ever selects invoices that are BOTH currently visible AND
  // deletion-eligible — never silently selects something a "Select all"
  // click shouldn't be able to touch, even if ineligible invoices are
  // also on screen right now.
  function selectAllEligible() {
    setSelectedIds(new Set(invoices.filter((inv) => DELETE_ELIGIBLE_STATUSES.includes(inv.status)).map((inv) => inv.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  // Client-side loop over the existing single-delete endpoint — confirmed
  // directly, no real bulk-delete endpoint exists in apps/invoices/urls.py.
  // Each DELETE still hits invoice_detail's own server-side draft/created
  // check independently, so this can't succeed against anything ineligible
  // even if selection state were somehow stale.
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

  // A draft is still being built, so it opens in the same guided wizard a
  // brand-new invoice does (pre-filled with its real saved data) rather
  // than InvoiceDetailPanel — only status=created-and-beyond invoices open
  // the detail panel. See DECISIONS.md.
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

  // "New Invoice" no longer creates a backend record immediately — a real,
  // deliberate reversal of the earlier Gmail-compose-style rework (see
  // DECISIONS.md): an empty draft invoice is a real row in a business
  // list, not a disposable compose window. NewInvoiceWizard.jsx holds form
  // state locally and only fires the real POST /invoices/ once a genuine
  // creation threshold is crossed (a client, existing or one-time).
  function handleNewInvoice() {
    setCreateError(null)
    setShowNewWizard(true)
  }

  // Called when NewInvoiceWizard closes — `createdId` is the real backend
  // id if the threshold was crossed before closing (or the draft already
  // existed, in edit mode), or null if a brand-new wizard was closed
  // before ever entering a client (nothing was created, nothing to
  // refresh).
  function handleWizardClosed(createdId) {
    setShowNewWizard(false)
    setWizardEditId(null)
    if (createdId) refreshAfterChange()
  }

  // Called when the wizard's Finalise succeeds — hands off to the normal
  // InvoiceDetailPanel for the now-non-draft invoice, same as opening any
  // other existing invoice from the list. The success message travels
  // with the hand-off (`initialMessage`) since the action that earned it
  // happened inside the wizard, a different component instance than the
  // InvoiceDetailPanel that's about to mount for the first time — without
  // this, "Invoice finalised." would have nowhere left to show.
  function handleWizardFinalised(id, message) {
    setShowNewWizard(false)
    setWizardEditId(null)
    setSelectedInvoiceId(id)
    setPendingDetailMessage(message || null)
    refreshAfterChange()
  }

  // preset_create_invoice (backend) creates a real, fully-populated
  // invoice, but it's still status=draft like any other — it opens in the
  // wizard's edit mode too, for the same reason any other draft does.
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

  return (
    <>
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>Invoices</h1>
          {!loading && (
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              {statusFilter || overdueOnly ? (
                <>{invoices.length} matching invoice{invoices.length !== 1 ? 's' : ''} (of {total} total)</>
              ) : (
                <>{total} invoice{total !== 1 ? 's' : ''} in this view</>
              )}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="fos-btn fos-btn-ghost header-analytics-btn" onClick={() => navigate('/invoices/analytics')}>
            <BarChart3 size={15} /> Analytics
          </button>
          <button className="fos-btn fos-btn-ghost header-designs-btn" onClick={() => navigate('/invoices/designs')}>
            <LayoutTemplate size={15} /> Manage Designs
          </button>
          <button className="fos-btn fos-btn-ghost header-preset-btn" onClick={() => setShowPresetPicker(true)}>
            <BookmarkPlus size={15} /> From Preset
          </button>
          <button className="fos-btn fos-btn-accent header-add-btn" onClick={handleNewInvoice}>
            <Plus size={15} /> New Invoice
          </button>
        </div>
      </div>

      {createError && (
        <FosAlert type="error" onDismiss={() => setCreateError(null)} style={{ marginBottom: 16 }}>{createError}</FosAlert>
      )}

      {/* ── Dashboard KPI strip ── */}
      <SummaryStrip summary={summary} />

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

      {/* ── Status pills + Overdue (merged into the same row — a layout
          change only; mutually EXCLUSIVE with each other as of this pass,
          see the header comment above) + Sort, trailing at the right as
          the row's one secondary control ── */}
      {/* Desktop/tablet: the pill row, hidden ≤768px below. */}
      <div className="filter-row-desktop" style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', overscrollBehaviorX: 'contain', paddingBottom: 4, flex: 1, minWidth: 0 }}>
          {STATUS_FILTER_OPTIONS.map((opt) => {
            const isActive = statusFilter === opt.key
            return (
              <button
                key={opt.key || 'all'}
                onClick={() => selectStatusFilter(opt.key)}
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
          <button
            onClick={toggleOverdueFilter}
            className="fos-btn"
            style={{
              flexShrink: 0, padding: '6px 14px', fontSize: '0.78rem', borderRadius: 'var(--radius-full)',
              background: overdueOnly ? 'var(--status-red-bg)' : 'var(--bg-surface)',
              color: overdueOnly ? 'var(--status-red-text)' : 'var(--text-secondary)',
              border: `1.5px solid ${overdueOnly ? 'var(--status-red)' : 'var(--border-subtle)'}`,
              fontWeight: overdueOnly ? 700 : 500,
            }}
          >
            Overdue Only
          </button>
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="fos-input fos-select" style={{ width: 'auto', minWidth: 170, flexShrink: 0 }}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Mobile (≤768px): the same pills, as two dropdowns instead of a
          horizontally-scrollable row — a scrollable pill row is an awkward
          fit for a phone-width screen (partially-hidden pills, sideways
          scrolling to find one), so this collapses "All/Draft/Finalised/…
          /Overdue Only" into a single Filter <select> (Overdue folded in
          as one more option, keeping the same mutual-exclusivity the pill
          row already has) sitting next to the existing Sort dropdown.
          Hidden on desktop/tablet via the media query below; hidden here
          by default so it never flashes before CSS loads. */}
      <div className="filter-row-mobile" style={{ display: 'none', gap: 8, marginBottom: 20 }}>
        <select
          value={overdueOnly ? '__overdue__' : statusFilter}
          onChange={(e) => {
            if (e.target.value === '__overdue__') toggleOverdueFilter(true)
            else selectStatusFilter(e.target.value)
          }}
          className="fos-input fos-select"
          style={{ flex: 1, minWidth: 0 }}
        >
          {STATUS_FILTER_OPTIONS.map((opt) => <option key={opt.key || 'all'} value={opt.key}>{opt.label}</option>)}
          <option value="__overdue__">Overdue Only</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="fos-input fos-select" style={{ flex: 1, minWidth: 0 }}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* ── Content ──
          Only a genuine first load (nothing rendered yet at all) shows the
          full skeleton — every subsequent refetch (filter/search/sort
          change) keeps the current list mounted and just dims it slightly,
          instead of unmounting the whole grid and rebuilding it from
          nothing, which is what made every interaction look like a page
          reload without actually being one (four prior rounds chased this
          as a navigation bug; it never was one — see DECISIONS.md). */}
      {loading && invoices.length === 0 && !error && <InvoiceGridSkeleton />}

      {error && invoices.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>{error}</FosAlert>
          <br />
          <button className="fos-btn fos-btn-ghost" onClick={reloadCurrentView}>Retry</button>
        </div>
      )}

      {invoices.length > 0 && (
        <>
          {error && (
            <FosAlert type="error" style={{ marginBottom: 12 }}>
              {error} <button className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={reloadCurrentView}>Retry</button>
            </FosAlert>
          )}

          {/* The old "searching only what's loaded" disclosure banner is
              gone (item 4 of this pass) — a status/Overdue filter is now a
              real, independently-paginated server query with its own real
              `total`, so there's no under-reporting risk left to disclose;
              PaginationControls' own "(X of Y total)" wording already
              tells the honest, complete story. */}

          {invoices.length === 0 ? (
            <EmptyState search={search} statusFilter={statusFilter} overdueOnly={overdueOnly} onCreate={handleNewInvoice} />
          ) : (
            <div
              style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12,
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
          )}

          <PaginationControls
            viewMode={viewMode} page={page} total={total} invoicesLength={invoices.length}
            loading={loading} loadingMore={loadingMore}
            onShowMore={showMore} onGoToPage={goToPage} onShowFewer={showFewer}
          />
        </>
      )}

      {!loading && !error && invoices.length === 0 && (
        <EmptyState search={search} statusFilter={statusFilter} overdueOnly={overdueOnly} onCreate={handleNewInvoice} />
      )}

      {/* ── Bulk-select action bar (item 7) — appears bottom-right once at
          least one deletion-eligible (draft/created) invoice is selected.
          "Select all" only ever selects the currently-visible eligible
          invoices — never something a sent/paid/etc. card wouldn't even
          offer a checkbox for in the first place. */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 95,
          background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
            {selectedIds.size} selected
          </span>
          <button className="fos-btn fos-btn-ghost" style={{ fontSize: '0.76rem' }} onClick={selectAllEligible}>
            Select all
          </button>
          <button className="fos-btn fos-btn-ghost" style={{ fontSize: '0.76rem' }} onClick={clearSelection}>
            Clear
          </button>
          <button
            className="fos-btn fos-btn-danger" style={{ fontSize: '0.76rem' }}
            onClick={() => setShowBulkDeleteConfirm(true)}
          >
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

      {/* ── Mobile FAB ── */}
      <button className="page-fab" onClick={handleNewInvoice} aria-label="New invoice" style={{
        display: 'none', position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
        borderRadius: '50%', background: 'var(--accent)', color: '#000', border: 'none',
        boxShadow: '0 4px 20px var(--accent-glow-lg)', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: 90,
      }}>
        <Plus size={24} />
      </button>

      {/* ── Preset picker modal ── */}
      {showPresetPicker && (
        <PresetPickerModal
          presets={presets}
          busyId={presetBusyId}
          onPick={handlePickPreset}
          onClose={() => setShowPresetPicker(false)}
        />
      )}

      {/* ── Detail panel — created-and-beyond invoices only; drafts open
          the wizard below instead (see openDetail) ── */}
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

      {/* ── Invoice wizard — new invoice, or an existing draft being edited ── */}
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
          .header-add-btn { display: none !important; }
          .header-preset-btn { display: none !important; }
          .header-designs-btn { display: none !important; }
          .filter-row-desktop { display: none !important; }
          .filter-row-mobile { display: flex !important; }
        }
      `}</style>
    </>
  )
}

// ── SummaryStrip ──────────────────────────────────────────────────
// REVERSAL + real bug fix this pass (items 1/12, see DECISIONS.md):
// Outstanding/Past-Due no longer gate on sent_via_platform, and every
// figure is now a real anchor-currency-unified total in the freelancer's
// own FreelancerProfile.default_currency (summary.currency) — never a
// raw cross-currency sum. formatAggregate now takes that real currency
// label instead of rendering a bare, unlabeled number.
function SummaryStrip({ summary }) {
  const cards = [
    { label: 'Outstanding', data: summary?.outstanding, hint: 'Sent, viewed, or partially paid — not yet resolved', statusKey: 'amber' },
    { label: 'Total Paid', data: summary?.total_paid, hint: 'All-time, net of refunds', statusKey: 'green' },
    { label: 'Past-Due', data: summary?.past_due, hint: 'Outstanding + overdue', statusKey: 'red' },
  ]
  return (
    <>
      <div className="kpi-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        {cards.map((c) => (
          <div key={c.label} className="kpi-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
            <p className="kpi-card-label" style={{ margin: 0, fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{c.label}</p>
            {summary ? (
              <>
                <p className="kpi-card-value" style={{ margin: '5px 0 2px', fontSize: '1.3rem', fontWeight: 800, color: `var(--status-${c.statusKey}-text)`, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {formatAggregate(c.data?.total, summary?.currency)}
                </p>
                <p className="kpi-card-count" style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                  {c.data?.count ?? 0} invoice{c.data?.count !== 1 ? 's' : ''}
                  {c.data?.unconverted_count > 0 && ` · ${c.data.unconverted_count} excluded (no exchange rate)`}
                </p>
              </>
            ) : (
              <div style={{ height: 34, marginTop: 6, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
            )}
          </div>
        ))}
      </div>
      {/* All 3 KPI cards stay in one row from the narrowest phone widths up
          through tablet — measured directly against the real running app
          (real viewport screenshots + boundingBox checks), not guessed.
          auto-fit's 200px-per-card minimum (600px+gaps needed) actually
          fails in TWO separate zones, not just "phone width": (480,659]
          (AppShell's own mobile layout, window.innerWidth<=768, but the
          page's own horizontal padding still leaves less than 600px until
          ~660px), and [769,939] (AppShell switches to its desktop layout
          with a persistent sidebar right at 769px, which eats enough
          width to reintroduce the wrap despite the viewport being WIDER
          than the mobile range that was already fine) — confirmed via a
          real width sweep (600/620/640 wrap, 660/680/700 fine, 769-920
          wrap again, 940+ fine). A single rule up to 939px covers both
          zones (including the already-fine 660-768 gap between them,
          harmlessly — forcing 3 explicit equal columns there changes
          nothing visually since auto-fit already produced 3 equal columns
          in that range); native auto-fit is left alone at 940px+, where
          it's confirmed to work correctly on its own. */}
      <style>{`
        @media (max-width: 939px) {
          .kpi-strip { grid-template-columns: repeat(3, 1fr) !important; gap: 6px !important; }
          .kpi-card { padding: 8px 8px !important; }
          .kpi-card-label { font-size: 0.58rem !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .kpi-card-value { font-size: 0.92rem !important; }
          .kpi-card-count { font-size: 0.62rem !important; }
        }
      `}</style>
    </>
  )
}

// ── PaginationControls ──────────────────────────────────────────────
// Item 5 of the verification pass. Three states, each visible only when
// actually reachable:
//   1. compact, < COMPACT_MAX loaded, more exist -> "Show More".
//   2. compact at COMPACT_MAX with more beyond it, OR already paged ->
//      real Prev/Next + "Page X of Y (total)".
//   3. more than COMPACT_INITIAL currently shown (either state above) ->
//      "Show fewer", always available to collapse back down.
function PaginationControls({ viewMode, page, total, invoicesLength, loading, loadingMore, onShowMore, onGoToPage, onShowFewer }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showShowMore = viewMode === 'compact' && invoicesLength < Math.min(total, COMPACT_MAX)
  const showPager = (viewMode === 'compact' && invoicesLength >= COMPACT_MAX && total > COMPACT_MAX) || viewMode === 'paged'
  const showShowFewer = invoicesLength > COMPACT_INITIAL || viewMode === 'paged'

  if (!showShowMore && !showPager && !showShowFewer) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 20 }}>
      {showShowMore && (
        <button className="fos-btn fos-btn-ghost" onClick={onShowMore} disabled={loadingMore || loading}>
          {loadingMore ? <span className="fos-spinner" /> : null}
          {loadingMore ? 'Loading…' : `Show More (${invoicesLength} of ${total})`}
        </button>
      )}

      {showPager && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="fos-btn fos-btn-ghost" disabled={loading || page <= 1} onClick={() => onGoToPage(page - 1)}>Prev</button>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Page {page} of {totalPages} ({total} total)</span>
          <button className="fos-btn fos-btn-ghost" disabled={loading || page >= totalPages} onClick={() => onGoToPage(page + 1)}>Next</button>
        </div>
      )}

      {showShowFewer && (
        <button className="fos-btn fos-btn-ghost" onClick={onShowFewer} disabled={loading}>Show fewer</button>
      )}
    </div>
  )
}

// ── InvoiceCard ───────────────────────────────────────────────────
// selectable/selected/onToggleSelect (item 7): a checkbox only ever
// renders for a deletion-eligible (draft/created) invoice — a sent/paid/
// etc. card gets no selection control at all, never a disabled one, so
// there's no way to even attempt selecting something ineligible.
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
              {selected ? <CheckSquare size={16} color="var(--accent)" /> : <Square size={16} color="var(--text-tertiary)" />}
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
// A compact centered modal, not a big slide-in panel — "Start from
// Preset" is a secondary, deliberate entry point now (Step 6 rework:
// "New Invoice" itself always means "create and open an empty draft
// immediately", matching Gmail's Compose; picking a preset is the one
// remaining case where a real record is created via a user choice
// first, since preset_create_invoice already creates a real, fully
// populated invoice server-side in one call — no separate blank-form
// step ever existed for presets, so nothing changes there but the
// surrounding chrome).
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
