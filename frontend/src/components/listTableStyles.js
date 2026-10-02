// src/components/listTableStyles.js
//
// The one source for the visual language of a list-page table (the
// Invoices list and the Clients list render the same chrome): wrapper,
// header row, header/body cell styles, and the clickable-row hover rule.
// Extracted 02 October 2026 when ClientTable.jsx was built to match
// InvoiceTable.jsx — before this, InvoiceTable held the only copy, so a
// second table could only have been a hand-copied one that silently drifts
// the next time either is tuned (see STANDARDS.md's single-source-of-truth
// rule). Pure style data: no React, no behavior.

export const th = {
  textAlign: 'left', padding: '10px 12px', fontSize: '0.68rem', fontWeight: 600,
  color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
}

export const td = {
  padding: '12px', fontSize: '0.84rem', color: 'var(--text-primary)',
  borderTop: '1px solid var(--border-subtle)', verticalAlign: 'middle',
}

// overflowX: 'auto' makes the wrapper a scroll container on narrow desktop
// widths (the CSS Overflow spec then computes overflow-y: auto too, which
// is why DropdownMenu portals its panel out rather than nesting it here).
export const tableWrapperStyle = {
  overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
}

export const theadRowStyle = { background: 'var(--bg-surface-2)' }

export function tableStyle(minWidth) {
  return { width: '100%', borderCollapse: 'collapse', minWidth }
}

// A per-row :hover state isn't expressible through this codebase's inline-
// style convention, so a clickable row gets a class. `:not([data-selected
// ="true"])` lets a selectable table (Invoices) keep its selected tint on
// hover; a table with no selection concept (Clients) simply never sets the
// attribute, so the rule always applies.
export function clickableRowCss(className) {
  return `
        .${className} { cursor: pointer; transition: background var(--transition-fast); }
        .${className}:not([data-selected="true"]):hover { background: var(--bg-surface-2); }
      `
}
