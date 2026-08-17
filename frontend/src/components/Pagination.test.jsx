// src/components/Pagination.test.jsx
//
// The uniform, real server-paginated footer (List/Table restructure
// pass) that replaced the old tiered "10 -> Show More -> 20 ->
// server-paged" system on both Invoices.jsx and Clients.jsx.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Pagination, { PAGE_SIZE } from './Pagination'

describe('Pagination — desktop', () => {
  it('renders nothing when total is 0', () => {
    const { container } = render(<Pagination page={1} total={0} itemLabel="invoices" onPageChange={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the real "Showing X-Y of N" range for a full first page', () => {
    render(<Pagination page={1} total={45} itemLabel="invoices" onPageChange={() => {}} />)
    expect(screen.getByText(`Showing 1-${PAGE_SIZE} of 45 invoices`)).toBeTruthy()
  })

  it('clamps the range on the final, partial page', () => {
    render(<Pagination page={3} total={45} itemLabel="invoices" onPageChange={() => {}} />)
    expect(screen.getByText('Showing 41-45 of 45 invoices')).toBeTruthy()
  })

  it('Prev is disabled on page 1, Next is disabled on the last page', () => {
    const { rerender } = render(<Pagination page={1} total={45} itemLabel="invoices" onPageChange={() => {}} />)
    expect(screen.getByLabelText('Previous page').disabled).toBe(true)
    expect(screen.getByLabelText('Next page').disabled).toBe(false)

    rerender(<Pagination page={3} total={45} itemLabel="invoices" onPageChange={() => {}} />)
    expect(screen.getByLabelText('Previous page').disabled).toBe(false)
    expect(screen.getByLabelText('Next page').disabled).toBe(true)
  })

  it('clicking a page number calls onPageChange with that real page', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} total={200} itemLabel="invoices" onPageChange={onPageChange} />)
    fireEvent.click(screen.getByText('2'))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('clicking Next advances by exactly one real page', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={2} total={200} itemLabel="invoices" onPageChange={onPageChange} />)
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('collapses a large page count into ellipsis rather than listing every page', () => {
    render(<Pagination page={5} total={2000} itemLabel="invoices" onPageChange={() => {}} />)
    expect(screen.getAllByText('…').length).toBeGreaterThan(0)
    // Real numbered pages, not a fixed hardcoded set — total 2000/20 = 100 pages.
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('100')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy() // current page always shown
  })

  it('shows the fixed "20 / page" label', () => {
    render(<Pagination page={1} total={45} itemLabel="invoices" onPageChange={() => {}} />)
    expect(screen.getByText(`${PAGE_SIZE} / page`)).toBeTruthy()
  })
})

describe('Pagination — mobile (compact)', () => {
  it('renders a compact "Page X of Y" strip instead of numbered pages', () => {
    render(<Pagination page={2} total={200} itemLabel="invoices" onPageChange={() => {}} compact />)
    expect(screen.getByText('Page 2 of 10')).toBeTruthy()
    expect(screen.queryByText(/showing/i)).toBeNull()
  })

  it('Prev/Next still work identically in compact mode', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={2} total={200} itemLabel="invoices" onPageChange={onPageChange} compact />)
    fireEvent.click(screen.getByLabelText('Previous page'))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })
})
