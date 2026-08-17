// src/pages/Clients.test.jsx
//
// List/Table restructure pass — Clients.jsx keeps its existing card grid
// (no table conversion, no KPI cards, no bulk selection — see
// Clients.jsx's own header comment), but gains: uniform real server
// pagination (20/page, matching Invoices.jsx), a real currency list
// filter with the same measured-width overflow row, and Sort moved onto
// the search row. This suite covers what actually changed; the mobile
// filter dropdown's own pre-existing behavior (still real, still
// server-side) is retained from the prior round's suite.
//
// No @testing-library/jest-dom in this project's devDependencies — plain
// vitest `expect` + raw DOM properties, same convention as this repo's
// other test files.
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import Clients from './Clients'

let mock

function clientFixture(overrides = {}) {
  return {
    id: 'c-' + Math.random().toString(36).slice(2),
    name: 'Test Client', email: 'test@example.com', company: '', default_currency: 'USD',
    is_active: true, is_flagged: false, auto_flagged: false, tags: [],
    payment_stats: { total_invoiced: 0, invoice_count: 0, reliability_score: null },
    ...overrides,
  }
}

function makeClients(count, prefix = 'C') {
  return Array.from({ length: count }, (_, i) => clientFixture({ id: `${prefix}-${i}`, name: `${prefix}-${i}` }))
}

beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 0 })
  document.cookie = 'csrftoken=test-token'
  mock.onGet('/clients/currencies/').reply(200, { currencies: ['USD', 'EUR'] })
})

afterEach(() => {
  mock.restore()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC'
})

describe('Clients — uniform, real server pagination', () => {
  it('requests exactly 20 on the initial load, offset 0', async () => {
    mock.onGet('/clients/').reply(200, { results: makeClients(20), total: 45 })
    render(<Clients />)
    await waitFor(() => expect(screen.getByText('C-0')).toBeTruthy())

    const req = mock.history.get.find((r) => r.url === '/clients/')
    expect(req.params.limit).toBe(20)
    expect(req.params.offset).toBe(0)
    expect(screen.getByText(/Showing 1-20 of 45 clients/i)).toBeTruthy()
  })

  it('Next fetches a real, fresh page (offset 20), replacing the loaded set', async () => {
    mock.onGet('/clients/').replyOnce(200, { results: makeClients(20), total: 45 })
    render(<Clients />)
    await waitFor(() => expect(screen.getByText('C-0')).toBeTruthy())

    mock.onGet('/clients/').replyOnce(200, { results: makeClients(20, 'PAGE2'), total: 45 })
    fireEvent.click(within(document.querySelector('.pagination-desktop')).getByLabelText('Next page'))

    await waitFor(() => expect(screen.getByText('PAGE2-0')).toBeTruthy())
    expect(screen.queryByText('C-0')).toBeNull()
    const pageReq = mock.history.get.filter((r) => r.url === '/clients/')[1]
    expect(pageReq.params.limit).toBe(20)
    expect(pageReq.params.offset).toBe(20)
  })

  it('changing a filter pill resets to page 1', async () => {
    mock.onGet('/clients/').replyOnce(200, { results: makeClients(20), total: 45 })
    render(<Clients />)
    await waitFor(() => expect(screen.getByText('C-0')).toBeTruthy())

    mock.onGet('/clients/').replyOnce(200, { results: makeClients(20, 'PAGE2'), total: 45 })
    fireEvent.click(within(document.querySelector('.pagination-desktop')).getByLabelText('Next page'))
    await waitFor(() => expect(screen.getByText('PAGE2-0')).toBeTruthy())

    mock.onGet('/clients/').reply(200, { results: [clientFixture({ name: 'Flag-1' })], total: 1 })
    fireEvent.click(screen.getByRole('button', { name: /^flagged$/i }))

    await waitFor(() => expect(screen.getByText('Flag-1')).toBeTruthy())
    const req = mock.history.get.filter((r) => r.url === '/clients/').pop()
    expect(req.params.offset).toBe(0)
    expect(req.params.filter).toBe('flagged')
  })
})

