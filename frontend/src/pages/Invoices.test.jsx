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

describe('Invoices — status/Overdue filtering is client-side: zero network calls', () => {
  it('clicking every status pill and the Overdue toggle fires NO /invoices/ GET requests', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [
        invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' }),
        invoiceFixture({ id: 's1', invoice_number: 'SENT-1', status: 'sent', days_overdue: 5 }),
      ],
      total: 2,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())

    const getCallsBefore = mock.history.get.filter((r) => r.url === '/invoices/').length
    for (const name of [/^draft$/i, /^sent$/i, /^paid$/i, /overdue only/i, /^all$/i]) {
      fireEvent.click(screen.getByRole('button', { name }))
    }
    await new Promise((r) => setTimeout(r, 50))
    const getCallsAfter = mock.history.get.filter((r) => r.url === '/invoices/').length
    expect(getCallsAfter).toBe(getCallsBefore)
  })

  it('a status pill click immediately re-filters the already-loaded list with no loading flicker', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [
        invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' }),
        invoiceFixture({ id: 's1', invoice_number: 'SENT-1', status: 'sent' }),
      ],
      total: 2,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())
    expect(screen.getByText('SENT-1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))
    // No await needed at all — this is a synchronous state update, not a
    // network round-trip, so the filtered result is immediate.
    expect(screen.getByText('DRAFT-1')).toBeTruthy()
    expect(screen.queryByText('SENT-1')).toBeNull()
  })

  it('the Overdue toggle filters by days_overdue > 0 with no network call', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [
        invoiceFixture({ id: 'o1', invoice_number: 'OVERDUE-1', days_overdue: 3 }),
        invoiceFixture({ id: 'n1', invoice_number: 'NOTOVERDUE-1', days_overdue: 0 }),
      ],
      total: 2,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('OVERDUE-1')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /overdue only/i }))
    expect(screen.getByText('OVERDUE-1')).toBeTruthy()
    expect(screen.queryByText('NOTOVERDUE-1')).toBeNull()
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

  it('selecting a status via the mobile dropdown filters client-side with no network call', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [
        invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' }),
        invoiceFixture({ id: 's1', invoice_number: 'SENT-1', status: 'sent' }),
      ],
      total: 2,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())

    const getCallsBefore = mock.history.get.filter((r) => r.url === '/invoices/').length
    const mobileSelect = document.querySelector('.filter-row-mobile select')
    fireEvent.change(mobileSelect, { target: { value: 'draft' } })

    expect(screen.getByText('DRAFT-1')).toBeTruthy()
    expect(screen.queryByText('SENT-1')).toBeNull()
    expect(mock.history.get.filter((r) => r.url === '/invoices/').length).toBe(getCallsBefore)
  })

  it('selecting "Overdue Only" via the mobile dropdown maps to the sentinel value and filters correctly', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [
        invoiceFixture({ id: 'o1', invoice_number: 'OVERDUE-1', days_overdue: 4 }),
        invoiceFixture({ id: 'n1', invoice_number: 'CURRENT-1', days_overdue: 0 }),
      ],
      total: 2,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('OVERDUE-1')).toBeTruthy())

    const mobileSelect = document.querySelector('.filter-row-mobile select')
    fireEvent.change(mobileSelect, { target: { value: '__overdue__' } })

    expect(screen.getByText('OVERDUE-1')).toBeTruthy()
    expect(screen.queryByText('CURRENT-1')).toBeNull()
    expect(mobileSelect.value).toBe('__overdue__')
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

describe('Invoices — honest "not all loaded" notice when filtering an incomplete fetch', () => {
  it('shows a note when a status filter is active and more invoices exist on the server than are loaded', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' })],
      total: 50, // far more than the 1 loaded
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))
    expect(screen.getByText(/searching the 1 most recently loaded invoices/i)).toBeTruthy()
  })

  it('shows no such note when everything has already been loaded', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' })],
      total: 1,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('DRAFT-1')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))
    expect(screen.queryByText(/most recently loaded/i)).toBeNull()
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

  it('a status pill click never triggers a network call, at any pagination depth', async () => {
    mock.onGet('/invoices/').reply(200, { results: makeInvoices(10), total: 10 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-0')).toBeTruthy())

    const countBefore = mock.history.get.length
    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))
    await new Promise((r) => setTimeout(r, 0))
    expect(mock.history.get.length).toBe(countBefore) // pure client-side filter, no request at all
  })
})
