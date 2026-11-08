// src/components/PaymentImportReview.jsx
//
// Step 3: every row of the file with a plain-words status, tick boxes and a running total of what will be added.
//
// - Selection starts as the server says (new rows only) and lives in a Set in the hook, so paging the view (50 rows at a
//   time, a file can have 2,000) never loses a tick. A row the server calls not selectable has a DISABLED checkbox.
// - The reason the server gives for a row is always shown verbatim — the Wise wording rules are a best guess.
// - The rows are rendered twice (a table on desktop, cards at <= 768 px) and toggled by CSS, the pattern Payments.jsx uses.
// - The footer total is computed here in integer cents, per currency, never summed across currencies.
import { Info } from 'lucide-react'

import FilterPill from './FilterPill'
import FosAlert from './FosAlert'
import { tableStyle, tableWrapperStyle, td, th, theadRowStyle } from './listTableStyles'
import { STATUS_BADGE_STYLE, badgeBaseStyle } from '@/pages/clientHelpers'
import { formatIsoDate } from '@/pages/dashboardHelpers'
import {
  FILTERS, ROWS_PER_VIEW, anySelectable, describeMatch, filterCounts, filterRows, mappingSummary, originLine, rowAccessibleName,
  selectionNotes, selectionTotals, statusView, visibleRows, wiseMismatch,
} from '@/pages/paymentImportHelpers'
import { formatExact, sourceLabel } from '@/pages/paymentsHelpers'

const SR_ONLY = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }
const REVIEW_CSS = `
  /* sticky offsets are measured from the scroll container's CONTENT edge, so bottom must cancel the card's padding or rows show under the bar */
  .pay-import-bar { position: sticky; bottom: -24px; z-index: 2; margin: 18px -28px -24px; padding: 12px 28px; background: var(--bg-surface); border-top: 1px solid var(--border-subtle); }
`

function StatusBadge({ status }) {
  const view = statusView(status)
  return <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[view.badge] }}>{view.label}</span>
}

function RowDetails({ row }) {
  const lead = row.status === 'duplicate_probable' ? 'Looks like:' : row.status === 'duplicate_exact' ? 'Already in your payments:' : null
  return (
    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {row.reason && <span>{row.reason}</span>}
      {(row.warnings || []).map((warning, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 5, color: 'var(--status-amber-text)', fontSize: '0.74rem' }}>
          <Info size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{warning}</span>
        </span>
      ))}
      {lead && (row.matches || []).length > 0 && (
        <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
          <div style={{ fontWeight: 600 }}>{lead}</div>
          {row.matches.map((match) => <div key={match.id}>{describeMatch(match)}</div>)}
        </div>
      )}
    </div>
  )
}

function Tick({ row, selection, onToggle }) {
  return (
    <input
      type="checkbox" checked={selection.has(row.row)} disabled={!row.selectable} onChange={() => onToggle(row.row)}
      aria-label={rowAccessibleName(row)} style={{ width: 16, height: 16, cursor: row.selectable ? 'pointer' : 'not-allowed' }}
    />
  )
}

const amountText = (row) => (row.amount === null || row.amount === undefined ? '—' : formatExact(row.amount, row.currency))

