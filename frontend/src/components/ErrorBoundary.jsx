// src/components/ErrorBoundary.jsx
//
// A real React error boundary (item 3 of the verification pass) — must be
// a class component; there is no hooks equivalent to componentDidCatch.
// General-purpose, not invoice-specific: wraps any subtree that renders
// data whose shape isn't fully controlled by this app (e.g. a timeline
// feed that grows new event types over time) so a future rendering bug
// there degrades to a visible, dismissible-feeling message instead of a
// blank white screen requiring a manual reload — the exact failure mode
// found and fixed for InvoiceDetailPanel's Timeline tab.
import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ textAlign: 'center', padding: 28, background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
          <AlertTriangle size={18} style={{ marginBottom: 6, color: 'var(--status-red-text)' }} />
          <p style={{ margin: 0 }}>Something went wrong showing this. Please try reloading.</p>
        </div>
      )
    }
    return this.props.children
  }
}
