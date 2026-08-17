// src/pages/Invoices.test.jsx
//
// Targeted regression coverage for the "everything feels like a reload"
// investigation — which went through two real fixes, not one:
//   1. load() unconditionally set loading=true on every filter/search/sort
//      change, and the render logic unmounted the whole list whenever
//      loading was true (fixed first).
//   2. Status/Overdue filtering was STILL a real server round-trip even
//      after fix #1 (a dimmed-but-still-changing UI on every pill click),
//      which is what v1-reference/frontend/src/pages/Invoices.jsx never
//      had in the first place — v1's status pills filter its already-
//      loaded `invoices` array in memory and never call `load()` at all
//      on a filter click. This pass ports that exact architecture:
//      status/overdue are now a pure client-side filter over whatever's
//      loaded (`visibleInvoices`), never touching the network or
//      `loading`. See DECISIONS.md and Invoices.jsx's own header comment.
//
// No @testing-library/jest-dom in this project's devDependencies — plain
// vitest `expect` + raw DOM properties, same convention as this repo's
// other test files.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import Invoices from './Invoices'

let mock

function invoiceFixture(overrides = {}) {
  return {
    id: 'inv-' + Math.random().toString(36).slice(2),
    invoice_number: 'INV-2026-0001', status: 'created', client_name: 'Test Client',
    total: '100.00', currency: 'USD', due_date: null, days_overdue: 0,
    ...overrides,
  }
}

function renderInvoices() {
  return render(<MemoryRouter><Invoices /></MemoryRouter>)
}

beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 0 })
  document.cookie = 'csrftoken=test-token'
  mock.onGet('/invoices/summary/').reply(200, {})
  mock.onGet('/invoices/presets/').reply(200, [])
})

afterEach(() => {
  mock.restore()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC'
})

describe('Invoices — loading state no longer unmounts an already-rendered list', () => {
  it('a genuine first load shows the skeleton, then the real list', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture()], total: 1 })
    renderInvoices()
    // Skeleton uses the shared skeleton-pulse animation style — presence
    // of that inline style is this app's own established skeleton marker.
    expect(document.querySelector('[style*="skeleton-pulse"]')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
  })

  it('switching SORT (a real server round-trip) after a list is showing keeps that list mounted — no skeleton flash', async () => {
    mock.onGet('/invoices/').reply((config) => {
      if (config.params?.sort === 'due_date') {
        // A real, if small, async gap — a synchronous mock response
        // resolves before this test could ever observe the "old data
        // still showing mid-flight" state at all.
        return new Promise((resolve) => setTimeout(() => resolve([200, {
          results: [invoiceFixture({ id: 'sorted-1', invoice_number: 'INV-2026-0002' })], total: 1,
        }]), 50))
      }
      return [200, { results: [invoiceFixture()], total: 1 }]
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'due_date' } })
    // Immediately after the change — well before the mocked 50ms response
    // resolves — the OLD list must still be in the DOM, not replaced by a
    // skeleton.
    expect(screen.getByText('INV-2026-0001')).toBeTruthy()

    await waitFor(() => expect(screen.getByText('INV-2026-0002')).toBeTruthy())
  })
})

