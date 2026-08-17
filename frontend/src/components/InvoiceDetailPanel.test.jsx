// src/components/InvoiceDetailPanel.test.jsx
//
// Bug-fix round: this panel's icon-only buttons (e.g. the Close X) never
// had [data-tooltip] wired at all — AppShell.jsx was the only place in
// this codebase that ever called useAppTooltip.js's initTooltipBindings(),
// so nothing outside its own sidebar/header ever got a hover tooltip.
// Deliberately a narrow, single-purpose suite (this component has no
// broader dedicated test file by established convention — see CLAUDE.md's
// own note on this — everything else about it is covered indirectly via
// Invoices.jsx and the helper-level invoiceHelpers.test.js).
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import InvoiceDetailPanel from './InvoiceDetailPanel'

let mock

beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 0 })
  mock.onGet(/\/invoices\/inv-1\/$/).reply(200, {
    id: 'inv-1', invoice_number: 'INV-2026-0001', status: 'sent', client_name: 'Acme',
    total: '100.00', currency: 'USD', amount_paid: '0.00', outstanding_amount: '100.00',
    days_overdue: 0, reminders_enabled: true, is_recurring: false, items: [],
  })
  mock.onGet(/\/invoices\/inv-1\/timeline\/$/).reply(200, { results: [] })
  mock.onGet(/\/invoices\/inv-1\/claims\/$/).reply(200, [])
})

afterEach(() => {
  mock.restore()
})

describe('InvoiceDetailPanel — tooltips', () => {
  it('the Close button carries a real data-tooltip and gets bound by initTooltipBindings on mount', async () => {
    render(<InvoiceDetailPanel invoiceId="inv-1" onClose={() => {}} />)
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
