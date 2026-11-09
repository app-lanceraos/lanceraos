// src/components/MonthlyTable.jsx
//
// A real <table> in a DashboardCard, used by both report pages (P&L: Month | Income | Expenses | Net; statement: Month |
// Payments | USD | PKR equivalent). It shows ONLY what the server sent: the optional footer is the server's own total row,
// never a sum of the rows above it. Cells arrive as ready text; numbers are right-aligned with tabular figures. The wrapper
// scrolls sideways inside its card as a safety net; the page itself must never scroll sideways.
import DashboardCard from './DashboardCard'
import { visuallyHidden } from '@/pages/dashboardHelpers'

const cell = { padding: '9px 12px', fontSize: '0.82rem', color: 'var(--text-primary)', borderTop: '1px solid var(--border-subtle)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const head = { padding: '9px 12px', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', background: 'var(--bg-surface-2)' }

// columns: [{ key, label, align }]; rows: [{ key, cells: { [column key]: text } }]; footer: { cells } | null
export default function MonthlyTable({ id, title, subtitle, columns, rows, footer, caption, minWidth = 460, bare = false }) {
  // `bare` renders just a heading and the table (for use inside another card, where a card in a card would be noise).
  const Frame = bare ? BareFrame : DashboardCard
  return (
    <Frame id={id} title={title} subtitle={subtitle} className="rpt-table-card">
      <div style={{ overflowX: 'auto', margin: '-4px -4px 0', padding: '4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth }}>
          <caption style={visuallyHidden}>{caption || title}</caption>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c.key} scope="col" style={{ ...head, textAlign: c.align === 'right' ? 'right' : 'left', borderTopLeftRadius: i === 0 ? 'var(--radius-md)' : 0, borderTopRightRadius: i === columns.length - 1 ? 'var(--radius-md)' : 0 }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                {columns.map((c, i) => (
                  i === 0
                    ? <th key={c.key} scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 500 }}>{row.cells[c.key]}</th>
                    : <td key={c.key} style={{ ...cell, textAlign: c.align === 'right' ? 'right' : 'left' }}>{row.cells[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && (
            <tfoot>
              <tr>
                {columns.map((c, i) => (
                  i === 0
                    ? <th key={c.key} scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 700, borderTop: '2px solid var(--border-default)' }}>{footer.cells[c.key]}</th>
                    : <td key={c.key} style={{ ...cell, textAlign: c.align === 'right' ? 'right' : 'left', fontWeight: 700, borderTop: '2px solid var(--border-default)' }}>{footer.cells[c.key]}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Frame>
  )
}

function BareFrame({ id, title, children }) {
  const headingId = `rpt-${id}-title`
  return (
    <section aria-labelledby={headingId} style={{ minWidth: 0 }}>
      <h3 id={headingId} style={{ margin: '0 0 8px', fontSize: '0.88rem', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: 'var(--text-primary)' }}>{title}</h3>
      {children}
    </section>
  )
}
