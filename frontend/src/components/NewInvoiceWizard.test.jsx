// src/components/NewInvoiceWizard.test.jsx
//
// Rewritten this pass alongside the wizard itself: the client step is now
// search-driven (no Existing/One-Time toggle), currency/tax/discount live
// in stage 2 with line items, Mark-as-Sent no longer exists here at all,
// and the wizard doubles as the edit surface for an already-existing draft
// via `editInvoiceId` — see DECISIONS.md. Covers: the delayed-record-
// creation threshold, Back/Forward state preservation, backend-validation-
// error stage-routing, Finalise gating with incomplete data at every stage,
// the client search-and-pick flow, the save-as-new-client toggle (success
// and duplicate-email rejection), and draft-loading mode landing on the
// right stage with real saved data.
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
  // The client search dropdown fires on every keystroke via a 300ms
  // debounce — default it to an empty result set so tests that don't care
  // about search don't need to handle a stray unmocked request.
  mock.onGet('/clients/').reply(200, { results: [] })
})

afterEach(() => {
  mock.restore()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC'
})

// FormField renders required labels as "<label>{label}<span>*</span></label>",
// so the accessible name includes a trailing "*" for every required field
// (Client Name, Client Email, Description) — match with a prefix regex.
function fillClient(name = 'Wizard Test Client', email = 'wizardtest@example.com') {
  fireEvent.change(screen.getByLabelText(/^client name/i), { target: { value: name } })
  fireEvent.change(screen.getByLabelText(/^client email/i), { target: { value: email } })
}

describe('NewInvoiceWizard — delayed record creation threshold', () => {
  it('closing before the threshold is crossed creates no backend row', () => {
    const onClose = vi.fn()
    render(<NewInvoiceWizard onClose={onClose} onFinalised={vi.fn()} />)

    expect(screen.getByText(/not saved yet/i)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Close'))

    expect(mock.history.post.length).toBe(0)
    expect(onClose).toHaveBeenCalledWith(null)
  })

  it('clicking Next without a client is blocked and still creates nothing', () => {
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    expect(screen.getByText(/enter a client/i)).toBeTruthy()
    expect(mock.history.post.filter((r) => r.url === '/invoices/').length).toBe(0)
    expect(screen.getByLabelText(/^client name/i)).toBeTruthy()
  })

  it('crossing the threshold fires exactly one POST and moves to stage 2', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-1' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    expect(mock.history.post.filter((r) => r.url === '/invoices/').length).toBe(1)
    expect(screen.getByText(/draft saved/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    expect(mock.history.post.filter((r) => r.url === '/invoices/').length).toBe(1)
  })
})

describe('NewInvoiceWizard — client search step', () => {
  it('a search hit fills every client field and links the record', async () => {
    mock.onGet('/clients/').reply((config) => {
      if (config.params?.search === 'Acme') {
        return [200, { results: [{ id: 'client-9', name: 'Acme Corp', email: 'acme@example.com', company: 'Acme Inc', default_currency: 'EUR' }] }]
      }
      return [200, { results: [] }]
    })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/^client name/i), { target: { value: 'Acme' } })
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeTruthy(), { timeout: 2000 })
    fireEvent.mouseDown(screen.getByText('Acme Corp'))

    await waitFor(() => expect(screen.getByLabelText(/^client email/i).value).toBe('acme@example.com'))
    expect(screen.getByText(/linked to a saved client/i)).toBeTruthy()
  })

  it('typed text that matches nothing is treated as one-time-client data as typed', () => {
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)
    fillClient('Nobody Saved', 'nobody@example.com')
    expect(screen.getByLabelText(/^client name/i).value).toBe('Nobody Saved')
    expect(screen.queryByText(/linked to a saved client/i)).toBeNull()
  })

  it('the save-as-new-client toggle defaults off', () => {
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)
    fillClient()
    const toggle = screen.getByLabelText(/save this as a new client/i)
    expect(toggle.checked).toBe(false)
  })

  it('toggling save-as-new-client on creates the client before the invoice', async () => {
    mock.onPost('/clients/').reply(201, { id: 'new-client-1' })
    mock.onPost('/invoices/').reply(201, { id: 'inv-save-client' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient('Brand New Co', 'brandnew@example.com')
    fireEvent.click(screen.getByLabelText(/save this as a new client/i))
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    expect(mock.history.post.filter((r) => r.url === '/clients/').length).toBe(1)
    const invoicePost = mock.history.post.find((r) => r.url === '/invoices/')
    expect(JSON.parse(invoicePost.data).client).toBe('new-client-1')
  })

  it('a duplicate-email save-as-new-client is rejected with a clear error and creates no invoice', async () => {
    mock.onPost('/clients/').reply(400, { email: ['A client with this email already exists — search for them instead of creating a duplicate.'] })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient('Duplicate Co', 'dupe@example.com')
    fireEvent.click(screen.getByLabelText(/save this as a new client/i))
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeTruthy())
    expect(mock.history.post.filter((r) => r.url === '/invoices/').length).toBe(0)
    // Still on stage 1.
    expect(screen.getByLabelText(/^client name/i)).toBeTruthy()
  })
})

