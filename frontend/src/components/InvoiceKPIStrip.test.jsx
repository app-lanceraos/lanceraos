// src/components/InvoiceKPIStrip.test.jsx
//
// The 3 KPI cards' own period + currency controls (List/Table restructure
// pass) — scoped only to these cards, entirely independent of the
// invoice list's own filters (covered separately in Invoices.test.jsx).
// "Collected"/"Overdue" are the real, current display labels for what
// the backend still returns as total_paid/past_due (label-only rename —
// see DECISIONS.md); only Collected ever shows a delta, and only at
// period=this_month.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import InvoiceKPIStrip from './InvoiceKPIStrip'

let mock

function summaryFixture(overrides = {}) {
  return {
    currency: 'USD', period: 'this_month',
    outstanding: { count: 1, total: '100.00', unconverted_count: 0 },
    past_due: { count: 0, total: '0.00', unconverted_count: 0 },
    total_paid: {
      count: 2, total: '250.00', unconverted_count: 0,
      delta: { current: '250.00', previous: '100.00', amount_change: '150.00', pct_change: 150.0 },
    },
    ...overrides,
  }
}

beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 0 })
})

afterEach(() => {
  mock.restore()
})

describe('InvoiceKPIStrip — labels', () => {
  it('shows "Collected" and "Overdue" (not the old "Total Paid"/"Past-Due" labels)', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture())
    render(<InvoiceKPIStrip />)
    await waitFor(() => expect(screen.getAllByText('Collected').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0)
    expect(screen.queryByText('Total Paid')).toBeNull()
    expect(screen.queryByText('Past-Due')).toBeNull()
    expect(screen.getAllByText('Outstanding').length).toBeGreaterThan(0)
  })
})

describe('InvoiceKPIStrip — period control', () => {
  it('defaults to this_month on the initial fetch', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture())
    render(<InvoiceKPIStrip />)
    await waitFor(() => expect(mock.history.get.length).toBeGreaterThan(0))
    expect(mock.history.get[0].params.period).toBe('this_month')
  })

  it('changing the period re-fetches with the real, selected period param', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture())
    render(<InvoiceKPIStrip />)
    await waitFor(() => expect(screen.getAllByText('Collected').length).toBeGreaterThan(0))

    fireEvent.change(screen.getByLabelText('KPI period'), { target: { value: 'all_time' } })
    await waitFor(() => {
      const last = mock.history.get[mock.history.get.length - 1]
      expect(last.params.period).toBe('all_time')
    })
  })
})

describe('InvoiceKPIStrip — currency control', () => {
  it('changing the currency re-fetches with that currency, never mutating the account default silently', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture())
    render(<InvoiceKPIStrip />)
    await waitFor(() => expect(screen.getAllByText('Collected').length).toBeGreaterThan(0))

    fireEvent.change(screen.getByLabelText('KPI currency'), { target: { value: 'EUR' } })
    await waitFor(() => {
      const last = mock.history.get[mock.history.get.length - 1]
      expect(last.params.currency).toBe('EUR')
    })
  })
})

describe('InvoiceKPIStrip — Collected delta', () => {
  it('shows the delta at period=this_month (the default)', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture())
    render(<InvoiceKPIStrip />)
    // Rendered twice — once in the desktop grid, once in the mobile
    // swipe row (both always mounted, CSS toggles which is visible).
    await waitFor(() => expect(screen.getAllByText(/150\.0% vs last month/i).length).toBeGreaterThan(0))
  })

  it('hides the delta once period is no longer this_month', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture({ period: 'all_time' }))
    render(<InvoiceKPIStrip />)
    await waitFor(() => expect(screen.getAllByText('Collected').length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText('KPI period'), { target: { value: 'all_time' } })
    await waitFor(() => expect(screen.queryAllByText(/vs last month/i).length).toBe(0))
  })

  it('shows "New" instead of a percentage when there was no prior-month activity', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture({
      total_paid: { count: 1, total: '50.00', unconverted_count: 0, delta: { current: '50.00', previous: '0.00', amount_change: '50.00', pct_change: null } },
    }))
    render(<InvoiceKPIStrip />)
    await waitFor(() => expect(screen.getAllByText(/New vs last month/i).length).toBeGreaterThan(0))
  })
})
