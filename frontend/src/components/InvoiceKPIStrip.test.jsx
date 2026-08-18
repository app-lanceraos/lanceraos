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
    await waitFor(() => expect(screen.getByText(/150\.0% vs last month/i)).toBeTruthy())
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

// Real, reported bug this pass: the mobile layout used to require a
// horizontal swipe/scroll to see all 3 KPI cards. Fixed by removing the
// swipeable carousel entirely — there is now exactly one grid, always 3
// columns, with a CSS-toggled compact delta (icon + bare percentage, no
// "vs last month" text) below the phone breakpoint. jsdom doesn't apply
// media queries, so both the full and compact variants are always
// present in the DOM at once here — this suite checks their CONTENT is
// correct and that no carousel/scroll markup exists at all, not which
// one is visually shown at a given width (that's a CSS concern, verified
// separately via live screenshots).
describe('InvoiceKPIStrip — no horizontal scroll/carousel; compact delta variant', () => {
  it('renders exactly one grid with all 3 cards — no swipeable/scrollable row', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture())
    const { container } = render(<InvoiceKPIStrip />)
    await waitFor(() => expect(screen.getByText('Collected')).toBeTruthy())

    expect(container.querySelectorAll('.kpi-strip').length).toBe(1)
    expect(container.querySelector('.kpi-swipe-mobile')).toBeNull()
    expect(container.querySelector('[style*="overflow-x"]')).toBeNull()
  })

  it('always renders exactly 3 columns (Outstanding, Collected, Overdue) side by side', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture())
    const { container } = render(<InvoiceKPIStrip />)
    await waitFor(() => expect(screen.getByText('Collected')).toBeTruthy())

    const grid = container.querySelector('.kpi-strip')
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, 1fr)')
    expect(grid.querySelectorAll('.kpi-card').length).toBe(3)
  })

  it('the compact delta variant carries the arrow + bare percentage, with no "vs last month" text', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture())
    const { container } = render(<InvoiceKPIStrip />)
    await waitFor(() => expect(screen.getByText(/150\.0% vs last month/i)).toBeTruthy())

    const compact = container.querySelector('.kpi-delta-compact')
    expect(compact).toBeTruthy()
    expect(compact.textContent).toBe('150.0%')
    expect(compact.textContent).not.toMatch(/vs last month/i)
  })

  it('the compact variant shows "New" (not a percentage) when there was no prior-month activity', async () => {
    mock.onGet('/invoices/summary/').reply(200, summaryFixture({
      total_paid: { count: 1, total: '50.00', unconverted_count: 0, delta: { current: '50.00', previous: '0.00', amount_change: '50.00', pct_change: null } },
    }))
    const { container } = render(<InvoiceKPIStrip />)
    await waitFor(() => expect(screen.getByText(/New vs last month/i)).toBeTruthy())

    expect(container.querySelector('.kpi-delta-compact').textContent).toBe('New')
  })
})
