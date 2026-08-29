import { describe, expect, it } from 'vitest'
import { computeAlignedPositions, computeDistributedPositions, snapToGrid } from './alignment'

describe('snapToGrid', () => {
  it('rounds to the nearest 0.5mm by default', () => {
    expect(snapToGrid(10.2)).toBe(10)
    expect(snapToGrid(10.3)).toBe(10.5)
    expect(snapToGrid(10.75)).toBe(11)
  })

  it('supports a custom grid', () => {
    expect(snapToGrid(11, 5)).toBe(10)
    expect(snapToGrid(13, 5)).toBe(15)
  })
})

describe('computeAlignedPositions', () => {
  const els = [
    { x: 10, y: 20, width: 30, height: 10 },
    { x: 50, y: 40, width: 20, height: 5 },
    { x: 5, y: 60, width: 40, height: 8 },
  ]

  it('fewer than 2 elements is a no-op', () => {
    expect(computeAlignedPositions([els[0]], 'left')).toEqual([{}])
    expect(computeAlignedPositions([], 'left')).toEqual([])
  })

  it('left aligns every element to the shared minimum x', () => {
    const result = computeAlignedPositions(els, 'left')
    expect(result).toEqual([{ x: 5 }, { x: 5 }, { x: 5 }])
  })

  it('right aligns every element\'s own right edge to the shared max right edge', () => {
    // max right edge = max(10+30, 50+20, 5+40) = max(40, 70, 45) = 70
    const result = computeAlignedPositions(els, 'right')
    expect(result[0].x).toBe(40) // 70 - 30
    expect(result[1].x).toBe(50) // 70 - 20
    expect(result[2].x).toBe(30) // 70 - 40
  })

  it('center-h centers every element on the shared horizontal midpoint', () => {
    // minX=5, maxRight=70 -> centerX = 37.5
    const result = computeAlignedPositions(els, 'center-h')
    expect(result[0].x).toBe(22.5) // 37.5 - 30/2
    expect(result[1].x).toBe(27.5) // 37.5 - 20/2
    expect(result[2].x).toBe(17.5) // 37.5 - 40/2
  })

  it('top aligns every element to the shared minimum y', () => {
    const result = computeAlignedPositions(els, 'top')
    expect(result).toEqual([{ y: 20 }, { y: 20 }, { y: 20 }])
  })

  it('bottom aligns every element\'s own bottom edge to the shared max bottom edge', () => {
    // max bottom = max(20+10, 40+5, 60+8) = max(30, 45, 68) = 68
    const result = computeAlignedPositions(els, 'bottom')
    expect(result[0].y).toBe(58) // 68 - 10
    expect(result[1].y).toBe(63) // 68 - 5
    expect(result[2].y).toBe(60) // 68 - 8
  })

  it('middle-v centers every element on the shared vertical midpoint', () => {
    // minY=20, maxBottom=68 -> centerY = 44
    const result = computeAlignedPositions(els, 'middle-v')
    expect(result[0].y).toBe(39) // 44 - 10/2
    expect(result[1].y).toBe(41.5) // 44 - 5/2
    expect(result[2].y).toBe(40) // 44 - 8/2
  })

  it('only ever returns x OR y, never both', () => {
    for (const mode of ['left', 'right', 'center-h', 'top', 'bottom', 'middle-v']) {
      const result = computeAlignedPositions(els, mode)
      for (const entry of result) {
        const keys = Object.keys(entry)
        expect(keys.length).toBe(1)
      }
    }
  })

  it('rejects an unknown mode rather than silently doing nothing', () => {
    expect(() => computeAlignedPositions(els, 'made-up')).toThrow()
  })
})

describe('computeDistributedPositions', () => {
  it('fewer than 3 elements is a no-op', () => {
    expect(computeDistributedPositions([{ x: 0, width: 10 }, { x: 20, width: 10 }], 'horizontal')).toEqual([{}, {}])
  })

  it('evenly spaces the gap between 3 horizontally scattered elements, leaving the two ends untouched', () => {
    // Span: leftmost starts at 0, rightmost ends at 0+10 .. 100+10=110 -> total span 110.
    // Sizes: 10 + 10 + 10 = 30. Gap = (110 - 30) / 2 = 40.
    const els = [
      { x: 0, width: 10 }, // leftmost — untouched
      { x: 55, width: 10 }, // middle — moves
      { x: 100, width: 10 }, // rightmost — untouched
    ]
    const result = computeDistributedPositions(els, 'horizontal')
    expect(result[0]).toEqual({}) // leftmost never moves
    expect(result[2]).toEqual({}) // rightmost never moves
    expect(result[1].x).toBe(50) // 0 + 10 (first width) + 40 (gap)
  })

  it('works regardless of input order (sorts internally by position)', () => {
    const els = [
      { x: 100, width: 10 }, // rightmost, listed first
      { x: 0, width: 10 }, // leftmost, listed second
      { x: 55, width: 10 }, // middle, listed third
    ]
    const result = computeDistributedPositions(els, 'horizontal')
    expect(result[0]).toEqual({}) // rightmost (by position, not list order)
    expect(result[1]).toEqual({}) // leftmost
    expect(result[2].x).toBe(50) // middle, same result as the sorted case
  })

  it('distributes vertically using y/height instead of x/width', () => {
    const els = [
      { y: 0, height: 10 },
      { y: 55, height: 10 },
      { y: 100, height: 10 },
    ]
    const result = computeDistributedPositions(els, 'vertical')
    expect(result[1].y).toBe(50)
  })
})
