// src/components/InvoiceTable.test.jsx
//
// InvoiceDetailPanel redesign round (item 6): the dedicated Action column
// (a per-row "Open" icon button, and — since the previous bug-hardening
// pass — the bulk-delete control's own header-cell home) is removed
// entirely. The whole row is now the open-affordance instead, matching
// InvoiceCard's existing mobile pattern; bulk delete moved to
// Invoices.jsx's own floating action bar (covered there, not here). This
// suite was rewritten to pin down the new row-click-to-open behavior and
// the checkbox's stopPropagation guard against double-firing it, in place
// of the now-superseded Action-column placement tests.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import InvoiceTable from './InvoiceTable'

function invoiceFixture(overrides = {}) {
  return {
    id: 'inv-1', invoice_number: 'INV-2026-0001', status: 'draft', client_name: 'Acme',
    total: '100.00', currency: 'USD', issue_date: '2026-08-01', due_date: '2026-09-01', days_overdue: 0,
    ...overrides,
  }
}

const DELETE_ELIGIBLE_STATUSES = ['draft', 'created']

function renderTable(props = {}) {
  return render(
    <table>
      <InvoiceTable
        invoices={[invoiceFixture()]}
        deleteEligibleStatuses={DELETE_ELIGIBLE_STATUSES}
        selectedIds={new Set()}
        onToggleSelect={() => {}}
        onSelectAllEligible={() => {}}
        onClearSelection={() => {}}
        onOpen={() => {}}
        {...props}
      />
    </table>,
  )
}

describe('InvoiceTable — no Action column, whole-row click-to-open', () => {
  it('the checkbox column header stays a checkbox even with a selection active', () => {
    renderTable({ selectedIds: new Set(['inv-1']) })
    const headerRow = document.querySelector('thead tr')
    const firstCell = headerRow.children[0]
    expect(within(firstCell).getByLabelText('Select all eligible invoices on this page')).toBeTruthy()
  })

  it('has exactly 7 columns — no trailing Action column', () => {
    renderTable({ selectedIds: new Set() })
    const headerRow = document.querySelector('thead tr')
    expect(headerRow.children.length).toBe(7) // checkbox, Invoice, Client, Amount, Issue Date, Due Date, Status
  })

  it('the whole checkbox column is absent when no row is deletion-eligible', () => {
    renderTable({ invoices: [invoiceFixture({ status: 'sent' })], selectedIds: new Set() })
    expect(screen.queryByLabelText('Select all eligible invoices on this page')).toBeNull()
    const headerRow = document.querySelector('thead tr')
    expect(headerRow.children.length).toBe(6)
  })

  it('clicking anywhere on a row calls onOpen with that invoice', () => {
    const onOpen = vi.fn()
    renderTable({ onOpen })
    fireEvent.click(screen.getByText('INV-2026-0001'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1' }))
  })

  it('clicking the row checkbox does not also fire onOpen (stopPropagation)', () => {
    const onOpen = vi.fn()
    const onToggleSelect = vi.fn()
    renderTable({ onOpen, onToggleSelect })
    fireEvent.click(screen.getByLabelText('Select invoice'))
    expect(onToggleSelect).toHaveBeenCalledWith('inv-1')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a row for an ineligible (non-deletable) status has no checkbox at all, and clicking it still opens', () => {
    const onOpen = vi.fn()
    renderTable({
      invoices: [invoiceFixture({ status: 'sent' })],
      onOpen,
    })
    expect(screen.queryByLabelText('Select invoice')).toBeNull()
    fireEvent.click(screen.getByText('INV-2026-0001'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('a selected row is marked via data-selected so the hover CSS rule can exclude it', () => {
    renderTable({ selectedIds: new Set(['inv-1']) })
    const row = screen.getByText('INV-2026-0001').closest('tr')
    expect(row.getAttribute('data-selected')).toBe('true')
  })
})
