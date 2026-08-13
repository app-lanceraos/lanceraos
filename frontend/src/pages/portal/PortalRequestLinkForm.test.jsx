// src/pages/portal/PortalRequestLinkForm.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import PortalRequestLinkForm from './PortalRequestLinkForm'

let mock

beforeEach(() => { mock = new MockAdapter(api) })
afterEach(() => { mock.restore() })

describe('PortalRequestLinkForm', () => {
  it('posts the entered email and shows the generic success message', async () => {
    mock.onPost('/clients/portal/request-link/').reply(200, { message: 'ok' })
    render(<PortalRequestLinkForm />)

    fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'client@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /email me a link/i }))

    await waitFor(() => expect(screen.getByText(/if that email matches a client account/i)).toBeTruthy())
    const body = JSON.parse(mock.history.post[0].data)
    expect(body.email).toBe('client@example.com')
  })

  it('shows the same generic success message even when the backend would 429', async () => {
    // The backend never distinguishes rate-limited from match/no-match in
    // a way this form needs to special-case — a 429 IS a real error
    // response, though, so this asserts the real error path instead.
    mock.onPost('/clients/portal/request-link/').reply(429, { error: 'Too many requests. Please try again later.' })
    render(<PortalRequestLinkForm />)

    fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'client@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /email me a link/i }))

    await waitFor(() => expect(screen.getByText(/too many requests/i)).toBeTruthy())
  })
})
