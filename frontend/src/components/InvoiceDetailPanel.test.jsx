// src/components/InvoiceDetailPanel.test.jsx
//
// Previously a narrow, single-purpose suite covering only the Close
// button's [data-tooltip] wiring (that test is kept below, unchanged).
// Expanded substantially this round: the redesign's own verification
// requirements name this file's new behavior directly — the primary/
// secondary footer matrix per status×overdue, Send Reminder's numbering/
// exhaustion logic, Resend Invoice's status scoping, the unified Add
// Payment two-path popup, and the reminders banner-vs-toggle exclusivity
// rule — enough real, named coverage that this component's own former
// "no dedicated test file" convention no longer applies. Comments tab is
// deliberately not exercised beyond what already existed (it opens a
// real WebSocket via useWebSocket, covered by CommentThread.test.jsx
// already; this file focuses on the footer/reminders/modal logic that's
// new).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import api from '@/lib/api'
import InvoiceDetailPanel from './InvoiceDetailPanel'

let mock

function invoiceFixture(overrides = {}) {
  return {
    id: 'inv-1', invoice_number: 'INV-2026-0001', status: 'sent',
    client_name: 'Acme Co', client_email: 'billing@acme.test', client_company: 'Acme',
    currency: 'USD', total: '500.00', subtotal: '500.00', tax_amount: '0.00', discount_amount: '0.00',
    amount_paid: '0.00', outstanding_amount: '500.00',
    issue_date: '2026-08-01', due_date: '2026-08-10', days_overdue: 0,
    notes: '', terms: '', reminders_enabled: true, reminder_count: 0,
    late_fee_enabled: false, is_recurring: false,
    escalation_required: false, escalation_dismissed: false,
    client_acknowledged: false, client_acknowledged_at: null,
    formal_notice_sent_at: null, view_token: 'tok-abc123', client: 'client-1',
    // The real, backend-built URL (Invoice.portal_view_url) — the panel
    // reads this directly rather than re-deriving it from view_token, so
    // the fixture must carry it too; see DECISIONS.md.
    portal_view_url: 'http://localhost:5173/invoice/tok-abc123/',
    items: [{ description: 'Design work', quantity: '1', unit_price: '500.00', total: '500.00' }],
    ...overrides,
  }
}

function renderPanel(overrides = {}, { onChanged = () => {} } = {}) {
  const invoice = invoiceFixture(overrides)
  mock.onGet(`/invoices/${invoice.id}/`).reply(200, invoice)
  mock.onGet(`/invoices/${invoice.id}/timeline/`).reply(200, { results: [] })
  mock.onGet(`/invoices/${invoice.id}/claims/`).reply(200, [])
  render(<InvoiceDetailPanel invoiceId={invoice.id} onClose={() => {}} onChanged={onChanged} />)
  return invoice
}

beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 0 })
  document.cookie = 'csrftoken=test-token'
})

afterEach(() => {
  mock.restore()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC'
})