// REVERSAL (item 4 of the 16 August 2026 second verification pass — see
// DECISIONS.md for the full reasoning): "All" stays a client-side window
// over the loaded page, but a specific status filter or Overdue is now a
// REAL, independently-paginated server query (?status=X or
// ?overdue=true) — safe now that the reload-feel fix's actual root cause
// (the loading skeleton unmounting the whole grid on every refetch) is
// fixed on its own terms, so a real network call per filter click no
// longer feels like a reload. This supersedes the old "client-side,
// zero network calls" suite this replaces.
describe('Invoices — status/Overdue filtering is a real, independently-paginated server query', () => {
  it('clicking a status pill fires a real GET with the right ?status= param', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'd1', invoice_number: 'ALL-1' })], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('ALL-1')).toBeTruthy())

    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'd2', invoice_number: 'DRAFT-1', status: 'draft' })], total: 1 })
    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))

    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())
    const draftReq = mock.history.get.filter((r) => r.url === '/invoices/').pop()
    expect(draftReq.params.status).toBe('draft')
    expect(draftReq.params.offset).toBe(0)
    expect(draftReq.params.limit).toBe(10)
  })

  it('the results shown are exactly what the server returned for that filter — not a client-side re-filter of the previous "All" window', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' }), invoiceFixture({ id: 's1', invoice_number: 'SENT-1', status: 'sent' })],
      total: 2,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())
    expect(screen.getByText('SENT-1')).toBeTruthy()

    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' })], total: 1 })
    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))

    await waitFor(() => expect(screen.queryByText('SENT-1')).toBeNull())
    expect(screen.getByText('DRAFT-1')).toBeTruthy()
  })

  it('the Overdue toggle fires a real GET with ?overdue=true', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'a1', invoice_number: 'ALL-1' })], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('ALL-1')).toBeTruthy())

    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'o1', invoice_number: 'OVERDUE-1', days_overdue: 3 })], total: 1 })
    fireEvent.click(screen.getByRole('button', { name: /overdue only/i }))

    await waitFor(() => expect(screen.getByText('OVERDUE-1')).toBeTruthy())
    const overdueReq = mock.history.get.filter((r) => r.url === '/invoices/').pop()
    expect(overdueReq.params.overdue).toBe('true')
    expect(overdueReq.params.status).toBeUndefined()
  })

  it('switching back to "All" fires a real GET with no status/overdue params at all', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' })], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))
    await waitFor(() => expect(mock.history.get.filter((r) => r.url === '/invoices/').pop().params.status).toBe('draft'))

    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'a1', invoice_number: 'ALL-1' })], total: 1 })
    fireEvent.click(screen.getByRole('button', { name: /^all$/i }))

    await waitFor(() => expect(screen.getByText('ALL-1')).toBeTruthy())
    const allReq = mock.history.get.filter((r) => r.url === '/invoices/').pop()
    expect(allReq.params.status).toBeUndefined()
    expect(allReq.params.overdue).toBeUndefined()
  })

  it('a status pill click keeps the previous list visible (dimmed), not blanked — the reload-feel fix applies identically here', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'a1', invoice_number: 'ALL-1' })], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('ALL-1')).toBeTruthy())

    mock.onGet('/invoices/').reply(() => new Promise((resolve) => setTimeout(() => resolve([200, {
      results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' })], total: 1,
    }]), 50)))
    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))

    // Still mounted (not unmounted-and-rebuilt) while the request is in flight.
    expect(screen.getByText('ALL-1')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())
  })
})

describe('Invoices — search sends the exact typed value, not a stale closure', () => {
  it('rapid sequential typing results in the LAST typed value being sent, not an earlier one', async () => {
    mock.onGet('/invoices/').reply(200, { results: [], total: 0 })
    renderInvoices()
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/invoices/')).toBe(true))

    const input = screen.getByPlaceholderText(/search by invoice number/i)
    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.change(input, { target: { value: 'ac' } })
    fireEvent.change(input, { target: { value: 'acm' } })
    fireEvent.change(input, { target: { value: 'acme' } })

    await waitFor(() => {
      const searchCalls = mock.history.get.filter((r) => r.url === '/invoices/' && r.params?.search)
      expect(searchCalls.length).toBeGreaterThan(0)
    }, { timeout: 1000 })

    const searchCalls = mock.history.get.filter((r) => r.url === '/invoices/' && r.params?.search)
    // Only one debounced call should have fired (300ms debounce, all 4
    // keystrokes well within that window) — and it must carry the real,
    // final typed text, not whatever `search` state happened to be
    // captured by the timer's own stale closure.
    expect(searchCalls.length).toBe(1)
    expect(searchCalls[0].params.search).toBe('acme')
  })
})

describe('Invoices — stale (out-of-order) SORT responses never overwrite newer state', () => {
  it('a slow earlier sort request completing after a fast later one does not clobber the later result', async () => {
    mock.onGet('/invoices/').reply((config) => {
      if (config.params?.sort === 'total') {
        // Slow: resolves well after the 'due_date' request below.
        return new Promise((resolve) => setTimeout(() => resolve([200, {
          results: [invoiceFixture({ id: 'stale-1', invoice_number: 'STALE-TOTAL' })], total: 1,
        }]), 150))
      }
      if (config.params?.sort === 'due_date') {
        // Fast: resolves before the 'total' request above, despite being
        // requested SECOND — this is exactly the out-of-order scenario.
        return new Promise((resolve) => setTimeout(() => resolve([200, {
          results: [invoiceFixture({ id: 'current-1', invoice_number: 'CURRENT-DUEDATE' })], total: 1,
        }]), 10))
      }
      return [200, { results: [], total: 0 }]
    })
    renderInvoices()
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/invoices/')).toBe(true))

    const sortSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(sortSelect, { target: { value: 'total' } })
    await new Promise((r) => setTimeout(r, 30)) // let the slow 'total' request start in flight
    fireEvent.change(sortSelect, { target: { value: 'due_date' } })

    // Wait long enough for BOTH the fast 'due_date' response (10ms) AND the
    // slow, now-stale 'total' response (150ms) to have resolved.
    await new Promise((r) => setTimeout(r, 250))

    expect(screen.queryByText('CURRENT-DUEDATE')).toBeTruthy()
    expect(screen.queryByText('STALE-TOTAL')).toBeNull()
  })
})