describe('NewInvoiceWizard — Back/Forward preserves in-memory state', () => {
  it('preserves both client and item fields across Back then Next', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-2' })
    mock.onPut(/\/invoices\/inv-2\//).reply(200, { id: 'inv-2' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient()
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
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient()
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

  it('a currency/tax error on finalise routes back to stage 2 (moved there this pass)', async () => {
    await getToStage3WithValidData()
    mock.onPost('/invoices/inv-3/finalise/').reply(400, { tax_rate: ['Must be between 0 and 100.'] })

    fireEvent.click(screen.getByRole('button', { name: /^finalise$/i }))

    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
  })
})

describe('NewInvoiceWizard — Finalise unreachable with incomplete data; Mark-as-Sent absent entirely', () => {
  it('Finalise is absent before stage 3 is reached, and Mark as Sent never renders at any stage', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-4' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /^finalise$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /mark as sent/i })).toBeNull()

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^finalise$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /mark as sent/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^finalise$/i })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /mark as sent/i })).toBeNull()
  })

  it('at stage 3, Finalise stays disabled while the only line item is still blank', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-5' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /^finalise$/i })).toBeTruthy())
    expect(screen.getByRole('button', { name: /^finalise$/i }).disabled).toBe(true)
  })

  it('filling the line item enables Finalise at stage 3', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-6' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Real work' } })
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /^finalise$/i })).toBeTruthy())
    expect(screen.getByRole('button', { name: /^finalise$/i }).disabled).toBe(false)
  })

  it('navigating back to stage 1 and away from a valid client re-disables Finalise', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-7' })
    mock.onPut(/\/invoices\/inv-7\//).reply(200, { id: 'inv-7' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Real work' } })
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^finalise$/i }).disabled).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: /1\. client & dates/i }))
    fireEvent.change(screen.getByLabelText(/^client email/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /3\. options/i }))

    expect(screen.getByRole('button', { name: /^finalise$/i }).disabled).toBe(true)
  })

  it('Preview PDF is absent before stage 2 and enabled from stage 2 onward with a real item', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-8' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /preview pdf/i })).toBeNull()

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    expect(screen.getByRole('button', { name: /preview pdf/i }).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Real work' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /preview pdf/i }).disabled).toBe(false))
  })
})

