// src/pages/InvoiceAnalytics.test.jsx
//
// Recharts' ResponsiveContainer needs real layout (ResizeObserver) that
// jsdom doesn't provide, so this doesn't assert on chart SVG internals —
// it verifies the real data flow (the right ?months= query, the top
// clients list, the currency breakdown's unified total) and the month-
// window toggle, matching this project's own established convention of
// testing behavior over implementation.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import InvoiceAnalytics from './InvoiceAnalytics'

let mock

beforeEach(() => { mock = new MockAdapter(api) })
afterEach(() => { mock.restore() })

function renderPage() {
  return render(<MemoryRouter><InvoiceAnalytics /></MemoryRouter>)
}

const SAMPLE_RESPONSE = {
  monthly_trend: [
    { month: '2026-06', invoiced: '1000.00', collected: '800.00' },
    { month: '2026-07', invoiced: '500.00', collected: '500.00' },
  ],
  top_clients: [
    { client_id: 'c-1', name: 'Big Client', total_paid_usd: '900.00', reliability_score: 85 },
    { client_id: 'c-2', name: 'Small Client', total_paid_usd: '100.00', reliability_score: null },
  ],
  currency_breakdown: {
    by_currency: { USD: { count: 2, total: '1500.00' }, PKR: { count: 1, total: '28000.00' } },
    unified_total_usd: '1600.80',
    unconverted_count: 0,
  },
}

describe('InvoiceAnalytics', () => {
  it('requests the default 6-month window and renders top clients + currency breakdown', async () => {
    mock.onGet(/\/invoices\/analytics\//).reply(200, SAMPLE_RESPONSE)
    renderPage()

    await waitFor(() => expect(screen.getByText('Big Client')).toBeTruthy())
    expect(screen.getByText('Small Client')).toBeTruthy()
    expect(screen.getByText(/85\/100/)).toBeTruthy()

    const req = mock.history.get.find((r) => r.url.includes('/invoices/analytics/'))
    expect(req.url).toContain('months=6')
  })

  it('shows the unified USD total and per-currency rows', async () => {
    mock.onGet(/\/invoices\/analytics\//).reply(200, SAMPLE_RESPONSE)
    renderPage()

    await waitFor(() => expect(screen.getByText(/USD 1,601/)).toBeTruthy())
    expect(screen.getByText('USD')).toBeTruthy()
    expect(screen.getByText('PKR')).toBeTruthy()
  })

  it('switching the month window re-fetches with the new value', async () => {
    mock.onGet(/\/invoices\/analytics\//).reply(200, SAMPLE_RESPONSE)
    renderPage()
    await waitFor(() => expect(screen.getByText('Big Client')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '12mo' }))
    await waitFor(() => expect(mock.history.get.some((r) => r.url.includes('months=12'))).toBe(true))
  })

  it('shows an empty state when there is no client revenue yet', async () => {
    mock.onGet(/\/invoices\/analytics\//).reply(200, {
      monthly_trend: [], top_clients: [],
      currency_breakdown: { by_currency: {}, unified_total_usd: '0.00', unconverted_count: 0 },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/no client revenue recorded yet/i)).toBeTruthy())
  })

  it('surfaces unconverted invoices honestly, not silently', async () => {
    mock.onGet(/\/invoices\/analytics\//).reply(200, {
      ...SAMPLE_RESPONSE,
      currency_breakdown: { ...SAMPLE_RESPONSE.currency_breakdown, unconverted_count: 2 },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/2 invoices excluded/i)).toBeTruthy())
  })

  it('shows a real error message on a failed load', async () => {
    mock.onGet(/\/invoices\/analytics\//).reply(500)
    renderPage()
    await waitFor(() => expect(screen.getByText(/failed to load analytics/i)).toBeTruthy())
  })
})
