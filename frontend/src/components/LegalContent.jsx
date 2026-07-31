// src/components/LegalContent.jsx
//
// Shared building blocks for the Privacy Policy / Terms of Service pages.
// Kept deliberately simple and theme-aware (var(--bg-page)/var(--text-*)
// etc.) rather than the auth pages' fixed orbit palette — these documents
// need to be comfortably readable in whichever theme the reader already
// has set, and are meaningfully useful to visit both before signing up
// and later from inside the app (e.g. a future Settings link), unlike
// the auth pages themselves, which only ever appear during the sign-in
// moment and intentionally never change appearance.
import { Link } from 'react-router-dom'
import { LogoSVG, WordmarkSVG } from './Brand'

export function LegalPageShell({ title, lastUpdated, children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', justifyContent: 'center', padding: '48px 20px' }}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 40, textDecoration: 'none' }}>
          <LogoSVG size={32} />
          <WordmarkSVG width={107} height={16} />
        </Link>

        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>
          {title}
        </h1>
        {lastUpdated && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', margin: '0 0 32px' }}>
            Last updated: {lastUpdated}
          </p>
        )}

        <div style={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
          {children}
        </div>

        <p style={{ marginTop: 48, fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
          <Link to="/login" style={{ color: 'var(--accent)', fontWeight: 600 }}>Back to Sign In</Link>
          {' · '}
          <Link to="/register" style={{ color: 'var(--accent)', fontWeight: 600 }}>Back to Sign Up</Link>
        </p>
      </div>
    </div>
  )
}

export function DraftNotice({ children }) {
  return (
    <div style={{
      background: 'var(--warning-bg, rgba(251,191,36,0.08))',
      border: '1px solid var(--warning-border, rgba(251,191,36,0.25))',
      borderRadius: 10, padding: '14px 16px', marginBottom: 32,
      fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6,
    }}>
      {children}
    </div>
  )
}

export function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function P({ children }) {
  return <p style={{ margin: '0 0 12px' }}>{children}</p>
}

export function UL({ items }) {
  return (
    <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
      {items.map((item, i) => <li key={i} style={{ marginBottom: 6 }}>{item}</li>)}
    </ul>
  )
}

export function Needs({ children }) {
  return (
    <span style={{ background: 'rgba(251,191,36,0.15)', color: '#c98a0a', padding: '1px 6px', borderRadius: 4, fontSize: '0.85em', fontWeight: 600 }}>
      [NEEDS: {children}]
    </span>
  )
}

export function SimpleTable({ headers, rows }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 16 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--border-subtle)', color: 'var(--text-primary)', fontWeight: 700 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}