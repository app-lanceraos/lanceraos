// src/pages/DesignGallery.test.jsx
//
// Covers the "Blank design" creation path specifically: it must navigate
// straight to the editor (nothing to "use as-is" with zero header
// content) and must NEVER call set-default the way "Use this template"/
// AI-seed do — see DesignGallery.jsx's own handleStartBlank comment.
//
// No @testing-library/jest-dom in this project's devDependencies — plain
// vitest `expect` + raw DOM properties, same convention as this repo's
// other test files.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import DesignGallery from './DesignGallery'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

let mock

beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 0 })
  document.cookie = 'csrftoken=test-token'
  mockNavigate.mockClear()
  mock.onGet('/invoices/designs/').reply(200, [])
  mock.onGet('/invoices/designs/templates/').reply(200, {
    templates: ['professional', 'minimal', 'modern'],
    variant_details: {},
  })
})

afterEach(() => {
  mock.restore()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC'
})

describe('DesignGallery — Blank design creation', () => {
  it('navigates straight to the editor and never calls set-default', async () => {
    mock.onGet('/invoices/designs/template/').reply(200, {
      design_data: { schema_version: 2, page: {}, header: { elements: [] }, flow: { elements: [] } },
    })
    mock.onPost('/invoices/designs/').reply(200, { id: 'new-blank-id', name: 'Untitled design' })

    render(<DesignGallery />)
    await waitFor(() => expect(screen.getByText('Blank design')).toBeTruthy())

    fireEvent.click(screen.getByText('Blank design'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/invoices/designs/new-blank-id/edit'))

    const setDefaultCalls = mock.history.post.filter((r) => r.url.includes('/set-default/'))
    expect(setDefaultCalls.length).toBe(0)

    // No "ready to use as-is" banner for the blank path.
    expect(screen.queryByText(/ready to use as-is/i)).toBeNull()
  })
})