describe('NewInvoiceWizard — Finalise & Send (combined action)', () => {
  async function reachStage3WithValidData(mock, invoiceId) {
    mock.onPost('/invoices/').reply(201, { id: invoiceId })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={onFinalisedSpy} />)

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Real work' } })
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /finalise & send/i })).toBeTruthy())
  }

  let onFinalisedSpy

  beforeEach(() => { onFinalisedSpy = vi.fn() })

  it('is disabled at stage 3 while the data is incomplete, same gating as standalone Finalise', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'fs-1' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /finalise & send/i })).toBeTruthy())
    expect(screen.getByRole('button', { name: /finalise & send/i }).disabled).toBe(true)
  })

  it('opens a confirm modal with the reminders toggle defaulted to the wizard\'s current value', async () => {
    await reachStage3WithValidData(mock, 'fs-2')
    fireEvent.click(screen.getByRole('button', { name: /finalise & send/i }))

    expect(screen.getByText(/this finalises the invoice/i)).toBeTruthy()
    const toggle = screen.getByText(/enable reminders/i).closest('label').querySelector('input[type="checkbox"]')
    expect(toggle.checked).toBe(true) // wizard's own default is ON
  })

  it('confirming calls finalise-and-send with confirm:true and hands off via onFinalised on success', async () => {
    mock.onPost('/invoices/fs-3/finalise-and-send/').reply(200, { id: 'fs-3', status: 'sent' })
    await reachStage3WithValidData(mock, 'fs-3')

    fireEvent.click(screen.getByRole('button', { name: /finalise & send/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /finalise & send/i })[1])

    await waitFor(() => expect(onFinalisedSpy).toHaveBeenCalled())
    const sendCalls = mock.history.post.filter((r) => r.url === '/invoices/fs-3/finalise-and-send/')
    expect(sendCalls.length).toBe(1)
    expect(JSON.parse(sendCalls[0].data)).toEqual({ confirm: true })
    expect(onFinalisedSpy).toHaveBeenCalledWith('fs-3', 'Invoice finalised and sent.')
  })

  it('unchecking reminders in the modal PUTs reminders_enabled:false before sending', async () => {
    mock.onPut(/\/invoices\/fs-4\//).reply(200, { id: 'fs-4' })
    mock.onPost('/invoices/fs-4/finalise-and-send/').reply(200, { id: 'fs-4', status: 'sent' })
    await reachStage3WithValidData(mock, 'fs-4')

    fireEvent.click(screen.getByRole('button', { name: /finalise & send/i }))
    const toggle = screen.getByText(/enable reminders/i).closest('label').querySelector('input[type="checkbox"]')
    fireEvent.click(toggle) // ON -> OFF
    fireEvent.click(screen.getAllByRole('button', { name: /finalise & send/i })[1])

    await waitFor(() => expect(onFinalisedSpy).toHaveBeenCalled())
    const puts = mock.history.put.filter((r) => r.url === '/invoices/fs-4/')
    expect(puts.some((r) => JSON.parse(r.data).reminders_enabled === false)).toBe(true)
  })

  it('on total failure where the invoice never left draft, stays in the wizard and shows the real backend error', async () => {
    mock.onPost('/invoices/fs-5/finalise-and-send/').reply(400, { error: 'Add at least one line item before finalising.' })
    await reachStage3WithValidData(mock, 'fs-5')

    fireEvent.click(screen.getByRole('button', { name: /finalise & send/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /finalise & send/i })[1])

    await waitFor(() => expect(screen.getByText(/add at least one line item before finalising/i)).toBeTruthy())
    expect(onFinalisedSpy).not.toHaveBeenCalled()
  })

  it('on a send-side failure AFTER finalise already committed, hands off with a warning — never a silent success', async () => {
    mock.onPost('/invoices/fs-6/finalise-and-send/').reply(502, {
      error: 'LanceraOS could not send this invoice: the email provider rejected the request. The invoice has not been sent — it is still Finalised, not Sent.',
    })
    mock.onGet('/invoices/fs-6/').reply(200, { id: 'fs-6', status: 'created' }) // the re-fetch this handler does on error
    await reachStage3WithValidData(mock, 'fs-6')

    fireEvent.click(screen.getByRole('button', { name: /finalise & send/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /finalise & send/i })[1])

    await waitFor(() => expect(onFinalisedSpy).toHaveBeenCalled())
    const [id, message] = onFinalisedSpy.mock.calls[0]
    expect(id).toBe('fs-6')
    expect(message.type).toBe('warning')
    expect(message.text).toMatch(/finalised, but sending failed/i)
    expect(message.text).toMatch(/has not been sent/i)
  })
})

describe('NewInvoiceWizard — reminders default: ON in the wizard, forced off at finalise (backend)', () => {
  // Reverted back to true this pass — a real, deliberate lifecycle rule,
  // not a single default flip: the wizard's own visible starting state
  // stays ON (what a user sees while creating), while invoice_finalise
  // (apps/invoices/views.py) unconditionally forces the STORED value to
  // False the moment an invoice actually leaves draft, regardless of what
  // was submitted here. That override is a backend-only concern with its
  // own dedicated backend tests (test_views.py's
  // test_finalise_forces_reminders_disabled_regardless_of_starting_value)
  // — this test only covers the wizard's own creation-time default.
  it('the created payload has reminders_enabled: true with no user interaction', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-9' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(mock.history.post.filter((r) => r.url === '/invoices/').length).toBe(1))

    const body = JSON.parse(mock.history.post.find((r) => r.url === '/invoices/').data)
    expect(body.reminders_enabled).toBe(true)
  })

  it('the reminders toggle is visibly checked by default on stage 3', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-9b' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Work' } })
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByText(/reminders enabled/i)).toBeTruthy())
    const toggle = screen.getByText(/reminders enabled/i).closest('label').querySelector('input[type="checkbox"]')
    expect(toggle.checked).toBe(true)
  })

  it('respects an explicit user choice to turn reminders off before crossing the threshold', async () => {
    mock.onPost('/invoices/').reply(201, { id: 'inv-9c' })
    mock.onPut(/\/invoices\/inv-9c\//).reply(200, { id: 'inv-9c' })
    mock.onPost('/invoices/inv-9c/finalise/').reply(200, { id: 'inv-9c' })
    render(<NewInvoiceWizard onClose={vi.fn()} onFinalised={vi.fn()} />)

    fillClient()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Work' } })
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByText(/reminders enabled/i)).toBeTruthy())

    const toggle = screen.getByText(/reminders enabled/i).closest('label').querySelector('input[type="checkbox"]')
    fireEvent.click(toggle) // explicit user choice: turn it off

    fireEvent.click(screen.getByRole('button', { name: /^finalise$/i }))
    await waitFor(() => expect(mock.history.post.some((r) => r.url === '/invoices/inv-9c/finalise/')).toBe(true))

    // The explicit off-choice must have been autosaved (flushPendingSave,
    // called before the finalise POST) — the most recent PUT to the
    // invoice must carry it.
    const puts = mock.history.put.filter((r) => r.url === '/invoices/inv-9c/')
    expect(puts.length).toBeGreaterThan(0)
    const lastPut = JSON.parse(puts[puts.length - 1].data)
    expect(lastPut.reminders_enabled).toBe(false)
  })
})

