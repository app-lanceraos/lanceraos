// src/components/NewInvoiceWizard.test.jsx
//
// Covers the delayed-record-creation rework end to end at the component
// level: closing before the threshold leaves no backend row, crossing it
// creates exactly one, Back/Forward preserves in-memory state, a backend
// validation error routes back to the stage that actually owns the failing
// field, and Finalise/Mark-as-Sent stay disabled with incomplete data at
// every stage — the exact scenarios called out as needing dedicated,
// automated coverage (verified manually via Playwright first, captured
// here so they don't silently regress).
//
// No @testing-library/jest-dom in this project's devDependencies — plain
// vitest `expect` + raw DOM properties (.disabled, .value) throughout,
// same convention as this repo's other test files.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import NewInvoiceWizard from './NewInvoiceWizard'

let mock

beforeEach(() => {
  mock = new MockAdapter(api)
  // Short-circuits api.js's ensureCsrfCookie() so PUT/POST requests never
  // fire a real csrf-priming GET through the (unmocked) bare `axios`.
  document.cookie = 'csrftoken=test-token'
})

afterEach(() => {
  mock.restore()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC'
})

// FormField renders required labels as "<label>{label}<span>*</span></label>",
// so the accessible name includes a trailing "*" for every required field
// (Client Name, Client Email, Description) — match with a prefix regex.
function fillOneTimeClient(name = 'Wizard Test Client', email = 'wizardtest@example.com') {
  fireEvent.change(screen.getByLabelText(/^client name/i), { target: { value: name } })
  fireEvent.change(screen.getByLabelText(/^client email/i), { target: { value: email } })
}

describe('NewInvoiceWizard — delayed record creation threshold', () => {
  it('closing before the threshold is crossed creates no backend row', () => {
    const onClose = vi.fn()
    render(<NewInvoiceWizard clients={[]} onClose={onClose} onFinalised={vi.fn()} />)

    expect(screen.getByText(/not saved yet/i)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Close'))

    expect(mock.history.post.length).toBe(0)
    expect(onClose).toHaveBeenCalledWith(null)
  })

  it('clicking Next without a client is blocked and still creates nothing', () => {
    render(<NewInvoiceWizard clients={[]} onClose={vi.fn()} onFinalised={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    expect(screen.getByText(/enter a client/i)).toBeTruthy()
    expect(mock.history.post.length).toBe(0)
    // Still on stage 1 — Client Name field is stage-1-only content.
    expect(screen.getByLabelText(/^client name/i)).toBeTruthy()
  })

  it('crossing the threshold fires exactly one POST and moves to stage 2', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-1' })
    render(<NewInvoiceWizard clients={[]} onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillOneTimeClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    expect(mock.history.post.length).toBe(1)
    expect(mock.history.post[0].url).toBe('/invoices/')
    expect(screen.getByText(/draft saved/i)).toBeTruthy()

    // Reopening stage 1 (Back) and returning to stage 2 (Next) must not
    // create a second invoice — invoiceId already exists, so Next is pure
    // navigation from here on.
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    expect(mock.history.post.length).toBe(1)
  })
})

describe('NewInvoiceWizard — Back/Forward preserves in-memory state', () => {
  it('preserves both client and item fields across Back then Next', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-2' })
    mock.onPut(/\/invoices\/inv-2\//).reply(200, { id: 'inv-2' })
    render(<NewInvoiceWizard clients={[]} onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillOneTimeClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())

    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Wizard test work' } })

    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByLabelText(/^client name/i).value).toBe('Wizard Test Client')

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    expect(screen.getByLabelText(/^description/i).value).toBe('Wizard test work')
  })
})

describe('NewInvoiceWizard — backend validation errors route to the owning stage', () => {
  async function getToStage3WithValidData() {
    mock.onPost('/invoices/').reply(201, { id: 'inv-3' })
    mock.onPut(/\/invoices\/inv-3\//).reply(200, { id: 'inv-3' })
    render(<NewInvoiceWizard clients={[]} onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillOneTimeClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())

    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Some work' } })
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^finalise$/i })).toBeTruthy())
  }

  it('a client-field error on finalise routes back to stage 1', async () => {
    await getToStage3WithValidData()
    mock.onPost('/invoices/inv-3/finalise/').reply(400, { client_email: ['Enter a valid email address.'] })

    fireEvent.click(screen.getByRole('button', { name: /^finalise$/i }))

    await waitFor(() => expect(screen.getByLabelText(/^client name/i)).toBeTruthy())
    expect(screen.queryByLabelText(/^description/i)).toBeNull()
  })

  it('an item-field error on finalise routes back to stage 2', async () => {
    await getToStage3WithValidData()
    mock.onPost('/invoices/inv-3/finalise/').reply(400, { item_0_unit_price: ['Must be a positive number.'] })

    fireEvent.click(screen.getByRole('button', { name: /^finalise$/i }))

    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    expect(screen.queryByLabelText(/^client name/i)).toBeNull()
  })
})

describe('NewInvoiceWizard — Finalise/Mark as Sent unreachable with incomplete data', () => {
  it('both actions are absent before stage 3 is reached', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-4' })
    render(<NewInvoiceWizard clients={[]} onClose={vi.fn()} onFinalised={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /^finalise$/i })).toBeNull()

    fillOneTimeClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^finalise$/i })).toBeNull()
  })

  it('at stage 3, both actions stay disabled while the only line item is still blank', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-5' })
    render(<NewInvoiceWizard clients={[]} onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillOneTimeClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    // Line item left blank on purpose — itemValid must stay false.
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /^finalise$/i })).toBeTruthy())
    expect(screen.getByRole('button', { name: /^finalise$/i }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /^mark as sent$/i }).disabled).toBe(true)
  })

  it('filling the line item enables both actions at stage 3', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-6' })
    render(<NewInvoiceWizard clients={[]} onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillOneTimeClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Real work' } })
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /^finalise$/i })).toBeTruthy())
    expect(screen.getByRole('button', { name: /^finalise$/i }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: /^mark as sent$/i }).disabled).toBe(false)
  })

  it('navigating back to stage 1 and away from a valid client re-disables both actions', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-7' })
    mock.onPut(/\/invoices\/inv-7\//).reply(200, { id: 'inv-7' })
    render(<NewInvoiceWizard clients={[]} onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillOneTimeClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Real work' } })
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^finalise$/i }).disabled).toBe(false))

    // Jump back to stage 1 and blank out the one-time client's email —
    // a user bouncing between stages must not be able to leave Finalise
    // enabled with an invalid client just because stage 3 was visited once.
    fireEvent.click(screen.getByRole('button', { name: /1\. client & dates/i }))
    fireEvent.change(screen.getByLabelText(/^client email/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /3\. options/i }))

    expect(screen.getByRole('button', { name: /^finalise$/i }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /^mark as sent$/i }).disabled).toBe(true)
  })
})