describe('Invoices — status filter and Overdue are mutually exclusive (client-side state)', () => {
  it('selecting a status pill clears an active Overdue toggle', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [invoiceFixture({ id: 's1', invoice_number: 'SENT-1', status: 'sent', days_overdue: 2 })],
      total: 1,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('SENT-1')).toBeTruthy())

    const overdueBtn = screen.getByRole('button', { name: /overdue only/i })
    fireEvent.click(overdueBtn)
    expect(overdueBtn.style.fontWeight).toBe('700') // active styling

    fireEvent.click(screen.getByRole('button', { name: /^sent$/i }))
    expect(overdueBtn.style.fontWeight).toBe('500') // no longer active
  })

  it('toggling Overdue clears an active status pill', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [invoiceFixture({ id: 'p1', invoice_number: 'PAID-1', status: 'paid', days_overdue: 2 })],
      total: 1,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('PAID-1')).toBeTruthy())

    const paidBtn = screen.getByRole('button', { name: /^paid$/i })
    fireEvent.click(paidBtn)
    expect(paidBtn.style.fontWeight).toBe('700')

    fireEvent.click(screen.getByRole('button', { name: /overdue only/i }))
    expect(paidBtn.style.fontWeight).toBe('500')
  })
})

describe('Invoices — mobile filter dropdown (.filter-row-mobile, shown ≤768px via CSS)', () => {
  // jsdom doesn't apply CSS media queries, so the mobile row's elements
  // exist in the DOM regardless of viewport — the same elements a real
  // browser shows/hides via the `@media (max-width: 768px)` rule at the
  // bottom of Invoices.jsx. This suite tests the dropdown's own behavior
  // directly, not the CSS visibility switch itself (verified separately
  // via real browser screenshots at 375/768/1280/1920px).
  it('offers every status option plus Overdue Only, folded into one select', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture()], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    const mobileSelect = document.querySelector('.filter-row-mobile select')
    const optionLabels = Array.from(mobileSelect.options).map((o) => o.textContent)
    expect(optionLabels).toContain('All')
    expect(optionLabels).toContain('Draft')
    expect(optionLabels).toContain('Finalised')
    expect(optionLabels).toContain('Overdue Only')
  })

  it('selecting a status via the mobile dropdown fires a real, independently-paginated server query (item 4)', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 's1', invoice_number: 'SENT-1', status: 'sent' })], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('SENT-1')).toBeTruthy())

    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' })], total: 1 })
    const mobileSelect = document.querySelector('.filter-row-mobile select')
    fireEvent.change(mobileSelect, { target: { value: 'draft' } })

    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())
    expect(screen.queryByText('SENT-1')).toBeNull()
    const draftReq = mock.history.get.filter((r) => r.url === '/invoices/').pop()
    expect(draftReq.params.status).toBe('draft')
  })

  it('selecting "Overdue Only" via the mobile dropdown maps to the sentinel value and fires ?overdue=true', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'n1', invoice_number: 'CURRENT-1', days_overdue: 0 })], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('CURRENT-1')).toBeTruthy())

    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'o1', invoice_number: 'OVERDUE-1', days_overdue: 4 })], total: 1 })
    const mobileSelect = document.querySelector('.filter-row-mobile select')
    fireEvent.change(mobileSelect, { target: { value: '__overdue__' } })

    await waitFor(() => expect(screen.getByText('OVERDUE-1')).toBeTruthy())
    expect(screen.queryByText('CURRENT-1')).toBeNull()
    expect(mobileSelect.value).toBe('__overdue__')
    const overdueReq = mock.history.get.filter((r) => r.url === '/invoices/').pop()
    expect(overdueReq.params.overdue).toBe('true')
  })

  it('mobile and desktop controls stay in sync — a desktop pill click updates the mobile dropdown value too', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ status: 'paid' })], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^paid$/i }))
    const mobileSelect = document.querySelector('.filter-row-mobile select')
    expect(mobileSelect.value).toBe('paid')
  })
})