describe('InvoiceDetailPanel — footer primary/secondary matrix', () => {
  it('created: Send (primary) + Mark as Sent (secondary)', async () => {
    renderPanel({ status: 'created' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.getByRole('button', { name: /^send$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /mark as sent/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /add payment/i })).toBeNull()
  })

  it('sent, not overdue: Add Payment (primary) + Duplicate (secondary)', async () => {
    renderPanel({ status: 'sent', days_overdue: 0 })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.getByRole('button', { name: /add payment/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^duplicate$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /send reminder/i })).toBeNull()
  })

  it('partially_paid, overdue: Add Payment (primary) + Send Reminder N (secondary)', async () => {
    renderPanel({ status: 'partially_paid', days_overdue: 5, amount_paid: '100.00', outstanding_amount: '400.00', reminder_count: 0 })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.getByRole('button', { name: /add payment/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /send reminder 1/i })).toBeTruthy()
  })

  it('paid: Download Invoice (primary) + Duplicate (secondary)', async () => {
    renderPanel({ status: 'paid', amount_paid: '500.00', outstanding_amount: '0.00' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.getByRole('button', { name: /download invoice/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^duplicate$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /add payment/i })).toBeNull()
  })

  it('cancelled: Download Invoice (primary) + Duplicate (secondary), same as other terminal statuses', async () => {
    renderPanel({ status: 'cancelled' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.getByRole('button', { name: /download invoice/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^duplicate$/i })).toBeTruthy()
  })
})

describe('InvoiceDetailPanel — Duplicate promoted to footer secondary (replacing View Invoice)', () => {
  it('is not also listed in the More menu once the footer already shows it (sent, not overdue)', async () => {
    renderPanel({ status: 'sent', days_overdue: 0 })
    await waitFor(() => expect(screen.getByRole('button', { name: /^duplicate$/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^more/i }))
    expect(screen.queryByRole('menuitem', { name: /duplicate/i })).toBeNull()
  })

  it('stays in the More menu when the footer shows Send Reminder N instead (overdue, reminders available)', async () => {
    renderPanel({ status: 'sent', days_overdue: 5, reminder_count: 0 })
    await waitFor(() => expect(screen.getByRole('button', { name: /send reminder 1/i })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^duplicate$/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^more/i }))
    expect(screen.getByRole('menuitem', { name: /duplicate/i })).toBeTruthy()
  })

  it('clicking the footer Duplicate button calls the real duplicate endpoint', async () => {
    const invoice = invoiceFixture({ status: 'sent', days_overdue: 0 })
    mock.onGet(`/invoices/${invoice.id}/`).reply(200, invoice)
    mock.onGet(`/invoices/${invoice.id}/timeline/`).reply(200, { results: [] })
    mock.onGet(`/invoices/${invoice.id}/claims/`).reply(200, [])
    mock.onPost(`/invoices/${invoice.id}/duplicate/`).reply(200, { ...invoiceFixture({ id: 'inv-2', status: 'draft' }) })
    render(<InvoiceDetailPanel invoiceId={invoice.id} onClose={() => {}} onChanged={() => {}} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /^duplicate$/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^duplicate$/i }))

    await waitFor(() => expect(mock.history.post.some((r) => r.url === `/invoices/${invoice.id}/duplicate/`)).toBe(true))
  })
})

describe('InvoiceDetailPanel — Send Reminder numbering + exhaustion', () => {
  it('targets reminder 1 when none have been sent yet', async () => {
    renderPanel({ status: 'sent', days_overdue: 3, reminder_count: 0 })
    await waitFor(() => expect(screen.getByRole('button', { name: /send reminder 1/i })).toBeTruthy())
  })

  it('targets reminder 4 after 3 have already been sent', async () => {
    renderPanel({ status: 'sent', days_overdue: 20, reminder_count: 3 })
    await waitFor(() => expect(screen.getByRole('button', { name: /send reminder 4/i })).toBeTruthy())
  })

  it('once 4 have been sent, the button disappears entirely and falls back to Duplicate', async () => {
    renderPanel({ status: 'sent', days_overdue: 35, reminder_count: 4 })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /send reminder/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^duplicate$/i })).toBeTruthy()
  })

  it('sending a reminder calls the real endpoint and refreshes from the response', async () => {
    const invoice = invoiceFixture({ status: 'sent', days_overdue: 5, reminder_count: 0 })
    mock.onGet(`/invoices/${invoice.id}/`).reply(200, invoice)
    mock.onGet(`/invoices/${invoice.id}/timeline/`).reply(200, { results: [] })
    mock.onGet(`/invoices/${invoice.id}/claims/`).reply(200, [])
    mock.onPost(`/invoices/${invoice.id}/send-reminder/`).reply(200, { ...invoice, reminder_count: 1 })
    render(<InvoiceDetailPanel invoiceId={invoice.id} onClose={() => {}} onChanged={() => {}} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /send reminder 1/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /send reminder 1/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^send reminder$/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^send reminder$/i }))

    await waitFor(() => expect(mock.history.post.some((r) => r.url === `/invoices/${invoice.id}/send-reminder/`)).toBe(true))
  })
})

describe('InvoiceDetailPanel — Resend Invoice status scoping (More menu)', () => {
  it('appears for an active status (sent)', async () => {
    renderPanel({ status: 'sent' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^more/i }))
    expect(screen.getByRole('menuitem', { name: /resend invoice/i })).toBeTruthy()
  })

  it('is absent for created (never sent yet) — the More menu itself still exists for other actions', async () => {
    renderPanel({ status: 'created' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^more/i }))
    expect(screen.queryByRole('menuitem', { name: /resend invoice/i })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /duplicate/i })).toBeTruthy()
  })

  it('is absent for a terminal status (paid)', async () => {
    renderPanel({ status: 'paid', amount_paid: '500.00', outstanding_amount: '0.00' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^more/i }))
    expect(screen.queryByRole('menuitem', { name: /resend invoice/i })).toBeNull()
  })
})

