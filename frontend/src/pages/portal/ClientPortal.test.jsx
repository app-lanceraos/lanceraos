// src/pages/portal/ClientPortal.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import ClientPortal from './ClientPortal'

let mock

beforeEach(() => { mock = new MockAdapter(api) })
afterEach(() => { mock.restore() })

function renderPortal() {
  return render(<MemoryRouter><ClientPortal /></MemoryRouter>)
}

const SAMPLE_INVOICES = [
  {
    id: 'inv-1', invoice_number: 'INV-2026-0001', status: 'sent', currency: 'USD',
    total: '500.00', amount_paid: '0.00', outstanding_amount: '500.00',
    issue_date: '2026-01-01', due_date: '2026-01-31', days_overdue: 0,
    portal_view_url: 'http://localhost:8000/api/invoices/portal/view/tok-1/',
  },
  {
    id: 'inv-2', invoice_number: 'INV-2026-0002', status: 'paid', currency: 'USD',
    total: '250.00', amount_paid: '250.00', outstanding_amount: '0.00',
    issue_date: '2025-12-01', due_date: '2025-12-15', days_overdue: 0,
    portal_view_url: 'http://localhost:8000/api/invoices/portal/view/tok-2/',
  },
]

describe('ClientPortal — list rendering', () => {
  it('shows a loading state, then the real invoice rows', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    renderPortal()

    expect(screen.getByText(/loading/i)).toBeTruthy()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.getByText('INV-2026-0002')).toBeTruthy()
  })

  it('renders each invoice as a real <a href> pointing at portal_view_url — not a client-side route/button', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    renderPortal()

    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    const link = screen.getByText('INV-2026-0001').closest('a')
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('http://localhost:8000/api/invoices/portal/view/tok-1/')
  })

  it('shows an empty state with zero invoices', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, [])
    renderPortal()
    await waitFor(() => expect(screen.getByText(/no invoices yet/i)).toBeTruthy())
  })

  it('shows the request-link form on a 401, not the freelancer login redirect', async () => {
    mock.onGet('/invoices/portal/me/').reply(401, { error: 'No active portal session.' })
    renderPortal()
    await waitFor(() => expect(screen.getByText(/your session has ended/i)).toBeTruthy())
    expect(screen.getByPlaceholderText(/you@example.com/i)).toBeTruthy()
  })

  it('shows a retry option on a genuine server error', async () => {
    mock.onGet('/invoices/portal/me/').reply(500)
    renderPortal()
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy())
  })
})

describe('ClientPortal — logout', () => {
  it('logout calls the single-session endpoint and returns to the request-link form', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    mock.onPost('/clients/portal/logout/').reply(200, { message: 'Logged out.' })
    renderPortal()

    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^log out$/i }))

    await waitFor(() => expect(mock.history.post.some((r) => r.url === '/clients/portal/logout/')).toBe(true))
    await waitFor(() => expect(screen.getByText(/your session has ended/i)).toBeTruthy())
  })

  it('logout everywhere calls the logout-everywhere endpoint', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    mock.onPost('/clients/portal/logout-everywhere/').reply(200, { message: 'Logged out on all devices.' })
    renderPortal()

    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /log out everywhere/i }))

    await waitFor(() => expect(mock.history.post.some((r) => r.url === '/clients/portal/logout-everywhere/')).toBe(true))
  })
})

