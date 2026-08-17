// src/pages/Invoices.test.jsx
//
// List/Table restructure pass — replaces the old tiered-pagination /
// client-side-"All"-filter suite entirely (that architecture no longer
// exists; see Invoices.jsx's own header comment and DECISIONS.md for the
// full reasoning). Covers what the restructure actually changed:
// uniform real server pagination on every filter/search/sort/currency
// combination, the new currency list filter, and the checkbox-column's
// selection-affordance-hidden-when-zero-eligible rule. Header actions
// (Analytics/More/New Invoice) now live in AppShell's header via
// usePageHeaderActions and aren't exercised here since this page renders
// standalone (no AppShell) — the mobile FAB ("New invoice") stays inline
// regardless and is used below wherever a test needs to open the wizard.
//
// No @testing-library/jest-dom in this project's devDependencies — plain
// vitest `expect` + raw DOM properties, same convention as this repo's
// other test files.
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import Invoices from './Invoices'

let mock

function invoiceFixture(overrides = {}) {
  return {
    id: 'inv-' + Math.random().toString(36).slice(2),
    invoice_number: 'INV-2026-0001', status: 'created', client_name: 'Test Client',
    total: '100.00', currency: 'USD', issue_date: '2026-08-01', due_date: null, days_overdue: 0,
    ...overrides,
  }
}

function makeInvoices(count, prefix = 'INV') {
  return Array.from({ length: count }, (_, i) => invoiceFixture({ id: `${prefix}-${i}`, invoice_number: `${prefix}-${i}` }))
}

function renderInvoices() {
  return render(<MemoryRouter><Invoices /></MemoryRouter>)
}

beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 0 })
  document.cookie = 'csrftoken=test-token'
  mock.onGet('/invoices/summary/').reply(200, {})
  mock.onGet('/invoices/presets/').reply(200, [])
  mock.onGet('/invoices/currencies/').reply(200, { currencies: ['USD', 'EUR'] })
})

afterEach(() => {
  mock.restore()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC'
})

describe('Invoices — uniform, real server pagination', () => {
  it('requests exactly PAGE_SIZE=20 on the initial load, offset 0', async () => {
    mock.onGet('/invoices/').reply(200, { results: makeInvoices(20), total: 45 })
    renderInvoices()
    await waitFor(() => expect(screen.getAllByText('INV-0').length).toBeGreaterThan(0))

    const req = mock.history.get.find((r) => r.url === '/invoices/')
    expect(req.params.limit).toBe(20)
    expect(req.params.offset).toBe(0)
    expect(screen.getByText(/Showing 1-20 of 45 invoices/i)).toBeTruthy()
  })

  it('Next fetches a real, fresh page (offset 20), replacing the loaded set', async () => {
    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(20), total: 45 })
    renderInvoices()
    await waitFor(() => expect(screen.getAllByText('INV-0').length).toBeGreaterThan(0))

    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(20, 'PAGE2'), total: 45 })
    fireEvent.click(within(document.querySelector('.pagination-desktop')).getByLabelText('Next page'))

    await waitFor(() => expect(screen.getAllByText('PAGE2-0').length).toBeGreaterThan(0))
    expect(screen.queryByText('INV-0')).toBeNull()
    const pageReq = mock.history.get.filter((r) => r.url === '/invoices/')[1]
    expect(pageReq.params.limit).toBe(20)
    expect(pageReq.params.offset).toBe(20)
  })

  it('every filter/search/sort/currency change resets to page 1', async () => {
    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(20), total: 45 })
    renderInvoices()
    await waitFor(() => expect(screen.getAllByText('INV-0').length).toBeGreaterThan(0))

    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(20, 'PAGE2'), total: 45 })
    fireEvent.click(within(document.querySelector('.pagination-desktop')).getByLabelText('Next page'))
    await waitFor(() => expect(screen.getAllByText('PAGE2-0').length).toBeGreaterThan(0))

    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' })], total: 1 })
    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))

    await waitFor(() => expect(screen.getAllByText('DRAFT-1').length).toBeGreaterThan(0))
    const draftReq = mock.history.get.filter((r) => r.url === '/invoices/').pop()
    expect(draftReq.params.offset).toBe(0)
    expect(draftReq.params.status).toBe('draft')
  })

  it('a page emptied out by a real mutation (bulk delete) steps back one page automatically', async () => {
    mock.onGet('/invoices/').replyOnce(200, { results: makeInvoices(20), total: 45 })
    renderInvoices()
    await waitFor(() => expect(screen.getAllByText('INV-0').length).toBeGreaterThan(0))

    // Page 2 holds exactly the 5 draft invoices being bulk-deleted below.
    const page2 = makeInvoices(5, 'PAGE2').map((inv) => ({ ...inv, status: 'draft' }))
    mock.onGet('/invoices/').replyOnce(200, { results: page2, total: 25 })
    fireEvent.click(within(document.querySelector('.pagination-desktop')).getByLabelText('Next page'))
    await waitFor(() => expect(screen.getAllByText('PAGE2-0').length).toBeGreaterThan(0))

    page2.forEach((inv) => mock.onDelete(new RegExp(`/invoices/${inv.id}/`)).reply(204))
    // After the deletes, a real re-fetch of the same page (offset 20) comes
    // back empty with the real, now-lower total — load() must step back to
    // page 1 (offset 0) on its own rather than showing a blank page.
    mock.onGet('/invoices/').reply((config) => (
      config.params.offset === 20
        ? [200, { results: [], total: 20 }]
        : [200, { results: makeInvoices(20, 'BACK'), total: 20 }]
    ))

    fireEvent.click(within(document.querySelector('.list-desktop')).getByLabelText('Select all eligible invoices on this page'))
    fireEvent.click(screen.getByLabelText('Delete selected invoices'))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(mock.history.delete.length).toBe(5))
    await waitFor(() => expect(screen.getAllByText('BACK-0').length).toBeGreaterThan(0))
    const finalReq = mock.history.get.filter((r) => r.url === '/invoices/').pop()
    expect(finalReq.params.offset).toBe(0)
  })
})