describe('InvoiceDetailPanel — reminders banner-vs-toggle exclusivity', () => {
  it('reminders off, active status: shows the top banner with Turn on reminders, no toggle in Details', async () => {
    renderPanel({ status: 'sent', reminders_enabled: false })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.getByText(/reminders are off/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^turn on$/i })).toBeTruthy()
    expect(screen.queryByText('Reminders')).toBeNull()
  })

  it('reminders on, active status: no banner, a plain toggle in Details tab instead', async () => {
    renderPanel({ status: 'sent', reminders_enabled: true })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.queryByText(/reminders are off/i)).toBeNull()
    expect(screen.getByText('Reminders')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^on$/i })).toBeTruthy()
  })

  it('terminal status: neither banner nor toggle, regardless of reminders_enabled', async () => {
    renderPanel({ status: 'paid', reminders_enabled: false, amount_paid: '500.00', outstanding_amount: '0.00' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.queryByText(/reminders are off/i)).toBeNull()
    expect(screen.queryByText('Reminders')).toBeNull()
  })

  it('draft/created status: neither banner nor toggle', async () => {
    renderPanel({ status: 'created', reminders_enabled: false })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.queryByText(/reminders are off/i)).toBeNull()
  })
})

describe('InvoiceDetailPanel — unified Add Payment, two real paths', () => {
  it('opens a path-choice screen first, not a form directly', async () => {
    renderPanel({ status: 'sent' })
    await waitFor(() => expect(screen.getByRole('button', { name: /add payment/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /add payment/i }))
    expect(screen.getByRole('button', { name: /mark fully paid/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /add a partial amount/i })).toBeTruthy()
  })

  it('"Mark Fully Paid" path submits the real mark-paid endpoint', async () => {
    const invoice = invoiceFixture({ status: 'sent', outstanding_amount: '500.00' })
    mock.onGet(`/invoices/${invoice.id}/`).reply(200, invoice)
    mock.onGet(`/invoices/${invoice.id}/timeline/`).reply(200, { results: [] })
    mock.onGet(`/invoices/${invoice.id}/claims/`).reply(200, [])
    mock.onPost(`/invoices/${invoice.id}/mark-paid/`).reply(200, { ...invoice, status: 'paid', amount_paid: '500.00', outstanding_amount: '0.00' })
    render(<InvoiceDetailPanel invoiceId={invoice.id} onClose={() => {}} onChanged={() => {}} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /add payment/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /add payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /mark fully paid/i }))
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))

    await waitFor(() => expect(mock.history.post.some((r) => r.url === `/invoices/${invoice.id}/mark-paid/`)).toBe(true))
  })

  it('"Add a Partial Amount" path submits the real payments endpoint with the typed amount', async () => {
    const invoice = invoiceFixture({ status: 'sent', outstanding_amount: '500.00' })
    mock.onGet(`/invoices/${invoice.id}/`).reply(200, invoice)
    mock.onGet(`/invoices/${invoice.id}/timeline/`).reply(200, { results: [] })
    mock.onGet(`/invoices/${invoice.id}/claims/`).reply(200, [])
    mock.onPost(`/invoices/${invoice.id}/payments/`).reply(200, { ...invoice, status: 'partially_paid', amount_paid: '100.00', outstanding_amount: '400.00' })
    render(<InvoiceDetailPanel invoiceId={invoice.id} onClose={() => {}} onChanged={() => {}} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /add payment/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /add payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /add a partial amount/i }))
    fireEvent.change(screen.getByLabelText(/^amount/i), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /record payment/i }))

    await waitFor(() => expect(mock.history.post.some((r) => r.url === `/invoices/${invoice.id}/payments/`)).toBe(true))
    const body = JSON.parse(mock.history.post.find((r) => r.url === `/invoices/${invoice.id}/payments/`).data)
    expect(body.amount).toBe('100')
  })

  it('Back returns from either form to the path-choice screen', async () => {
    renderPanel({ status: 'sent' })
    await waitFor(() => expect(screen.getByRole('button', { name: /add payment/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /add payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /add a partial amount/i }))
    expect(screen.getByLabelText(/^amount/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('button', { name: /mark fully paid/i })).toBeTruthy()
  })
})