describe('Clients — currency list filter (real WHERE-clause, not display-only)', () => {
  it('selecting a currency fires a real GET with ?currency=', async () => {
    mock.onGet('/clients/').reply(200, { results: [clientFixture({ name: 'Acme' })], total: 1 })
    render(<Clients />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())

    mock.onGet('/clients/').reply(200, { results: [clientFixture({ name: 'EuroCo', default_currency: 'EUR' })], total: 1 })
    fireEvent.change(within(document.querySelector('.filter-row-desktop')).getByLabelText('Filter by currency'), { target: { value: 'EUR' } })

    await waitFor(() => expect(screen.getByText('EuroCo')).toBeTruthy())
    const req = mock.history.get.filter((r) => r.url === '/clients/').pop()
    expect(req.params.currency).toBe('EUR')
  })

  it('composes correctly with an active filter pill', async () => {
    mock.onGet('/clients/').reply(200, { results: [clientFixture({ name: 'Acme' })], total: 1 })
    render(<Clients />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^flagged$/i }))
    await waitFor(() => expect(mock.history.get.filter((r) => r.url === '/clients/').pop().params.filter).toBe('flagged'))

    mock.onGet('/clients/').reply(200, { results: [], total: 0 })
    fireEvent.change(within(document.querySelector('.filter-row-desktop')).getByLabelText('Filter by currency'), { target: { value: 'EUR' } })

    await waitFor(() => {
      const req = mock.history.get.filter((r) => r.url === '/clients/').pop()
      expect(req.params.filter).toBe('flagged')
      expect(req.params.currency).toBe('EUR')
    })
  })
})

describe('Clients — mobile filter dropdown (.filter-row-mobile, shown ≤768px via CSS)', () => {
  it('offers every filter pill as a select option', async () => {
    mock.onGet('/clients/').reply(200, { results: [clientFixture({ name: 'Acme' })], total: 1 })
    render(<Clients />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())

    const mobileSelect = document.querySelector('.filter-row-mobile select')
    const optionLabels = Array.from(mobileSelect.options).map((o) => o.textContent)
    expect(optionLabels).toEqual(['Active', 'Flagged', 'Archived', 'Has Overdue', 'New This Month'])
  })

  it('changing the mobile dropdown re-fetches with the selected filter', async () => {
    mock.onGet('/clients/').reply((config) => {
      if (config.params?.filter === 'archived') {
        return [200, { results: [clientFixture({ name: 'Archived Co', is_active: false })], total: 1 }]
      }
      return [200, { results: [clientFixture({ name: 'Acme' })], total: 1 }]
    })
    render(<Clients />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())

    const mobileSelect = document.querySelector('.filter-row-mobile select')
    fireEvent.change(mobileSelect, { target: { value: 'archived' } })
    await waitFor(() => expect(screen.getByText('Archived Co')).toBeTruthy())
  })

  it('mobile and desktop controls stay in sync — a desktop pill click updates the mobile dropdown value too', async () => {
    mock.onGet('/clients/').reply(200, { results: [clientFixture({ name: 'Acme' })], total: 1 })
    render(<Clients />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^flagged$/i }))
    await waitFor(() => {
      const mobileSelect = document.querySelector('.filter-row-mobile select')
      expect(mobileSelect.value).toBe('flagged')
    })
  })

  it('also offers a currency select when the account has more than one currency in use', async () => {
    mock.onGet('/clients/').reply(200, { results: [clientFixture({ name: 'Acme' })], total: 1 })
    render(<Clients />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())
    expect(document.querySelectorAll('.filter-row-mobile select').length).toBe(2)
  })
})

describe('Clients — "All" filter pill removed', () => {
  it('no "All" pill exists on desktop or mobile', async () => {
    mock.onGet('/clients/').reply(200, { results: [clientFixture({ name: 'Acme' })], total: 1 })
    render(<Clients />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^all$/i })).toBeNull()
    const mobileSelect = document.querySelector('.filter-row-mobile select')
    expect(Array.from(mobileSelect.options).some((o) => o.value === 'all')).toBe(false)
  })
})

describe('Clients — header action relocated', () => {
  it('"Add Client" opens the create-client modal from wherever it is rendered', async () => {
    mock.onGet('/clients/').reply(200, { results: [], total: 0 })
    render(<Clients />)
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/clients/')).toBe(true))
    fireEvent.click(screen.getByLabelText('Add client')) // the mobile FAB — always present regardless of AppShell
    expect(screen.getByText('Add New Client')).toBeTruthy()
  })
})