describe('NewInvoiceWizard — draft-loading (edit) mode', () => {
  it('loads an existing draft\'s real data and lands on stage 1 when the client is incomplete', async () => {
    mock.onGet('/invoices/edit-1/').reply(200, {
      id: 'edit-1', client: null, client_name: '', client_email: '', client_company: '', client_address: '', client_phone: '',
      currency: 'USD', tax_rate: '0', discount_amount: '0', due_date: '', notes: '', terms: '',
      reminders_enabled: false, late_fee_enabled: false, late_fee_rate: '2.00',
      is_recurring: false, recurring_interval_days: 30, recurring_auto_send: false, items: [],
    })
    render(<NewInvoiceWizard editInvoiceId="edit-1" onClose={vi.fn()} onFinalised={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/edit draft/i)).toBeTruthy())
    expect(screen.getByLabelText(/^client name/i)).toBeTruthy()
    expect(screen.getByText(/draft saved/i)).toBeTruthy()
  })

  it('lands on stage 2 when the client is already valid but items are not', async () => {
    mock.onGet('/invoices/edit-2/').reply(200, {
      id: 'edit-2', client: null, client_name: 'Existing Client', client_email: 'existing@example.com',
      client_company: '', client_address: '', client_phone: '',
      currency: 'USD', tax_rate: '0', discount_amount: '0', due_date: '', notes: '', terms: '',
      reminders_enabled: false, late_fee_enabled: false, late_fee_rate: '2.00',
      is_recurring: false, recurring_interval_days: 30, recurring_auto_send: false, items: [],
    })
    render(<NewInvoiceWizard editInvoiceId="edit-2" onClose={vi.fn()} onFinalised={vi.fn()} />)

    await waitFor(() => expect(screen.getByLabelText(/^description/i)).toBeTruthy())
  })

  it('lands on stage 1 as the default once client and items are both already valid', async () => {
    mock.onGet('/invoices/edit-3/').reply(200, {
      id: 'edit-3', client: null, client_name: 'Existing Client', client_email: 'existing@example.com',
      client_company: '', client_address: '', client_phone: '',
      currency: 'USD', tax_rate: '0', discount_amount: '0', due_date: '', notes: '', terms: '',
      reminders_enabled: false, late_fee_enabled: false, late_fee_rate: '2.00',
      is_recurring: false, recurring_interval_days: 30, recurring_auto_send: false,
      items: [{ description: 'Existing item', quantity: '1', unit_price: '50' }],
    })
    render(<NewInvoiceWizard editInvoiceId="edit-3" onClose={vi.fn()} onFinalised={vi.fn()} />)

    await waitFor(() => expect(screen.getByLabelText(/^client name/i)).toBeTruthy())
    expect(screen.getByLabelText(/^client name/i).value).toBe('Existing Client')
  })

  it('closing a loaded draft without finalising reports its id (not null) so the list refreshes', async () => {
    mock.onGet('/invoices/edit-4/').reply(200, {
      id: 'edit-4', client: null, client_name: 'X', client_email: 'x@example.com',
      client_company: '', client_address: '', client_phone: '',
      currency: 'USD', tax_rate: '0', discount_amount: '0', due_date: '', notes: '', terms: '',
      reminders_enabled: false, late_fee_enabled: false, late_fee_rate: '2.00',
      is_recurring: false, recurring_interval_days: 30, recurring_auto_send: false, items: [],
    })
    const onClose = vi.fn()
    render(<NewInvoiceWizard editInvoiceId="edit-4" onClose={onClose} onFinalised={vi.fn()} />)

    await waitFor(() => expect(screen.getByLabelText('Close')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Close'))
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('edit-4'))
  })
})
