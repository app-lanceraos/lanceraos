// src/lib/designEditor/constants.test.js
//
// Phase 5.1 client-side bounds clamp — deterministic coverage for
// clampToBoundsMm, the ONE shared implementation drag-commit (mouseup),
// keyboard nudge, and resize (componentTypes.js's resizableConfig) all
// call, so it mirrors design_schema.py's own _validate_page_bounds
// exactly: x >= -epsilon, y >= -epsilon, x + width <= boundW + epsilon —
// no bottom-edge (y + height) ceiling, since the backend deliberately
// has none either (content may legitimately flow onto a second page).
// The epsilon tolerance itself (OVERLAP_EPSILON_MM) must match the
// backend's own value exactly — a stricter client-side bound would
// disagree with the backend in the other direction, moving/shrinking an
// element the backend was always going to accept unchanged.
//
// 'position' mode covers drag/nudge (only x/y move); 'resize' mode
// covers resize (width shrinks to fit, x/y never repositioned to
// compensate). Values below are in mm to match the drag/nudge call
// sites directly — the resize call site passes px instead, but the
// function is unit-agnostic (pure ratio/comparison math), so the same
// assertions apply regardless of unit.
import { describe, expect, it } from 'vitest'

import { OVERLAP_EPSILON_MM, clampToBoundsMm } from './constants'

describe('clampToBoundsMm', () => {
  it('leaves an already-in-bounds rect untouched, both modes', () => {
    const rect = { x: 10, y: 10, width: 50, height: 20 }
    expect(clampToBoundsMm(rect, 174, 'position')).toEqual(rect)
    expect(clampToBoundsMm(rect, 174, 'resize')).toEqual(rect)
  })

  it('returns the rect unchanged when boundWMm is null/undefined (no page loaded yet)', () => {
    const rect = { x: 999, y: 999, width: 50, height: 20 }
    expect(clampToBoundsMm(rect, null, 'position')).toEqual(rect)
    expect(clampToBoundsMm(rect, undefined, 'resize')).toEqual(rect)
  })

  describe('position mode (drag/nudge) — right edge', () => {
    it('pulls x back so x + width never exceeds bound + epsilon, width unchanged', () => {
      // The mandatory table case from the live audit: width already
      // equals the full 174mm content area (174.1mm, 0.1mm over — itself
      // within OVERLAP_EPSILON_MM of the bound, which the backend
      // accepts unchanged), nudged right by 5.3mm.
      const result = clampToBoundsMm({ x: 5.3, y: 20.1, width: 174.1, height: 45 }, 174, 'position')
      expect(result.width).toBe(174.1) // never touched in position mode
      expect(result.x + result.width).toBeLessThanOrEqual(174 + OVERLAP_EPSILON_MM + 1e-9)
      expect(result.x).toBeCloseTo(174 + OVERLAP_EPSILON_MM - 174.1) // pinned to the tightest legal x given its own width
    })

    it('does NOT move an element already within epsilon tolerance of the bound — matches the backend accepting it unchanged', () => {
      // width=174.1 at x=0 is exactly the live audit's own pre-nudge
      // state: 0.1mm over a 174mm bound, which _validate_page_bounds
      // accepts (174.1 is not > 174 + 0.3). The clamp must not "fix"
      // something the backend was never going to reject.
      const result = clampToBoundsMm({ x: 0, y: 20.1, width: 174.1, height: 45 }, 174, 'position')
      expect(result.x).toBe(0)
    })
  })

  describe('position mode (drag/nudge) — left/top edges', () => {
    it('clamps x to -epsilon (never further) when dragged well past the left edge', () => {
      const result = clampToBoundsMm({ x: -12, y: 5, width: 40, height: 10 }, 174, 'position')
      expect(result.x).toBe(-OVERLAP_EPSILON_MM)
    })
    it('does not touch x when already within epsilon of the left edge', () => {
      const result = clampToBoundsMm({ x: -0.1, y: 5, width: 40, height: 10 }, 174, 'position')
      expect(result.x).toBe(-0.1)
    })
    it('clamps y to -epsilon when dragged past the top edge', () => {
      const result = clampToBoundsMm({ x: 5, y: -3, width: 40, height: 10 }, 174, 'position')
      expect(result.y).toBe(-OVERLAP_EPSILON_MM)
    })
    it('never enforces a bottom-edge ceiling — a tall/low element is left alone', () => {
      // Mirrors design_schema.py's _validate_page_bounds deliberately
      // having no y + height check (content may flow onto a second page).
      const result = clampToBoundsMm({ x: 5, y: 5000, width: 40, height: 10 }, 174, 'position')
      expect(result.y).toBe(5000)
    })
  })

  describe('resize mode — right edge', () => {
    it('shrinks width to fit (allowing the same epsilon slack), never repositions x', () => {
      const result = clampToBoundsMm({ x: 100, y: 20, width: 120, height: 45 }, 174, 'resize')
      expect(result.x).toBe(100) // untouched — resize doesn't relocate the element
      expect(result.width).toBeCloseTo(174 + OVERLAP_EPSILON_MM - 100)
    })
    it('leaves height untouched (no bottom-edge ceiling in resize mode either)', () => {
      const result = clampToBoundsMm({ x: 10, y: 20, width: 300, height: 900 }, 174, 'resize')
      expect(result.height).toBe(900)
    })
  })

  describe('resize mode — left/top edges', () => {
    it('clamps x to -epsilon when a left-handle drag pushes it well negative, then bounds width from there', () => {
      const result = clampToBoundsMm({ x: -10, y: 5, width: 190, height: 10 }, 174, 'resize')
      expect(result.x).toBe(-OVERLAP_EPSILON_MM)
      expect(result.width).toBeCloseTo(Math.min(190, 174 + OVERLAP_EPSILON_MM - -OVERLAP_EPSILON_MM))
    })
    it('clamps y to -epsilon on resize too', () => {
      const result = clampToBoundsMm({ x: 5, y: -8, width: 40, height: 10 }, 174, 'resize')
      expect(result.y).toBe(-OVERLAP_EPSILON_MM)
    })
  })

  describe('sidebar bound (a narrower boundWMm, e.g. a sidebar-flagged element)', () => {
    it('bounds against the passed-in width regardless of the main content width', () => {
      const sidebarBoundMm = 50
      const result = clampToBoundsMm({ x: 20, y: 5, width: 40, height: 10 }, sidebarBoundMm, 'position')
      expect(result.x).toBeCloseTo(sidebarBoundMm + OVERLAP_EPSILON_MM - 40) // not bounded against a 174mm content area
    })
  })
})
