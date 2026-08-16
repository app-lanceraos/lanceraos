// src/components/ErrorBoundary.test.jsx
//
// Item 3 of the verification pass: InvoiceDetailPanel's Timeline tab
// crashed to a blank white screen on a real, confirmed bug (a bare
// formatMoney() reference that threw once a payment/claim timeline entry
// existed — fixed in invoiceHelpers.js). This component is the general,
// reusable safety net requested alongside that fix — a future rendering
// bug in a wrapped subtree must degrade to a visible message, never a
// blank page.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ErrorBoundary from './ErrorBoundary'

function Bomb() {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(<ErrorBoundary><p>All good</p></ErrorBoundary>)
    expect(screen.getByText('All good')).toBeTruthy()
  })

  it('catches a render error and shows the default fallback instead of a blank page', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByText(/Something went wrong/)).toBeTruthy()
    spy.mockRestore()
  })

  it('renders a custom fallback when one is provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary fallback={<p>Custom fallback</p>}><Bomb /></ErrorBoundary>)
    expect(screen.getByText('Custom fallback')).toBeTruthy()
    spy.mockRestore()
  })
})