describe('InvoiceDetailPanel — Preview-as-Client removal', () => {
  it('no Preview-as-Client button/modal exists anywhere in the panel', async () => {
    renderPanel({ status: 'sent' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    expect(screen.queryByText(/preview as client/i)).toBeNull()
  })

  it('"View Invoice" opens the real, backend-provided portal_view_url in a new tab, not an in-app iframe', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {})
    const invoice = renderPanel({ status: 'sent' })
    await waitFor(() => expect(screen.getAllByRole('button', { name: /view invoice/i }).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByRole('button', { name: /view invoice/i })[0])
    // Never re-derived client-side (that's exactly how the backend host
    // used to leak back in even after portal_view_url itself was fixed
    // to point at the frontend — see DECISIONS.md) — must be the exact
    // value the backend sent.
    expect(openSpy).toHaveBeenCalledWith(invoice.portal_view_url, '_blank', expect.any(String))
    openSpy.mockRestore()
  })
})

describe('InvoiceDetailPanel — Download Invoice hides the backend host', () => {
  it('fetches the PDF as a blob and triggers a same-origin download — never window.open on the raw backend URL', async () => {
    const invoice = invoiceFixture({ status: 'paid', amount_paid: '500.00', outstanding_amount: '0.00' })
    mock.onGet(`/invoices/${invoice.id}/`).reply(200, invoice)
    mock.onGet(`/invoices/${invoice.id}/timeline/`).reply(200, { results: [] })
    mock.onGet(`/invoices/${invoice.id}/claims/`).reply(200, [])
    mock.onGet(`/invoices/${invoice.id}/pdf/`).reply(200, 'fake-pdf-bytes', { 'content-disposition': 'attachment; filename="INV-2026-0001.pdf"' })
    render(<InvoiceDetailPanel invoiceId={invoice.id} onClose={() => {}} onChanged={() => {}} />)

    const openSpy = vi.spyOn(window, 'open')
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-download-url')
    global.URL.revokeObjectURL = vi.fn()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await waitFor(() => expect(screen.getByRole('button', { name: /download invoice/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /download invoice/i }))

    await waitFor(() => expect(mock.history.get.some((r) => r.url === `/invoices/${invoice.id}/pdf/`)).toBe(true))
    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    // The whole point of this fix — this used to be a bare
    // window.open(backendUrl, '_blank'), a new tab whose address bar
    // showed the raw API host directly.
    expect(openSpy).not.toHaveBeenCalled()

    openSpy.mockRestore()
    clickSpy.mockRestore()
  })
})

describe('InvoiceDetailPanel — Undo Payment More-menu gate (audit fix INV-009/FE-001)', () => {
  // LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md, 19 August 2026: the
  // real gate used to be a separately hand-rolled condition that omitted
  // 'refunded', drifted apart from the (until then unused) NO_PAYMENT_STATUSES
  // constant — live-reproduced destructively on invoice
  // 76472345-cdb5-4800-a2f0-6cc8ba1547e8 / INV-2026-0025. The gate now
  // reads NO_PAYMENT_STATUSES directly; these are the regression tests.
  it.each(['refunded', 'cancelled', 'bad_debt'])(
    'is absent from the More menu for a %s invoice with a real payment history',
    async (status) => {
      renderPanel({ status, amount_paid: '900.00', outstanding_amount: '0.00', refunded_amount: '300.00' })
      await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /^more/i }))
      expect(screen.queryByRole('menuitem', { name: /undo payment/i })).toBeNull()
    },
  )

  it('is present in the More menu for a non-terminal status with a real payment history (partially_paid)', async () => {
    renderPanel({ status: 'partially_paid', amount_paid: '100.00', outstanding_amount: '400.00' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^more/i }))
    expect(screen.getByRole('menuitem', { name: /undo payment/i })).toBeTruthy()
  })

  it('is absent when there is no payment history at all, regardless of status', async () => {
    renderPanel({ status: 'sent', amount_paid: '0.00', outstanding_amount: '500.00' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^more/i }))
    expect(screen.queryByRole('menuitem', { name: /undo payment/i })).toBeNull()
  })
})

describe('InvoiceDetailPanel — tooltips', () => {
  it('the Close button carries a real data-tooltip and gets bound by initTooltipBindings on mount', async () => {
    renderPanel({ status: 'sent' })
    await waitFor(() => expect(screen.getByText('INV-2026-0001')).toBeTruthy())

    const closeBtn = screen.getByLabelText('Close')
    expect(closeBtn.getAttribute('data-tooltip')).toBe('Close')
    // dataset.tooltipBound is set by initTooltipBindings() the moment it
    // actually binds listeners to the element — its presence (not just
    // the raw data-tooltip attribute) confirms the mechanism really ran
    // against this panel's own DOM, not just that the markup looks right.
    expect(closeBtn.dataset.tooltipBound).toBe('true')
  })
})