describe('Invoices — client filter dropdown removed', () => {
  it('no "All Clients" select exists anywhere on the page', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture()], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.queryByText('All Clients')).toBeNull()
  })
})

// REMOVED (item 4 of the 16 August 2026 second verification pass): the
// old "not all loaded" disclosure banner this suite tested no longer
// exists — a status/Overdue filter is a real, independently-paginated
// server query now, with its own real, complete `total`, so there's no
// under-reporting risk left to disclose. See DECISIONS.md.
describe('Invoices — a status filter shows genuinely complete results, not a stale disclosure banner', () => {
  it('no "most recently loaded" text renders anywhere once a filter is applied', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' })],
      total: 50,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))
    await waitFor(() => expect(mock.history.get.filter((r) => r.url === '/invoices/').pop().params.status).toBe('draft'))
    expect(screen.queryByText(/most recently loaded/i)).toBeNull()
    // The real total for THIS filter, from PaginationControls' own wording.
    expect(screen.getByText(/1 of 50/i)).toBeTruthy()
  })
})

// Item 5 of the verification pass: 10 most recent by default, Show More
// to 20 (client-side append), real server-paged navigation beyond that,
// Show fewer collapses back to 10.
describe('Invoices — tiered pagination', () => {
  function makeInvoices(count, prefix = 'INV') {
    return Array.from({ length: count }, (_, i) => invoiceFixture({ id: `${prefix}-${i}`, invoice_number: `${prefix}-${i}` }))
  }

  it('requests exactly 10 on the initial load', async () => {
    mock.onGet('/invoices/').reply(200, { results: makeInvoices(10), total: 10 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-0')).toBeTruthy())

    const req = mock.history.get.find((r) => r.url === '/invoices/')
    expect(req.params.limit).toBe(10)
    expect(req.params.offset).toBe(0)
    expect(screen.queryByText(/show more/i)).toBeNull() // exactly 10 total — nothing more to show
  })

  it('Show More appends 10 more (up to 20), client-side — never a full reload', async () => {
    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(10), total: 35 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-0')).toBeTruthy())

    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(10, 'MORE'), total: 35 })
    fireEvent.click(screen.getByRole('button', { name: /show more/i }))

    await waitFor(() => expect(screen.getByText('MORE-0')).toBeTruthy())
    expect(screen.getByText('INV-0')).toBeTruthy() // the original 10 are still there — appended, not replaced
    const secondReq = mock.history.get.filter((r) => r.url === '/invoices/')[1]
    expect(secondReq.params.limit).toBe(10)
    expect(secondReq.params.offset).toBe(10)
  })

  it('switches to real page controls once 20 are loaded and more exist beyond that', async () => {
    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(10), total: 35 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-0')).toBeTruthy())

    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(10, 'MORE'), total: 35 })
    fireEvent.click(screen.getByRole('button', { name: /show more/i }))
    await waitFor(() => expect(screen.getByText('MORE-0')).toBeTruthy())

    expect(screen.getByText(/page 1 of 2 \(35 total\)/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull()
  })

  it('Next fetches a real, fresh page — REPLACING the loaded set, not appending', async () => {
    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(20), total: 45 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-0')).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/page 1 of 3/i)).toBeTruthy())

    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(20, 'PAGE2'), total: 45 })
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByText('PAGE2-0')).toBeTruthy())
    expect(screen.queryByText('INV-0')).toBeNull() // replaced, not appended
    const pageReq = mock.history.get.filter((r) => r.url === '/invoices/')[1]
    expect(pageReq.params.limit).toBe(20)
    expect(pageReq.params.offset).toBe(20)
    expect(screen.getByText(/page 2 of 3/i)).toBeTruthy()
  })

  it('Show fewer collapses back to a fresh 10, from paged mode', async () => {
    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(20), total: 45 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText(/page 1 of 3/i)).toBeTruthy())

    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(20, 'PAGE2'), total: 45 })
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByText('PAGE2-0')).toBeTruthy())

    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(10, 'FRESH'), total: 45 })
    fireEvent.click(screen.getByRole('button', { name: /show fewer/i }))

    await waitFor(() => expect(screen.getByText('FRESH-0')).toBeTruthy())
    expect(screen.queryByText('PAGE2-0')).toBeNull()
    const collapseReq = mock.history.get.filter((r) => r.url === '/invoices/').pop()
    expect(collapseReq.params.limit).toBe(10)
    expect(collapseReq.params.offset).toBe(0)
    expect(screen.queryByRole('button', { name: /show fewer/i })).toBeNull() // back to exactly 10 — nothing left to collapse
  })

  // REVERSAL (item 4 of the 16 August 2026 second verification pass):
  // a status pill click IS now expected to trigger a real network call —
  // see Invoices.jsx's own FILTER ARCHITECTURE header comment and
  // DECISIONS.md. This replaces the old "never triggers a network call"
  // assertion this same test name used to make.
  it('a status pill click resets to compact/page 1 and fires a real, correctly-paginated request', async () => {
    mock.onGet('/invoices/').reply(200, { results: makeInvoices(10), total: 10 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-0')).toBeTruthy())

    mock.onGet('/invoices/').reply(200, { results: makeInvoices(3, 'DRAFT'), total: 3 })
    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))

    await waitFor(() => expect(screen.getByText('DRAFT-0')).toBeTruthy())
    const draftReq = mock.history.get.filter((r) => r.url === '/invoices/').pop()
    expect(draftReq.params.status).toBe('draft')
    expect(draftReq.params.offset).toBe(0)
    expect(draftReq.params.limit).toBe(10)
  })
})

