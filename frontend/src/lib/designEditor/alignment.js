// src/lib/designEditor/alignment.js
//
// Green-Light directive — "Multi-select, alignment/snapping." Pure,
// unit-testable position math for aligning 2+ selected elements, kept
// deliberately separate from any live GrapesJS/canvas interaction: this
// codebase's own componentTypes.js documents multiple real, hard-to-find
// drag/resize bugs that needed a genuine live browser to catch — with no
// live browser available in this environment, the safe, verifiable
// choice is to keep "multi-select" a Layers-panel checkbox list (pure
// React state, no canvas click/shift-key interaction) and apply the
// result through `comp.addStyle()`, the same already-trusted,
// already-tested API this codebase's keyboard-nudge feature already uses
// for programmatic position changes — never through the undocumented,
// live-verified-only drag/resize commit paths.
//
// "Snapping" here means snap-to-grid on the ALIGNED result (rounding to
// SNAP_MM), not live drag-time snap guides — the latter would require
// touching the exact fragile drag/resize interaction code this file
// deliberately avoids.

export const SNAP_MM = 0.5

export function snapToGrid(value, gridMm = SNAP_MM) {
  return Math.round(value / gridMm) * gridMm
}

/**
 * Computes new {x, y} (only the changed axis) for each of `elements` so
 * they align per `mode`. `elements`: [{x, y, width, height}, ...] (any
 * extra fields pass through untouched — callers can carry an id/index
 * alongside). Returns a NEW array, same order/length as the input,
 * `{ x }` or `{ y }` only (never both) — the caller decides how to apply
 * it (e.g. merge into its own richer objects).
 *
 * Modes:
 *   left / center-h / right   — horizontal, based on the SHARED
 *                                 min-x / horizontal-center / max-right
 *                                 across every element in the set.
 *   top / middle-v / bottom   — vertical, same idea on the y axis.
 */
export function computeAlignedPositions(elements, mode) {
  if (elements.length < 2) return elements.map(() => ({}))

  if (mode === 'left') {
    const targetX = snapToGrid(Math.min(...elements.map((el) => el.x)))
    return elements.map(() => ({ x: targetX }))
  }
  if (mode === 'right') {
    const targetRight = Math.max(...elements.map((el) => el.x + el.width))
    return elements.map((el) => ({ x: snapToGrid(targetRight - el.width) }))
  }
  if (mode === 'center-h') {
    const minX = Math.min(...elements.map((el) => el.x))
    const maxRight = Math.max(...elements.map((el) => el.x + el.width))
    const centerX = (minX + maxRight) / 2
    return elements.map((el) => ({ x: snapToGrid(centerX - el.width / 2) }))
  }
  if (mode === 'top') {
    const targetY = snapToGrid(Math.min(...elements.map((el) => el.y)))
    return elements.map(() => ({ y: targetY }))
  }
  if (mode === 'bottom') {
    const targetBottom = Math.max(...elements.map((el) => el.y + el.height))
    return elements.map((el) => ({ y: snapToGrid(targetBottom - el.height) }))
  }
  if (mode === 'middle-v') {
    const minY = Math.min(...elements.map((el) => el.y))
    const maxBottom = Math.max(...elements.map((el) => el.y + el.height))
    const centerY = (minY + maxBottom) / 2
    return elements.map((el) => ({ y: snapToGrid(centerY - el.height / 2) }))
  }
  throw new Error(`Unknown alignment mode "${mode}".`)
}

/**
 * Evenly spaces 3+ elements between the leftmost and rightmost (or
 * topmost/bottommost) member's own outer edge — the two end members
 * never move; only the ones between them do. Real "distribute" semantics
 * (equal GAP between elements, not equal center-to-center spacing),
 * matching every mainstream design tool's own convention. Returns `[]`
 * (a no-op) for fewer than 3 elements — distribution has no meaning for 2.
 */
export function computeDistributedPositions(elements, axis) {
  if (elements.length < 3) return elements.map(() => ({}))

  const sizeKey = axis === 'horizontal' ? 'width' : 'height'
  const posKey = axis === 'horizontal' ? 'x' : 'y'
  const indexed = elements.map((el, i) => ({ ...el, _i: i }))
  const sorted = [...indexed].sort((a, b) => a[posKey] - b[posKey])

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const totalSpan = (last[posKey] + last[sizeKey]) - first[posKey]
  const totalSize = sorted.reduce((sum, el) => sum + el[sizeKey], 0)
  const gap = (totalSpan - totalSize) / (sorted.length - 1)

  const results = new Array(elements.length).fill(null).map(() => ({}))
  let cursor = first[posKey]
  sorted.forEach((el, i) => {
    if (i === 0 || i === sorted.length - 1) {
      cursor += el[sizeKey] + gap
      return
    }
    results[el._i] = { [posKey]: snapToGrid(cursor) }
    cursor += el[sizeKey] + gap
  })
  return results
}
