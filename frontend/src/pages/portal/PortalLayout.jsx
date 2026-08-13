// src/pages/portal/PortalLayout.jsx
//
// Shell-less, like /account/deletion-review — the client portal is its
// own standalone surface, never wrapped in AppShell (that's the
// freelancer-facing chrome). Theme-responsive tokens (var(--bg-surface)
// etc.), not the fixed "orbit palette" the auth pages (Login/Register)
// use — this is a real, ongoing product surface a client returns to
// repeatedly, not a one-shot auth flow.
export default function PortalLayout({ children, maxWidth = 480 }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'var(--bg-page)',
    }}>
      <div style={{
        width: '100%', maxWidth, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)', padding: '28px 32px',
      }}>
        {children}
      </div>
    </div>
  )
}