// Item 7 of the 16 August 2026 second verification pass — bulk select in
// the list, matching apps/invoices/views.py's own DELETE_ELIGIBLE_STATUSES
// rule exactly (draft/created only).
describe('Invoices — bulk delete (list view)', () => {
  it('only draft/created invoices get a selection checkbox at all — a sent/paid invoice gets none', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [
        invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' }),
        invoiceFixture({ id: 'p1', invoice_number: 'PAID-1', status: 'paid' }),
      ],
      total: 2,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())

    // Exactly one selectable checkbox — for the draft, never the paid one.
    expect(screen.getAllByRole('button', { name: /select invoice/i })).toHaveLength(1)
  })

  it('selecting an eligible invoice shows the bulk-action bar with a real count', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' })],
      total: 1,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())

    expect(screen.queryByText(/selected/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /select invoice/i }))
    expect(screen.getByText('1 selected')).toBeTruthy()
  })

  it('"Select all" only ever selects the currently-visible eligible invoices', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [
        invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' }),
        invoiceFixture({ id: 'd2', invoice_number: 'DRAFT-2', status: 'created' }),
        invoiceFixture({ id: 'p1', invoice_number: 'PAID-1', status: 'paid' }),
      ],
      total: 3,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /select invoice/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }))

    // 2 eligible invoices (draft + created) — never the paid one, even
    // though it's also on screen.
    expect(screen.getByText('2 selected')).toBeTruthy()
  })

  it('Delete selected confirms before acting, then calls DELETE for each selected invoice', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [
        invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' }),
        invoiceFixture({ id: 'd2', invoice_number: 'DRAFT-2', status: 'created' }),
      ],
      total: 2,
    })
    mock.onDelete(/\/invoices\/d1\//).reply(204)
    mock.onDelete(/\/invoices\/d2\//).reply(204)
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())

    // "Select all" only appears once at least one is already selected —
    // select the first checkbox individually first.
    fireEvent.click(screen.getAllByRole('button', { name: /select invoice/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }))
    expect(screen.getByText('2 selected')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }))
    // A real confirmation step — not an immediate delete on the first click.
    expect(mock.history.delete.length).toBe(0)
    expect(screen.getByText(/delete 2 invoices\?/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(mock.history.delete.length).toBe(2))
    expect(mock.history.delete.some((r) => r.url.includes('d1'))).toBe(true)
    expect(mock.history.delete.some((r) => r.url.includes('d2'))).toBe(true)
  })

  it('a filter/search change clears the current selection', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' })],
      total: 1,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /select invoice/i }))
    expect(screen.getByText('1 selected')).toBeTruthy()

    mock.onGet('/invoices/').reply(200, { results: [], total: 0 })
    fireEvent.click(screen.getByRole('button', { name: /^paid$/i }))

    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())
  })
})