describe('ClientPortal — payment claims', () => {
  // Item 5 of the 16 August 2026 second verification pass: the action is
  // now always shown (it doubles as "check your claim status" once
  // outstanding hits 0), not hidden once nothing's left to report.
  it('shows the payment-claims action on every invoice, including a fully-paid one', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    renderPortal()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    expect(screen.getAllByRole('button', { name: /payment claims/i })).toHaveLength(2)
  })

  it('submits a claim with the entered fields and shows a success state', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    mock.onGet('/invoices/portal/inv-1/claims/').reply(200, [])
    mock.onPost('/invoices/portal/inv-1/claims/').reply(201, {
      id: 'claim-1', status: 'pending', amount_claimed: '500.00', currency: 'USD',
    })
    renderPortal()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /payment claims/i })[0])
    await waitFor(() => expect(screen.getByText(/payment claims/i, { selector: 'h3' })).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/report a new payment/i)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(mock.history.post.some((r) => r.url === '/invoices/portal/inv-1/claims/')).toBe(true))
    const payload = JSON.parse(mock.history.post.find((r) => r.url === '/invoices/portal/inv-1/claims/').data)
    expect(payload.amount_claimed).toBe('500.00')
    expect(payload.currency).toBe('USD')

    await waitFor(() => expect(screen.getByText(/we've let them know/i)).toBeTruthy())
  })

  it('shows a real error message when the backend rejects the claim', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    mock.onGet('/invoices/portal/inv-1/claims/').reply(200, [])
    mock.onPost('/invoices/portal/inv-1/claims/').reply(429, { error: 'Too many claims submitted. Please try again later.' })
    renderPortal()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /payment claims/i })[0])
    await waitFor(() => expect(screen.getByText(/report a new payment/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(screen.getByText(/too many claims submitted/i)).toBeTruthy())
  })

  // ── Claim status visibility (item 5) ──

  it('shows real claim history with status and amount', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    mock.onGet('/invoices/portal/inv-1/claims/').reply(200, [
      { id: 'c1', status: 'confirmed', amount_claimed: '200.00', currency: 'USD', payment_source: 'wise', payment_date: '2026-01-10', review_note: '' },
    ])
    renderPortal()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /payment claims/i })[0])
    await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy())
    expect(screen.getByText(/via wise/i)).toBeTruthy()
  })

  it('shows the freelancer\'s rejection reason for a rejected claim', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    mock.onGet('/invoices/portal/inv-1/claims/').reply(200, [
      { id: 'c1', status: 'rejected', amount_claimed: '200.00', currency: 'USD', payment_source: 'wise', payment_date: '2026-01-10', review_note: 'Amount does not match our records.' },
    ])
    renderPortal()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /payment claims/i })[0])
    await waitFor(() => expect(screen.getByText('Rejected')).toBeTruthy())
    expect(screen.getByText(/amount does not match our records/i)).toBeTruthy()
  })

  it('a fully-paid invoice with no history shows no submission form, just a close action', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    mock.onGet('/invoices/portal/inv-2/claims/').reply(200, [])
    renderPortal()
    await waitFor(() => expect(screen.getByText('INV-2026-0002')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /payment claims/i })[1])
    await waitFor(() => expect(screen.getByText(/payment claims/i, { selector: 'h3' })).toBeTruthy())
    expect(screen.queryByText(/report a new payment/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^submit$/i })).toBeNull()
  })

  it('a fully-paid invoice with real claim history still shows it', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    mock.onGet('/invoices/portal/inv-2/claims/').reply(200, [
      { id: 'c1', status: 'confirmed', amount_claimed: '250.00', currency: 'USD', payment_source: 'bank', payment_date: '2025-12-10', review_note: '' },
    ])
    renderPortal()
    await waitFor(() => expect(screen.getByText('INV-2026-0002')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /payment claims/i })[1])
    await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy())
  })
})

describe('ClientPortal — acknowledgment', () => {
  it('hides the acknowledge action once already acknowledged, shows the permanent state instead', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, [
      { ...SAMPLE_INVOICES[0], client_acknowledged: true, client_acknowledged_at: '2026-01-05T00:00:00Z' },
      SAMPLE_INVOICES[1],
    ])
    renderPortal()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    expect(screen.getAllByRole('button', { name: /^acknowledge/i })).toHaveLength(1)  // only inv-2, not the already-acknowledged inv-1
    expect(screen.getByText(/acknowledged 1\/5\/2026/i)).toBeTruthy()
  })

  it('acknowledging updates the row to the permanent state without a page reload', async () => {
    mock.onGet('/invoices/portal/me/').reply(200, SAMPLE_INVOICES)
    mock.onPost('/invoices/portal/inv-1/acknowledge/').reply(201, {
      client_acknowledged: true, client_acknowledged_at: '2026-02-01T00:00:00Z',
    })
    renderPortal()
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /^acknowledge/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /i acknowledge this invoice/i }))

    await waitFor(() => expect(mock.history.post.some((r) => r.url === '/invoices/portal/inv-1/acknowledge/')).toBe(true))
    await waitFor(() => expect(screen.getByText(/acknowledged 2\/1\/2026/i)).toBeTruthy())
    // The button for inv-1 specifically is gone now — only inv-2's remains.
    expect(screen.getAllByRole('button', { name: /^acknowledge/i })).toHaveLength(1)
  })
})
