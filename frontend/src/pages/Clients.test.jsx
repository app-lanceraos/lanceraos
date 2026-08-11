// src/pages/Clients.test.jsx
//
// Targeted coverage for this pass's mobile filter dropdown — Clients.jsx's
// FILTER_PILLS collapse into a single <select> (`.filter-row-mobile`) on
// screens ≤768px, alongside the same Sort dropdown, matching Invoices.jsx's
// identical treatment. See that file's own test suite for the deeper
// client-side-vs-server-side filtering architecture investigation — unlike
// Invoices.jsx's status pills, Clients.jsx's filter pills stay server-side
// here (v1-reference's own Clients.jsx also re-fetches on every filter
// pill click, so there's no "v1 never did this" case to port — see
// DECISIONS.md). This suite only covers the mobile dropdown's own
// behavior, not a filtering-architecture change.
//
// No @testing-library/jest-dom in this project's devDependencies — plain
// vitest `expect` + raw DOM properties, same convention as this repo's
// other test files.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 0 })
  document.cookie = 'csrftoken=test-token'
})

afterEach(() => {
  mock.restore()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC'
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
