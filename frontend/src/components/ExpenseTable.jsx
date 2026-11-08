// src/components/ExpenseTable.jsx
//
// The Expenses list: a real table on desktop (ExpenseTable) and a card list at <= 768px (ExpenseCard, rendered by
// Expenses.jsx), toggled with the same .list-desktop / .list-mobile CSS the other list pages use (Prompt 15).
// Columns: Date | Paid to | Category | Amount | Deductible | actions. Every th/td/wrapper/hover style comes from
// listTableStyles.js. The whole row opens the edit dialog, AND the date cell holds a real <button> that does the same, so
// every row is operable from the keyboard. The last cell is a row-actions menu (Edit, Duplicate, Delete) built like
// ClientTable's; clicking it must never also open the row (the menu's panel is portaled to <body>, but React events still
// bubble through the portal to the cell, whose handler stops them).
// An amount is shown with its exact cents; an expense converted with an estimated rate, or with none, carries an Info
// icon whose label is the same sentence the edit dialog shows as visible text. Free text (vendor, description) is always
// rendered as plain text by React, single-line with an ellipsis.
import { Check, Copy, Info, MoreVertical, Pencil, Trash2, X } from 'lucide-react'

import DropdownMenu from './DropdownMenu'
import { clickableRowCss, tableStyle, tableWrapperStyle, td, th, theadRowStyle } from './listTableStyles'
import { STATUS_BADGE_STYLE, badgeBaseStyle } from '@/pages/clientHelpers'
import { formatIsoDate } from '@/pages/dashboardHelpers'
import { categoryLabel, expenseRateNote, formatExact, openLabel, rowActionsLabel } from '@/pages/expensesHelpers'

export function CategoryBadge({ category }) {
  return <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.gray, fontWeight: 500, maxWidth: '100%' }}>{categoryLabel(category)}</span>
}

function RateInfo({ basis, size = 13 }) {
  if (basis !== 'estimated' && basis !== 'none') return null
  const note = expenseRateNote(basis)
  return (
    <span role="img" aria-label={note} data-tooltip={note} style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 6, color: 'var(--text-tertiary)' }}>
      <Info size={size} aria-hidden="true" />
    </span>
  )
}

function Deductible({ value }) {
  const Icon = value ? Check : X
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: value ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
      <Icon size={13} aria-hidden="true" />
      {value ? 'Yes' : 'No'}
    </span>
  )
}

function RowMenu({ expense, onOpen, onDuplicate, onDelete }) {
  return (
    <DropdownMenu
      trigger={<MoreVertical size={15} strokeWidth={1.7} />}
      triggerLabel={rowActionsLabel(expense)}
      bareTrigger
      triggerStyle={{ width: 28, height: 28, borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)' }}
      items={[
        { key: 'edit', label: 'Edit', Icon: Pencil, onClick: () => onOpen(expense) },
        { key: 'duplicate', label: 'Duplicate', Icon: Copy, onClick: () => onDuplicate(expense) },
        { key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onClick: () => onDelete(expense) },
      ]}
    />
  )
}

export default function ExpenseTable({ expenses, onOpen, onDuplicate, onDelete }) {
  return (
    <div style={tableWrapperStyle}>
      <style>{clickableRowCss('expense-row')}</style>
      <table style={tableStyle(780)}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={th}>Date</th>
            <th style={th}>Paid to</th>
            <th style={th}>Category</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount</th>
            <th style={th}>Deductible</th>
            <th style={{ ...th, width: 44 }} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => (
            <tr key={expense.id} className="expense-row" onClick={() => onOpen(expense)}>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpen(expense) }}
                  style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                  aria-label={openLabel(expense)}
                >
                  {formatIsoDate(expense.expense_date)}
                </button>
              </td>
              <td style={{ ...td, maxWidth: 260 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{expense.vendor || '—'}</div>
                {expense.description && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{expense.description}</div>
                )}
              </td>
              <td style={td}><CategoryBadge category={expense.category} /></td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {formatExact(expense.amount, expense.currency)}
                <RateInfo basis={expense.rate_basis} />
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}><Deductible value={expense.is_deductible} /></td>
              <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                <RowMenu expense={expense} onOpen={onOpen} onDuplicate={onDuplicate} onDelete={onDelete} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The mobile card: a main button (the content — no button inside a button) and the same menu beside it.
export function ExpenseCard({ expense, onOpen, onDuplicate, onDelete }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '6px 6px 6px 0' }}>
      <button
        type="button"
        onClick={() => onOpen(expense)}
        aria-label={openLabel(expense)}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer', font: 'inherit',
          background: 'transparent', border: 'none', padding: '8px 0 8px 16px', color: 'var(--text-primary)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: '1rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {formatExact(expense.amount, expense.currency)}
            <RateInfo basis={expense.rate_basis} />
          </span>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{formatIsoDate(expense.expense_date)}</span>
        </div>
        <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {expense.vendor || 'No name'}
        </span>
        {expense.description && (
          <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{expense.description}</span>
        )}
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.74rem' }}>
          <CategoryBadge category={expense.category} />
          <Deductible value={expense.is_deductible} />
        </span>
      </button>
      <div style={{ flexShrink: 0, paddingTop: 6 }}>
        <RowMenu expense={expense} onOpen={onOpen} onDuplicate={onDuplicate} onDelete={onDelete} />
      </div>
    </div>
  )
}
