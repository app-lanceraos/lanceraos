// src/pages/Invoices.test.jsx
//
// Targeted regression coverage for this pass's fixes to the "everything
// feels like a reload" bug — which was never a navigation/routing issue
// (four prior rounds chased it as one): load() unconditionally set
// loading=true on every filter/search/sort change, and the render logic
// unmounted the whole list whenever loading was true. See DECISIONS.md.
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

  it('switching filters after a real list is showing keeps that list mounted — no skeleton flash', async () => {
    mock.onGet('/invoices/').reply((config) => {
      if (config.params?.status === 'draft') {
        return [200, { results: [invoiceFixture({ id: 'draft-1', invoice_number: 'INV-2026-0002', status: 'draft' })], total: 1 }]
      }
      return [200, { results: [invoiceFixture()], total: 1 }]
    })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))
    // Immediately after the click — before the (synchronous, in this
    // mock) response even has a chance to resolve — the OLD list must
    // still be in the DOM, not replaced by a skeleton.
    expect(screen.getByText('INV-2026-0001')).toBeTruthy()

    await waitFor(() => expect(screen.getByText('INV-2026-0002')).toBeTruthy())
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

describe('Invoices — stale (out-of-order) responses never overwrite newer state', () => {
  it('a slow earlier request completing after a fast later one does not clobber the later result', async () => {
    mock.onGet('/invoices/').reply((config) => {
      if (config.params?.status === 'sent') {
        // Slow: resolves well after the 'draft' request below.
        return new Promise((resolve) => setTimeout(() => resolve([200, {
          results: [invoiceFixture({ id: 'sent-1', invoice_number: 'STALE-SENT', status: 'sent' })], total: 1,
        }]), 150))
      }
      if (config.params?.status === 'draft') {
        // Fast: resolves before the 'sent' request above, despite being
        // requested SECOND — this is exactly the out-of-order scenario.
        return new Promise((resolve) => setTimeout(() => resolve([200, {
          results: [invoiceFixture({ id: 'draft-1', invoice_number: 'CURRENT-DRAFT', status: 'draft' })], total: 1,
        }]), 10))
      }
      return [200, { results: [], total: 0 }]
    })
    renderInvoices()
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/invoices/')).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: /^sent$/i }))
    await new Promise((r) => setTimeout(r, 30)) // let the slow 'sent' request start in flight
    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }))

    // Wait long enough for BOTH the fast 'draft' response (10ms) AND the
    // slow, now-stale 'sent' response (150ms) to have resolved.
    await new Promise((r) => setTimeout(r, 250))

    expect(screen.queryByText('CURRENT-DRAFT')).toBeTruthy()
    expect(screen.queryByText('STALE-SENT')).toBeNull()
  })
})

describe('Invoices — status filter and Overdue are mutually exclusive', () => {
  it('selecting a status pill clears an active Overdue toggle', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture()], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    const overdueBtn = screen.getByRole('button', { name: /overdue only/i })
    fireEvent.click(overdueBtn)
    await waitFor(() => expect(mock.history.get.some((r) => r.params?.overdue === 'true')).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: /^sent$/i }))
    await waitFor(() => {
      const lastCall = mock.history.get.filter((r) => r.url === '/invoices/').slice(-1)[0]
      expect(lastCall.params?.status).toBe('sent')
      expect(lastCall.params?.overdue).toBeUndefined()
    })
  })

  it('toggling Overdue clears an active status pill', async () => {
    mock.onGet('/invoices/').reply(200, { results: [invoiceFixture()], total: 1 })
    renderInvoices()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^paid$/i }))
    await waitFor(() => expect(mock.history.get.some((r) => r.params?.status === 'paid')).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: /overdue only/i }))
    await waitFor(() => {
      const lastCall = mock.history.get.filter((r) => r.url === '/invoices/').slice(-1)[0]
      expect(lastCall.params?.overdue).toBe('true')
      expect(lastCall.params?.status).toBeUndefined()
    })
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
