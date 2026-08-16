// src/pages/invoiceHelpers.test.js
import { describe, expect, it } from 'vitest'
import { getSendBannerCopy, timelineLabel } from './invoiceHelpers'

// Simplified rule (supersedes the old 3-state, sent_via_platform-driven
// version — see DECISIONS.md): draft -> nothing, created -> unchanged
// copy, everything else -> reminders_enabled alone decides.
describe('getSendBannerCopy — draft/created/reminders-only rule', () => {
  it('never shows for draft, regardless of reminders_enabled', () => {
    expect(getSendBannerCopy({ status: 'draft', reminders_enabled: true })).toBeNull()
    expect(getSendBannerCopy({ status: 'draft', reminders_enabled: false })).toBeNull()
  })

  it('shows the unchanged "never sent" copy for status=created, regardless of reminders_enabled', () => {
    const copy = getSendBannerCopy({ status: 'created', reminders_enabled: true })
    expect(copy).toMatch(/hasn't been sent through LanceraOS/)
    expect(getSendBannerCopy({ status: 'created', reminders_enabled: false })).toMatch(/hasn't been sent through LanceraOS/)
  })

  // Every other status checks reminders_enabled alone now — no more
  // sent_via_platform branch, and no more distinguishing a manual
  // mark-sent from a real platform send here at all.
  it('shows the reminders-off line for any post-created status when reminders_enabled is false', () => {
    for (const status of ['sent', 'viewed', 'partially_paid', 'paid', 'cancelled', 'refunded', 'bad_debt']) {
      const copy = getSendBannerCopy({ status, reminders_enabled: false })
      expect(copy).toMatch(/Reminders are off/)
    }
  })

  it('shows no banner at all for any post-created status when reminders_enabled is true', () => {
    for (const status of ['sent', 'viewed', 'partially_paid', 'paid', 'cancelled', 'refunded', 'bad_debt']) {
      expect(getSendBannerCopy({ status, reminders_enabled: true })).toBeNull()
    }
  })

  it('ignores sent_via_platform entirely — same result regardless of its value', () => {
    expect(getSendBannerCopy({ status: 'sent', reminders_enabled: false, sent_via_platform: true })).toMatch(/Reminders are off/)
    expect(getSendBannerCopy({ status: 'sent', reminders_enabled: false, sent_via_platform: false })).toMatch(/Reminders are off/)
    expect(getSendBannerCopy({ status: 'sent', reminders_enabled: true, sent_via_platform: true })).toBeNull()
    expect(getSendBannerCopy({ status: 'sent', reminders_enabled: true, sent_via_platform: false })).toBeNull()
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
