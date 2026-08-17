// src/components/Pagination.jsx
//
// Uniform, real server-paginated footer — replaces the old tiered
// "10 -> Show More -> 20 -> server-paged" system on both Invoices and
// Clients (List/Table restructure pass). Every filter/search/sort
// combination is a real, independently-paginated server query at a
// fixed PAGE_SIZE=20; this component is purely presentational — it
// takes the current page/total and calls back on navigation, with no
// opinion of its own about how the caller re-fetches.
//
// Desktop: "Showing 1-20 of N {itemLabel}" left, numbered page buttons
// (with ellipsis truncation for many pages) + a "20 / page" label right.
// Mobile (`compact`): a shorter "< Page X of Y >" strip — full numbered
// navigation doesn't fit at phone width.
export const PAGE_SIZE = 20

function pageNumbers(current, total) {
  // Always shows first/last + a window of 1 around `current`, collapsing
  // any gap into a single '…' — never lists every page for a large total.
  const pages = new Set([1, total, current - 1, current, current + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const withEllipsis = []
  let prev = null
  for (const p of sorted) {
    if (prev !== null && p - prev > 1) withEllipsis.push('…')
    withEllipsis.push(p)
    prev = p
  }
  return withEllipsis
}

export default function Pagination({ page, total, itemLabel = 'items', onPageChange, compact = false, loading = false }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (total === 0) return null

  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 20 }}>
        <button className="fos-btn fos-btn-ghost" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <ChevronIcon dir="left" />
        </button>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
          Page {page} of {totalPages}
        </span>
        <button className="fos-btn fos-btn-ghost" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <ChevronIcon dir="right" />
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 20, flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
        Showing {start}-{end} of {total} {itemLabel}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="fos-btn fos-btn-ghost" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page" style={{ padding: '6px 10px' }}>
          <ChevronIcon dir="left" />
        </button>
        {pageNumbers(page, totalPages).map((p, i) => (
          p === '…' ? (
            <span key={`ellipsis-${i}`} style={{ padding: '0 4px', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              disabled={loading}
              className="fos-btn"
              style={{
                minWidth: 32, padding: '6px 8px', fontSize: '0.78rem', fontWeight: p === page ? 700 : 500,
                borderRadius: 'var(--radius-md)',
                background: p === page ? 'var(--accent-glow)' : 'transparent',
                color: p === page ? 'var(--accent)' : 'var(--text-secondary)',
                border: `1.5px solid ${p === page ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              {p}
            </button>
          )
        ))}
        <button className="fos-btn fos-btn-ghost" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page" style={{ padding: '6px 10px' }}>
          <ChevronIcon dir="right" />
        </button>
        <span style={{ marginLeft: 8, fontSize: '0.74rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          {PAGE_SIZE} / page
        </span>
      </div>
    </div>
  )
}

function ChevronIcon({ dir }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}
