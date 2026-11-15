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
//
// This is a known, deliberate difference from DESIGN.md Section 10, which
// gives no-login PUBLIC token pages (a client's proposal, contract or
// invoice link) one fixed light palette. The legal pages are public
// routes too, but they are not a token credential a client opens once;
// they are reference text people return to, and follow the theme.
import { Link } from 'react-router-dom'
import { LogoSVG, WordmarkSVG } from './Brand'

export function LegalPageShell({ title, lastUpdated, version, related, children }) {
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
        {(lastUpdated || version) && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', margin: '0 0 32px' }}>
            {lastUpdated && <span>Last updated: {lastUpdated}</span>}
            {lastUpdated && version && ' · '}
            {version && <span>Version {version}</span>}
          </p>
        )}

        <div style={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
          {children}
        </div>

        <p style={{ marginTop: 48, fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
          <Link to="/login" style={{ color: 'var(--accent)', fontWeight: 600 }}>Back to Sign In</Link>
          {' · '}
          <Link to="/register" style={{ color: 'var(--accent)', fontWeight: 600 }}>Back to Sign Up</Link>
          {related && (
            <>
              {' · '}
              <Link to={related.to} style={{ color: 'var(--accent)', fontWeight: 600 }}>{related.label}</Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

// A table of contents: one link per section, each pointing at the id the matching <Section> carries.
export function LegalContents({ items }) {
  return (
    <nav aria-label="Contents" style={{ marginBottom: 32 }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.9rem' }}>
        {items.map((item) => (
          <li key={item.id} style={{ marginBottom: 4 }}>
            <a href={`#${item.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{item.title}</a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function Section({ id, title, children }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 id={id} style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px', scrollMarginTop: 24 }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function SubHeading({ children }) {
  return (
    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '18px 0 8px' }}>
      {children}
    </h3>
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

export function MailLink({ address }) {
  return (
    <a href={`mailto:${address}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>{address}</a>
  )
}

export function SimpleTable({ headers, rows }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 16 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} scope="col" style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--border-subtle)', color: 'var(--text-primary)', fontWeight: 700 }}>
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
