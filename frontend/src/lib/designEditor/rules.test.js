// src/lib/designEditor/rules.test.js
import { describe, expect, it } from 'vitest'

import { isPairingValid, isTotalsElementRemovable, pairingStatusMessage } from './rules'

describe('isTotalsElementRemovable — mandatory totals block, UI-level enforcement', () => {
  it('a non-totals element is always removable', () => {
    expect(isTotalsElementRemovable('notes', ['notes', 'totals'])).toBe(true)
    expect(isTotalsElementRemovable('signature', ['signature'])).toBe(true)
  })

  it('the only totals element cannot be removed', () => {
    expect(isTotalsElementRemovable('totals', ['totals'])).toBe(false)
    expect(isTotalsElementRemovable('totals', ['notes', 'totals', 'signature'])).toBe(false)
  })

  it('a totals element CAN be removed while another totals sibling exists (minimal seed has 2)', () => {
    expect(isTotalsElementRemovable('totals', ['totals', 'totals'])).toBe(true)
  })

  it('removing down to the last totals element then blocks further removal', () => {
    // Simulates the real sequence: minimal's 2 totals -> remove one -> the remaining one is now protected.
    const afterFirstRemoval = ['totals'] // one totals element left
    expect(isTotalsElementRemovable('totals', afterFirstRemoval)).toBe(false)
  })
})

describe('pairing rule — live status message + validity, ahead of the backend 400', () => {
  it('0 paired is valid (no pairing attempted)', () => {
    expect(isPairingValid(0)).toBe(true)
    expect(pairingStatusMessage(0)).toMatch(/mark one more/)
  })

  it('1 paired is invalid, with a specific corrective message', () => {
    expect(isPairingValid(1)).toBe(false)
    expect(pairingStatusMessage(1)).toMatch(/needs exactly 2/)
  })

  it('2 paired is valid and ready', () => {
    expect(isPairingValid(2)).toBe(true)
    expect(pairingStatusMessage(2)).toMatch(/ready to save/)
  })

  it('3+ paired is invalid, with a specific "unmark N more" message', () => {
    expect(isPairingValid(3)).toBe(false)
    expect(pairingStatusMessage(3)).toMatch(/unmark 1 more/)
    expect(pairingStatusMessage(4)).toMatch(/unmark 2 more/)
  })
})