function RowsTable({ rows, selection, onToggle }) {
  return (
    <div className="pay-import-table" style={tableWrapperStyle}>
      <table style={tableStyle(700)}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={{ ...th, width: 36 }}><span style={SR_ONLY}>Import</span></th>
            <th style={th}>Date</th><th style={th}>Received from</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Status</th><th style={th}>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.row} data-selected={selection.has(row.row) ? 'true' : undefined} className="pay-import-row" style={{ opacity: row.selectable ? 1 : 0.8 }}>
              <td style={td}><Tick row={row} selection={selection} onToggle={onToggle} /></td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatIsoDate(row.payment_date)}</td>
              <td style={{ ...td, overflowWrap: 'anywhere' }}>
                <div>{row.counterparty || '—'}</div>
                {row.notes && <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{row.notes}</div>}
              </td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{amountText(row)}</td>
              <td style={td}><StatusBadge status={row.status} /></td>
              <td style={td}><RowDetails row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RowsCards({ rows, selection, onToggle }) {
  return (
    <ul className="pay-import-cards" style={{ listStyle: 'none', margin: 0, padding: 0, flexDirection: 'column', gap: 8 }}>
      {rows.map((row) => (
        <li key={row.row} style={{ padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', opacity: row.selectable ? 1 : 0.85 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ paddingTop: 2 }}><Tick row={row} selection={selection} onToggle={onToggle} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{row.counterparty || '—'}</span>
                <span style={{ fontSize: '0.86rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{amountText(row)}</span>
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', margin: '2px 0 6px' }}>
                {formatIsoDate(row.payment_date)}{row.notes ? ` · ${row.notes}` : ''}
              </div>
              <div style={{ marginBottom: 6 }}><StatusBadge status={row.status} /></div>
              <RowDetails row={row} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function PaymentImportReview({ state, actions }) {
  const { plan, selection, filter, shown, busy, error, notice, source } = state
  const rows = plan.rows || []
  const counts = filterCounts(rows)
  const filtered = filterRows(rows, filter)
  const visible = visibleRows(rows, filter, shown)
  const left = filtered.length - visible.length
  const totals = selectionTotals(rows, selection)
  const notes = selectionNotes(rows, selection)
  const selectedCount = rows.filter((row) => row.selectable && selection.has(row.row)).length
  const canImport = anySelectable(rows)
  const mapped = mappingSummary(plan.mapping)
  const importing = busy === 'commit'

  return (
    <div>
      {notice && <FosAlert type="info" style={{ marginBottom: 12 }}>{notice}</FosAlert>}
      {(plan.warnings || []).map((warning) => (
        <FosAlert key={warning.code} type="info" style={{ marginBottom: 12 }}>{warning.message}</FosAlert>
      ))}
      {wiseMismatch(plan, source) && (
        <FosAlert type="warning" style={{ marginBottom: 12 }}>
          <span style={{ display: 'block', marginBottom: 8 }}>
            This looks like a Wise statement, but you chose {sourceLabel(source)}. Duplicates are only matched within one source, so a wrong choice weakens them.
          </span>
          <button type="button" className="fos-btn fos-btn-ghost" onClick={actions.useWise} disabled={Boolean(busy)}>Use Wise</button>
        </FosAlert>
      )}

      <p style={{ margin: '0 0 4px', fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: 600 }}>
        {plan.summary?.total ?? rows.length} rows in {plan.file?.name}. {counts.new} look ready to import.
      </p>
      <p style={{ margin: '0 0 12px', fontSize: '0.76rem', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        {originLine(plan)}{' '}
        {mapped.map((item, i) => <span key={item.role}>{i > 0 ? ', ' : ''}{item.label}: {item.column}</span>)}{' '}
        <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.74rem', padding: '3px 10px', marginLeft: 6 }} onClick={actions.changeColumns} disabled={Boolean(busy)}>
          Change columns
        </button>
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {FILTERS.filter((item) => item.key === 'all' || counts[item.key] > 0).map((item) => (
          <FilterPill key={item.key} type="button" active={filter === item.key} aria-pressed={filter === item.key} onClick={() => actions.setFilter(item.key)}>
            {item.label} ({counts[item.key]})
          </FilterPill>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '6px 12px' }} onClick={actions.selectReady} disabled={!canImport}>Select all ready</button>
        <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '6px 12px' }} onClick={actions.clear} disabled={!canImport}>Clear selection</button>
      </div>

      <p role="status" style={SR_ONLY}>{selectedCount} of {rows.length} rows selected</p>

      {filtered.length === 0 ? (
        <p style={{ margin: '24px 0', textAlign: 'center', fontSize: '0.86rem', color: 'var(--text-tertiary)' }}>No rows in this group.</p>
      ) : (
        <>
          <RowsTable rows={visible} selection={selection} onToggle={actions.toggle} />
          <RowsCards rows={visible} selection={selection} onToggle={actions.toggle} />
          {left > 0 && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button type="button" className="fos-btn fos-btn-ghost" onClick={actions.showMore}>Show {ROWS_PER_VIEW} more ({left} left)</button>
            </div>
          )}
        </>
      )}

      {error && <FosAlert type="error" style={{ marginTop: 14 }}>{error}</FosAlert>}

      <div className="pay-import-bar">
        {canImport ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: notes.length ? 6 : 10 }}>
              <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>{selectedCount} selected</strong>
              {totals.map((total) => (
                <span key={total.currency} style={{ fontSize: '0.84rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{total.text}</span>
              ))}
            </div>
            {notes.map((note) => <p key={note} style={{ margin: '0 0 8px', fontSize: '0.76rem', color: 'var(--status-amber-text)' }}>{note}</p>)}
          </>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>Nothing in this file can be imported.</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Rows that are not income, can't be read or were already imported are never added.</p>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="fos-btn fos-btn-ghost" onClick={actions.back} disabled={Boolean(busy)}>Choose another file</button>
          {canImport && (
            <button type="button" className="fos-btn fos-btn-accent" onClick={actions.commit} disabled={selectedCount === 0 || Boolean(busy)}>
              {importing ? <span className="fos-spinner" /> : null} {importing ? 'Importing…' : `Import ${selectedCount} payment${selectedCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
      <style>{REVIEW_CSS}</style>
    </div>
  )
}