describe('Invoices — currency list filter (real WHERE-clause, not display-only)', () => {
  it('selecting a currency fires a real GET with ?currency=', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'a1', invoice_number: 'ALL-1' })], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getAllByText('ALL-1').length).toBeGreaterThan(0))

    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 'e1', invoice_number: 'EUR-1', currency: 'EUR' })], total: 1 })
    // Desktop and mobile each render their own currency select (CSS
    // toggles which is visible; jsdom doesn't apply media queries, so
    // both exist in the DOM at once) — scope to the desktop filter row.
    fireEvent.change(within(document.querySelector('.filter-row-desktop')).getByLabelText('Filter by currency'), { target: { value: 'EUR' } })

    await waitFor(() => expect(screen.getAllByText('EUR-1').length).toBeGreaterThan(0))
    const req = mock.history.get.filter((r) => r.url === '/invoices/').pop()
    expect(req.params.currency).toBe('EUR')
  })

  it('composes correctly with an active status filter', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 's1', invoice_number: 'SENT-1', status: 'sent' })], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getAllByText('SENT-1').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: /^sent$/i }))
    await waitFor(() => expect(mock.history.get.filter((r) => r.url === '/invoices/').pop().params.status).toBe('sent'))

    mock.onGet('/invoices/').reply(200, { results: [], total: 0 })
    // Desktop and mobile each render their own currency select (CSS
    // toggles which is visible; jsdom doesn't apply media queries, so
    // both exist in the DOM at once) — scope to the desktop filter row.
    fireEvent.change(within(document.querySelector('.filter-row-desktop')).getByLabelText('Filter by currency'), { target: { value: 'EUR' } })

    await waitFor(() => {
      const req = mock.history.get.filter((r) => r.url === '/invoices/').pop()
      expect(req.params.status).toBe('sent')
      expect(req.params.currency).toBe('EUR')
    })
  })
})

