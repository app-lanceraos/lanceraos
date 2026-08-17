// src/hooks/useFilterOverflow.js
//
// Real, measured-width overflow detection for a filter pill row (item 5
// of the List/Table restructure — "real measured-width overflow
// detection, not a fixed breakpoint guess"). A caller renders TWO rows:
// a hidden, off-screen measurement row containing every pill (so each
// pill's true intrinsic width is always known, independent of the
// visible container's current width) and the real visible row, which
// only renders `items.slice(0, visibleCount)` plus a "More filters"
// dropdown for the rest. A ResizeObserver on the visible container
// re-measures on every width change (sidebar collapse/expand, window
// resize, breakpoint crossing) — this works correctly for both
// shrinking AND growing back, since the hidden row's intrinsic widths
// never change.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const GAP = 8

export default function useFilterOverflow(itemCount) {
  const containerRef = useRef(null)
  const measureRefs = useRef([])
  const moreRef = useRef(null)
  const [visibleCount, setVisibleCount] = useState(itemCount)

  const measure = useCallback(() => {
    const container = containerRef.current
    if (!container || itemCount === 0) { setVisibleCount(itemCount); return }
    const containerWidth = container.clientWidth
    // A container that measures 0 hasn't really been laid out yet (or
    // layout is unavailable at all, e.g. jsdom in tests) — treat that as
    // "no real measurement", not "nothing fits". Showing everything is
    // the safe default; a genuine narrow-but-nonzero width still
    // overflows correctly below.
    if (containerWidth <= 0) { setVisibleCount(itemCount); return }
    const moreWidth = (moreRef.current?.offsetWidth || 0) + GAP

    let used = 0
    let visible = itemCount
    for (let i = 0; i < itemCount; i++) {
      const el = measureRefs.current[i]
      const w = (el?.offsetWidth || 0) + GAP
      const isLast = i === itemCount - 1
      const reserve = isLast ? 0 : moreWidth
      if (used + w + reserve > containerWidth) { visible = i; break }
      used += w
    }
    setVisibleCount(visible)
  }, [itemCount])

  useLayoutEffect(() => { measure() }, [measure])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(container)
    return () => ro.disconnect()
  }, [measure])

  return { containerRef, measureRefs, moreRef, visibleCount }
}
