// src/pages/InvoiceView.test.jsx
//
// /invoice/:token — the real frontend-domain invoice view page (see
// DECISIONS.md). Covers: fetches the backend's rendered HTML as raw text
// (never JSON-parsed), injects a <base> tag pointing at the backend
// origin so relative /static/... URLs (the embedded @font-face files)
// resolve correctly inside the iframe's own srcDoc context, renders it
// in a fully sandboxed iframe, shows a real error state for an unknown
// token, and offers a real Download link pointing at the new public
// per-view_token PDF endpoint.
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import InvoiceView from './InvoiceView'

let mock

beforeEach(() => { mock = new MockAdapter(api) })
afterEach(() => { mock.restore() })

function renderAt(token) {
  return render(
    <MemoryRouter initialEntries={[`/invoice/${token}`]}>
      <Routes>
        <Route path="/invoice/:token" element={<InvoiceView />} />
      </Routes>
    </MemoryRouter>,
  )
}

const SAMPLE_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body><p>Invoice INV-2026-0001</p></body></html>'

describe('InvoiceView — fetches and displays the shared backend-rendered HTML', () => {
  it('fetches the real portal-view HTML endpoint for the URL token', async () => {
    mock.onGet('/invoices/portal/view/tok-abc123/').reply(200, SAMPLE_HTML)
    renderAt('tok-abc123')
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/invoices/portal/view/tok-abc123/')).toBe(true))
  })

  it('renders the fetched HTML inside a fully sandboxed iframe, filling the page', async () => {
    mock.onGet('/invoices/portal/view/tok-abc123/').reply(200, SAMPLE_HTML)
    const { container } = renderAt('tok-abc123')
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy())

    const iframe = container.querySelector('iframe')
    expect(iframe.getAttribute('sandbox')).toBe('') // no scripts, no forms, no same-origin DOM access — a static document
    expect(iframe.srcdoc).toContain('Invoice INV-2026-0001')
  })

  it('injects a <base> tag pointing at the backend origin, so relative /static/... URLs resolve correctly inside the iframe', async () => {
    mock.onGet('/invoices/portal/view/tok-abc123/').reply(200, SAMPLE_HTML)
    const { container } = renderAt('tok-abc123')
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy())

    const iframe = container.querySelector('iframe')
    expect(iframe.srcdoc).toMatch(/<base href="https?:\/\/[^"]+\/">/)
    // Confirms the injected base actually precedes the original <head>
    // content (not appended after it, which some browsers would still
    // honor but is fragile) — a real ordering assertion, not just
    // presence.
    expect(iframe.srcdoc.indexOf('<base')).toBeLessThan(iframe.srcdoc.indexOf('<meta charset'))
  })

  it('never JSON-parses the response — the raw HTML string reaches the iframe verbatim', async () => {
    mock.onGet('/invoices/portal/view/tok-abc123/').reply(200, SAMPLE_HTML)
    const { container } = renderAt('tok-abc123')
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy())
    expect(container.querySelector('iframe').srcdoc).toContain('<!DOCTYPE html>')
  })
})

describe('InvoiceView — a real, offered Download action', () => {
  it('offers a Download link pointing at the real public per-token PDF endpoint, not the authenticated freelancer one', async () => {
    mock.onGet('/invoices/portal/view/tok-abc123/').reply(200, SAMPLE_HTML)
    renderAt('tok-abc123')
    const downloadLink = await screen.findByRole('link', { name: /download/i })
    expect(downloadLink.getAttribute('href')).toMatch(/\/api\/invoices\/portal\/view\/tok-abc123\/pdf\/$/)
  })
})

describe('InvoiceView — unknown/invalid token', () => {
  it('shows a real error, not a blank page or a crash', async () => {
    mock.onGet('/invoices/portal/view/bad-token/').reply(404)
    renderAt('bad-token')
    await waitFor(() => expect(screen.getByText(/invalid or no longer available/i)).toBeTruthy())
  })
})
