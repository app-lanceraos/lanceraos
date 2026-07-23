// src/components/Card.jsx
export default function Card({ title, subtitle, children, action }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 16 }}>
      {(title || subtitle || action) && (
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            {title && (
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: 'var(--text-primary)', marginBottom: subtitle ? 2 : 0 }}>
                {title}
              </h2>
            )}
            {subtitle && <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div style={{ padding: '18px 20px' }}>{children}</div>
    </div>
  )
}