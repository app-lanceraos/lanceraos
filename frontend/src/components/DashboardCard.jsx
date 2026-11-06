// src/components/DashboardCard.jsx
//
// The frame every Dashboard section sits in: the standard card recipe (DESIGN.md Section 7) with a real heading
// and a landmark. Card.jsx is not reused because it carries a bottom margin meant for stacked pages, while the
// Dashboard lays its cards out on a grid with its own gap.
export default function DashboardCard({ id, title, subtitle, action, className, children }) {
  const headingId = `dash-${id}-title`
  return (
    <section
      aria-labelledby={headingId}
      className={className}
      style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
        display: 'flex', flexDirection: 'column', minWidth: 0,
      }}
    >
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 id={headingId} style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: 'var(--text-primary)' }}>
            {title}
          </h2>
          {subtitle && <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div style={{ padding: '16px 20px', flex: 1, minWidth: 0 }}>{children}</div>
    </section>
  )
}
