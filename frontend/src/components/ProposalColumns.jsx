// src/components/ProposalColumns.jsx
//
// The editor's two-column frame: the document on the left, score and tips on
// the right at wide widths; a single column (document first, then score and
// tips) at 768px and below. A class + one media query rather than an inline
// style because an inline style cannot respond to a breakpoint (the same
// reason Invoices.jsx carries a <style> block). Shared by the draft editor and
// the read-only view so the two cannot drift apart.
export default function ProposalColumns({ main, aside }) {
  return (
    <>
      <div className="proposal-columns" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)', gap: 16, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>{main}</div>
        <div style={{ minWidth: 0 }}>{aside}</div>
      </div>
      <style>{`
        @media (max-width: 768px) {
          .proposal-columns { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </>
  )
}
