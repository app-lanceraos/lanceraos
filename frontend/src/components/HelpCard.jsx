// src/components/HelpCard.jsx
//
// The frame every Help section sits in: the standard card recipe (DESIGN.md Section 7) as a labelled landmark. Card.jsx is not
// reused because it cannot hand a ref or a tabIndex to its heading, and the answer card and the guide heading must be focus
// targets (focus moves to them when a result or a guide appears, so a screen reader announces it). DashboardCard.jsx is the
// precedent for a feature-local frame.
import { useId } from 'react'

export default function HelpCard({ title, subtitle, headingRef, children, style }) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
        marginBottom: 16, minWidth: 0, ...style,
      }}
    >
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', minWidth: 0 }}>
        <h2
          id={headingId} ref={headingRef} tabIndex={-1}
          style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: 'var(--text-primary)', overflowWrap: 'anywhere' }}
        >
          {title}
        </h2>
        {subtitle && <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{subtitle}</p>}
      </div>
      <div style={{ padding: '16px 20px', minWidth: 0 }}>{children}</div>
    </section>
  )
}

// Visual-only placeholder lines for a first load; the sentence that announces the load is a separate status element.
export function HelpSkeletonLines({ count = 3 }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          style={{
            height: 16, width: i === count - 1 ? '60%' : '100%', background: 'var(--bg-surface-3)',
            borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  )
}
