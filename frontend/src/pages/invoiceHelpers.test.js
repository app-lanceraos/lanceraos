// src/pages/invoiceHelpers.test.js
import { describe, expect, it } from 'vitest'
import { getSendBannerCopy, timelineLabel } from './invoiceHelpers'

describe('getSendBannerCopy — exactly 2 states show it, nothing else', () => {
  it('shows the "never sent" copy for status=created', () => {
    const copy = getSendBannerCopy({ status: 'created', sent_via_platform: false })
    expect(copy).toMatch(/hasn't been sent through LanceraOS/)
  })

  it('shows the "you marked it sent" copy for status=sent, sent_via_platform=false', () => {
    const copy = getSendBannerCopy({ status: 'sent', sent_via_platform: false, reminders_enabled: true, sent_at: '2026-01-01' })
    expect(copy).toMatch(/marked this invoice as sent yourself/)
    expect(copy).toMatch(/enable reminders/)
  })

  it('reflects reminders_enabled=false in the sent-manually copy', () => {
    const copy = getSendBannerCopy({ status: 'sent', sent_via_platform: false, reminders_enabled: false })
    expect(copy).toMatch(/leave reminders off/)
  })

  it('never shows for draft', () => {
    expect(getSendBannerCopy({ status: 'draft', sent_via_platform: false })).toBeNull()
  })

  // Real bug this fixes: the previous version fell through to the
  // "sent manually" copy for EVERY status beyond 'created', not just
  // 'sent' — meaning it showed up on viewed/partially_paid/paid/
  // cancelled/refunded/bad_debt invoices too.
  it('never shows for viewed, partially_paid, paid, cancelled, refunded, or bad_debt', () => {
    for (const status of ['viewed', 'partially_paid', 'paid', 'cancelled', 'refunded', 'bad_debt']) {
      expect(getSendBannerCopy({ status, sent_via_platform: false })).toBeNull()
    }
  })

  it('never shows once sent_via_platform is true, regardless of status', () => {
    for (const status of ['created', 'sent', 'viewed', 'paid']) {
      expect(getSendBannerCopy({ status, sent_via_platform: true })).toBeNull()
    }
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
})