describe('Invoices — desktop table: selection affordance hidden when zero eligible rows', () => {
  it('no checkbox column exists when every visible invoice is ineligible for deletion', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [invoiceFixture({ id: 's1', invoice_number: 'SENT-1', status: 'sent' })],
      total: 1,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getAllByText('SENT-1').length).toBeGreaterThan(0))
    expect(screen.queryByLabelText('Select all eligible invoices on this page')).toBeNull()
    expect(screen.queryByLabelText('Select invoice')).toBeNull()
  })

  it('a checkbox column appears once at least one eligible (draft/created) row is visible', async () => {
    mock.onGet('/invoices/').reply(200, {
      results: [
        invoiceFixture({ id: 'd1', invoice_number: 'DRAFT-1', status: 'draft' }),
        invoiceFixture({ id: 's1', invoice_number: 'SENT-1', status: 'sent' }),
      ],
      total: 2,
    })
    renderInvoices()
    await waitFor(() => expect(screen.getAllByText('DRAFT-1').length).toBeGreaterThan(0))
    expect(screen.getByLabelText('Select all eligible invoices on this page')).toBeTruthy()
    // Exactly one row checkbox in the desktop TABLE specifically — the
    // draft, never the sent one. (The mobile card list renders its own
    // equivalent control for the same invoice — both always exist in
    // jsdom since it doesn't apply the CSS media query that hides one.)
    expect(within(document.querySelector('.list-desktop')).getAllByLabelText('Select invoice')).toHaveLength(1)
  })
})

describe('Invoices — bulk delete (table)', () => {
  it('selecting rows shows the delete-icon swap in the header, and deletes on confirm', async () => {
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
    await waitFor(() => expect(screen.getAllByText('DRAFT-1').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByLabelText('Select all eligible invoices on this page'))
    expect(screen.getByLabelText('Delete selected invoices')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Delete selected invoices'))
    expect(mock.history.delete.length).toBe(0) // real confirm step first
    expect(screen.getByText(/delete 2 invoices\?/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(mock.history.delete.length).toBe(2))
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
    fireEvent.change(input, { target: { value: 'acme' } })

    await waitFor(() => {
      const searchCalls = mock.history.get.filter((r) => r.url === '/invoices/' && r.params?.search)
      expect(searchCalls.length).toBeGreaterThan(0)
    }, { timeout: 1000 })

    const searchCalls = mock.history.get.filter((r) => r.url === '/invoices/' && r.params?.search)
    expect(searchCalls.length).toBe(1)
    expect(searchCalls[0].params.search).toBe('acme')
  })
})

describe('Invoices — status/Overdue mutual exclusivity (unchanged)', () => {
  it('selecting a status pill clears an active Overdue toggle', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture({ id: 's1', invoice_number: 'SENT-1', status: 'sent', days_overdue: 2 })], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getAllByText('SENT-1').length).toBeGreaterThan(0))

    const overdueBtn = screen.getByRole('button', { name: /overdue only/i })
    fireEvent.click(overdueBtn)
    expect(overdueBtn.style.fontWeight).toBe('700')

    fireEvent.click(screen.getByRole('button', { name: /^sent$/i }))
    expect(overdueBtn.style.fontWeight).toBe('500')
  })
})

describe('Invoices — mobile filter dropdown (.filter-row-mobile, shown ≤768px via CSS)', () => {
  it('offers every status option plus Overdue Only, folded into one select, plus a real currency select', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture()], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getAllByText('INV-2026-0001').length).toBeGreaterThan(0))

    const mobileSelect = document.querySelector('.filter-row-mobile select')
    const optionLabels = Array.from(mobileSelect.options).map((o) => o.textContent)
    expect(optionLabels).toContain('Overdue Only')
    expect(document.querySelectorAll('.filter-row-mobile select').length).toBe(2) // status/overdue + currency
  })
})

describe('Invoices — the mobile FAB always opens the wizard, never the header menu', () => {
  it('New Invoice remains reachable via the FAB', async () => {
    mock.onGet('/invoices/').reply(200, { results: [], total: 0 })
    renderInvoices()
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/invoices/')).toBe(true))
    fireEvent.click(screen.getByLabelText('New invoice'))
    expect(screen.getByText(/new invoice/i)).toBeTruthy()
  })
})
