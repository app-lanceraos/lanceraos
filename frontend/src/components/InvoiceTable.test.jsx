// src/components/InvoiceTable.test.jsx
//
// Bug-fix round: the bulk-select delete control used to overwrite the
// checkbox COLUMN's own header once ≥1 row was selected — a real,
// reported misplacement (the select-all checkbox visually vanished
// instead of a bulk action appearing). It now lives in the ACTION
// column's own header instead; the checkbox column always stays a
// checkbox. This suite pins that exact placement down directly at the
// component level (no dedicated InvoiceDetailPanel.jsx test file exists
// in this codebase by established convention, but InvoiceTable.jsx is a
// small, self-contained, easily unit-testable component that didn't
// have one yet either).
import { render, screen, within } from '@testing-library/react'
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
        onRequestBulkDelete={() => {}}
        onOpen={() => {}}
        {...props}
      />
    </table>,
  )
}

describe('InvoiceTable — bulk-select delete-icon placement', () => {
  it('the checkbox column header stays a checkbox even with a selection active', () => {
    renderTable({ selectedIds: new Set(['inv-1']) })
    const headerRow = document.querySelector('thead tr')
    const firstCell = headerRow.children[0]
    expect(within(firstCell).getByLabelText('Select all eligible invoices on this page')).toBeTruthy()
    expect(within(firstCell).queryByLabelText('Delete selected invoices')).toBeNull()
  })

  it('the delete control appears in the LAST (Action) column header once ≥1 row is selected', () => {
    renderTable({ selectedIds: new Set(['inv-1']) })
    const headerRow = document.querySelector('thead tr')
    const lastCell = headerRow.children[headerRow.children.length - 1]
    expect(within(lastCell).getByLabelText('Delete selected invoices')).toBeTruthy()
  })

  it('the Action column header is empty (no delete control) with nothing selected', () => {
    renderTable({ selectedIds: new Set() })
    const headerRow = document.querySelector('thead tr')
    const lastCell = headerRow.children[headerRow.children.length - 1]
    expect(within(lastCell).queryByLabelText('Delete selected invoices')).toBeNull()
  })

  it('clicking the relocated delete control calls onRequestBulkDelete', () => {
    const onRequestBulkDelete = vi.fn()
    renderTable({ selectedIds: new Set(['inv-1']), onRequestBulkDelete })
    screen.getByLabelText('Delete selected invoices').click()
    expect(onRequestBulkDelete).toHaveBeenCalled()
  })

  it('the whole checkbox column is absent when no row is deletion-eligible', () => {
    renderTable({ invoices: [invoiceFixture({ status: 'sent' })], selectedIds: new Set() })
    expect(screen.queryByLabelText('Select all eligible invoices on this page')).toBeNull()
  })
})
