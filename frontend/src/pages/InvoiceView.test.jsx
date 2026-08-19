// src/pages/InvoiceView.test.jsx
//
// /invoice/:token — the real frontend-domain invoice view page (see
// DECISIONS.md's frozen-PDF-vs-live-render entry). REWORKED this pass:
// this page no longer fetches/renders live HTML at all — it fetches the
// ACTUAL FROZEN PDF as a blob and displays it via the browser's own
// native PDF viewer (a same-origin blob: URL, never a visible link/src
// pointing at the backend host), shows a real "not ready yet" state on
// a 503 (the real, specific response portal_invoice_view_html now
// returns when nothing's frozen — never a live-render fallback), and a
// real error state for anything else (unknown token, total failure).
// Download is a real <button> (not a plain <a href>) that fetches the
// PDF as a blob and triggers a programmatic, same-origin download.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import InvoiceView from './InvoiceView'

let mock

beforeEach(() => {
  mock = new MockAdapter(api)
  // jsdom's own createObjectURL/revokeObjectURL support is unreliable
  // across versions — stubbed explicitly so every test here is
  // deterministic regardless of the actual test environment's Blob
  // support, matching this suite's own job (proving InvoiceView.jsx's
  // OWN logic, not the browser's).
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock-url'), revokeObjectURL: vi.fn() })
})
afterEach(() => {
  mock.restore()
  vi.unstubAllGlobals()
})

function renderAt(token) {
  return render(
    <MemoryRouter initialEntries={[`/invoice/${token}`]}>
      <Routes>
        <Route path="/invoice/:token" element={<InvoiceView />} />
      </Routes>
    </MemoryRouter>,
  )
}

const FAKE_PDF_BLOB = new Blob(['%PDF-fake'], { type: 'application/pdf' })

describe('InvoiceView — shows the actual frozen PDF, never a live re-render', () => {
  it('fetches the real portal-view endpoint as a blob for the URL token', async () => {
    mock.onGet('/invoices/portal/view/tok-abc123/').reply(200, FAKE_PDF_BLOB)
    renderAt('tok-abc123')
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/invoices/portal/view/tok-abc123/')).toBe(true))
    expect(mock.history.get[0].responseType).toBe('blob')
  })

  it('renders the fetched PDF inside an iframe via a same-origin object URL, filling the page', async () => {
    mock.onGet('/invoices/portal/view/tok-abc123/').reply(200, FAKE_PDF_BLOB)
    const { container } = renderAt('tok-abc123')
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy())

    const iframe = container.querySelector('iframe')
    expect(iframe.getAttribute('src')).toBe('blob:mock-url') // never the backend host
  })

  it('carries no sandbox attribute — a real, confirmed bug this pass: sandbox="" made Chrome refuse to render the PDF at all ("this page has been blocked")', async () => {
    mock.onGet('/invoices/portal/view/tok-abc123/').reply(200, FAKE_PDF_BLOB)
    const { container } = renderAt('tok-abc123')
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy())

    // A PDF blob we built ourselves from our own backend's response has
    // no arbitrary-script-execution risk to sandbox against in the first
    // place (unlike the OLD srcDoc-HTML approach) — Chrome's own native
    // PDF viewer needs script execution for its internal toolbar/zoom/
    // search UI, and a sandboxed iframe blocks that outright.
    expect(container.querySelector('iframe').hasAttribute('sandbox')).toBe(false)
  })
})

describe('InvoiceView — tab title shows the real invoice number', () => {
  it('reads the invoice number from the view response\'s own Content-Disposition and sets it as the tab title', async () => {
    mock.onGet('/invoices/portal/view/tok-abc123/').reply(200, FAKE_PDF_BLOB, {
      'content-disposition': 'inline; filename="INV-2026-0007.pdf"',
    })
    renderAt('tok-abc123')
    await waitFor(() => expect(document.title).toBe('INV-2026-0007 — LanceraOS'))
  })

  it('shows the generic placeholder title while still loading, and again on error', async () => {
    document.title = 'unrelated'
    mock.onGet('/invoices/portal/view/tok-err/').reply(404)
    renderAt('tok-err')
    expect(document.title).toBe('Invoice — LanceraOS')
    await waitFor(() => expect(screen.getByText(/invalid or no longer available/i)).toBeTruthy())
    expect(document.title).toBe('Invoice — LanceraOS')
  })

  it('falls back to the generic title rather than showing the backend\'s own literal "invoice" placeholder filename', async () => {
    mock.onGet('/invoices/portal/view/tok-no-number/').reply(200, FAKE_PDF_BLOB, {
      'content-disposition': 'inline; filename="invoice.pdf"',
    })
    const { container } = renderAt('tok-no-number')
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy())
    // No real invoice number was ever provided, so the title never
    // updates away from the placeholder — 'invoice' is the backend's own
    // fallback string, not a real INV-YYYY-NNNN value worth showing.
    expect(document.title).toBe('Invoice — LanceraOS')
  })
})

describe('InvoiceView — "not ready yet" (503) vs a genuinely invalid link (404/other)', () => {
  it('shows a real "not ready yet" message on a 503 — never falls back to rendering something else', async () => {
    mock.onGet('/invoices/portal/view/tok-notready/').reply(503, { error: "This invoice isn't ready to view yet." })
    renderAt('tok-notready')
    await waitFor(() => expect(screen.getByText(/isn't ready to view yet/i)).toBeTruthy())
    expect(screen.queryByTitle('Invoice')).toBeNull() // no iframe at all
  })

  it('shows a real "invalid or no longer available" error for an unknown token (404)', async () => {
    mock.onGet('/invoices/portal/view/bad-token/').reply(404)
    renderAt('bad-token')
    await waitFor(() => expect(screen.getByText(/invalid or no longer available/i)).toBeTruthy())
  })

  it('the 503 and 404 states are visibly distinct messages, not the same generic fallback', async () => {
    mock.onGet('/invoices/portal/view/tok-a/').reply(503)
    const { unmount } = renderAt('tok-a')
    await waitFor(() => expect(screen.getByText(/isn't ready to view yet/i)).toBeTruthy())
    unmount()

    mock.onGet('/invoices/portal/view/tok-b/').reply(500)
    renderAt('tok-b')
    await waitFor(() => expect(screen.getByText(/invalid or no longer available/i)).toBeTruthy())
  })
})

describe('InvoiceView — Download, hides the backend host', () => {
  it('fetches the real public per-token PDF endpoint as a blob and triggers a same-origin download, never a visible backend link', async () => {
    mock.onGet('/invoices/portal/view/tok-abc123/').reply(200, FAKE_PDF_BLOB)
    mock.onGet('/invoices/portal/view/tok-abc123/pdf/').reply(200, FAKE_PDF_BLOB, { 'content-disposition': 'attachment; filename="INV-2026-0001.pdf"' })
    renderAt('tok-abc123')

    const downloadBtn = await screen.findByRole('button', { name: /download/i })
    // A real <button>, not an <a href> a client could hover/right-click
    // to see the backend host — the whole point of this round's fix.
    expect(downloadBtn.tagName).toBe('BUTTON')

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(downloadBtn)

    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/invoices/portal/view/tok-abc123/pdf/')).toBe(true))
    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    clickSpy.mockRestore()
  })
})
