// src/pages/invoiceHelpers.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dueDateCountdown, getSendBannerCopy, timelineLabel } from './invoiceHelpers'

// Simplified further this round (InvoiceDetailPanel redesign — see
// DECISIONS.md): this function now ONLY covers status='created'. The
// reminders-off case moved to its own dedicated banner-with-a-button
// component (RemindersOffBanner, InvoiceDetailPanel.jsx) — a plain text
// return value can't host a real "Turn on reminders" action button.
describe('getSendBannerCopy — created-only rule', () => {
  it('never shows for draft', () => {
    expect(getSendBannerCopy({ status: 'draft', reminders_enabled: true })).toBeNull()
    expect(getSendBannerCopy({ status: 'draft', reminders_enabled: false })).toBeNull()
  })

  it('shows the "never sent" copy for status=created, regardless of reminders_enabled', () => {
    expect(getSendBannerCopy({ status: 'created', reminders_enabled: true })).toMatch(/hasn't been sent through LanceraOS/)
    expect(getSendBannerCopy({ status: 'created', reminders_enabled: false })).toMatch(/hasn't been sent through LanceraOS/)
  })

  it('shows nothing for any active or terminal status, regardless of reminders_enabled', () => {
    for (const status of ['sent', 'viewed', 'partially_paid', 'paid', 'cancelled', 'refunded', 'bad_debt']) {
      expect(getSendBannerCopy({ status, reminders_enabled: false })).toBeNull()
      expect(getSendBannerCopy({ status, reminders_enabled: true })).toBeNull()
    }
  })
})

describe('dueDateCountdown — InvoiceDetailPanel header subtitle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('returns null when there is no due date at all', () => {
    expect(dueDateCountdown({ due_date: null, days_overdue: 0 })).toBeNull()
  })

  it('shows "X days remaining" for a future due date', () => {
    const result = dueDateCountdown({ due_date: '2026-08-22', days_overdue: 0 })
    expect(result.text).toBe('5 days remaining')
    expect(result.overdue).toBe(false)
  })

  it('shows "1 day remaining" (singular) for tomorrow', () => {
    const result = dueDateCountdown({ due_date: '2026-08-18', days_overdue: 0 })
    expect(result.text).toBe('1 day remaining')
  })

  it('shows "Due today" for the current date', () => {
    const result = dueDateCountdown({ due_date: '2026-08-17', days_overdue: 0 })
    expect(result.text).toBe('Due today')
    expect(result.overdue).toBe(false)
  })

  it('shows "X days overdue" (via days_overdue, in red) once genuinely overdue', () => {
    const result = dueDateCountdown({ due_date: '2026-08-10', days_overdue: 7 })
    expect(result.text).toBe('7 days overdue')
    expect(result.overdue).toBe(true)
  })
})

describe('timelineLabel — who sent it', () => {
  it('shows "Sent by LanceraOS" when via is platform', () => {
    expect(timelineLabel({ type: 'sent', via: 'platform' })).toBe('Sent by LanceraOS')
  })

  it('shows "Marked as sent by you" for a manual mark-sent', () => {
    expect(timelineLabel({ type: 'sent', via: 'manual' })).toBe('Marked as sent by you')
  })

  it('shows the invoice number on the finalised entry when present', () => {
    expect(timelineLabel({ type: 'finalised', invoice_number: 'INV-2026-0001' })).toBe('Finalised as INV-2026-0001')
  })

  it('falls back gracefully when the finalised entry has no invoice number', () => {
    expect(timelineLabel({ type: 'finalised' })).toBe('Finalised')
  })

  it('labels the created entry plainly', () => {
    expect(timelineLabel({ type: 'created' })).toBe('Invoice created')
  })

  // Real, confirmed bug (item 3 of the verification pass): visiting the
  // timeline of a paid/partially-paid invoice showed a blank page,
  // requiring a manual reload. Root cause, found by reproducing rather
  // than guessing: invoiceHelpers.js only RE-EXPORTED formatMoney from
  // clientHelpers.js ("export { formatMoney } from './clientHelpers'"),
  // which does NOT create a local binding — timelineLabel's own call to
  // the bare `formatMoney(...)` identifier below threw a real
  // ReferenceError at render time, but only for event types that
  // actually call it ('payment'/'claim'), which is exactly why this
  // shipped unnoticed: no existing test here exercised either case.
  // Fixed with a real local `import { formatMoney } from './clientHelpers'`
  // alongside the existing re-export.
  it('labels a payment entry with a real formatted amount, not a crash', () => {
    expect(timelineLabel({ type: 'payment', amount: '150.00', currency: 'USD', source: 'bank' }))
      .toBe('Payment recorded — USD 150 via bank')
  })

  it('labels a claim entry with a real formatted amount, not a crash', () => {
    expect(timelineLabel({ type: 'claim', status: 'pending', amount: '75.50', currency: 'EUR' }))
      .toBe('Payment claim pending — EUR 76')
  })
})
