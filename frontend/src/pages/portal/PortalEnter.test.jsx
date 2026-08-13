// src/pages/portal/PortalEnter.test.jsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import PortalEnter from './PortalEnter'

let mock

beforeEach(() => { mock = new MockAdapter(api) })
afterEach(() => { mock.restore() })

function renderAt(token) {
  return render(
    <MemoryRouter initialEntries={[`/portal/enter/${token}`]}>
      <Routes>
        <Route path="/portal/enter/:token" element={<PortalEnter />} />
        <Route path="/portal" element={<div>Portal List Page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PortalEnter', () => {
  it('calls the magic-link entry endpoint with the URL token', async () => {
    mock.onGet('/clients/portal/abc123/').reply(200, { client: { id: 'c1', name: 'Acme', email: 'a@example.com' } })
    renderAt('abc123')
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/clients/portal/abc123/')).toBe(true))
  })

  it('navigates to /portal on a valid token', async () => {
    mock.onGet('/clients/portal/abc123/').reply(200, { client: { id: 'c1', name: 'Acme', email: 'a@example.com' } })
    renderAt('abc123')
    await waitFor(() => expect(screen.getByText('Portal List Page')).toBeTruthy())
  })

  it('shows a real error and a request-link form for an unknown token, not a redirect', async () => {
    mock.onGet('/clients/portal/bad-token/').reply(404, { error: 'This link is invalid or has expired.' })
    renderAt('bad-token')
    await waitFor(() => expect(screen.getByText(/invalid or has expired/i)).toBeTruthy())
    expect(screen.queryByText('Portal List Page')).toBeNull()
    expect(screen.getByPlaceholderText(/you@example.com/i)).toBeTruthy()
  })

  it('shows a generic error for a non-404 failure', async () => {
    mock.onGet('/clients/portal/abc123/').reply(500)
    renderAt('abc123')
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeTruthy())
  })
})
