// src/hooks/useFilterOverflow.test.js
//
// Real, measured-width overflow coverage for the filter row (item 5 of
// the List/Table restructure). jsdom never performs real layout — every
// offsetWidth/clientWidth is 0 by default — so this overrides those two
// getters globally to read a `data-w` test attribute instead, letting a
// harness component declare exact pixel widths per element and this
// suite assert the hook's own overflow arithmetic directly, rather than
// only smoke-testing that "the hook doesn't crash" against jsdom's
// always-zero layout.
import { render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import useFilterOverflow from './useFilterOverflow'

function Harness({ itemWidths, containerWidth, moreWidth }) {
  const { containerRef, measureRefs, moreRef, visibleCount } = useFilterOverflow(itemWidths.length)
  return (
    <div>
      <div ref={containerRef} data-w={containerWidth}>
        {itemWidths.map((w, i) => (
          <div key={i} ref={(el) => { measureRefs.current[i] = el }} data-w={w} />
        ))}
      </div>
      <button ref={moreRef} data-w={moreWidth} />
      <div data-testid="visible-count">{visibleCount}</div>
    </div>
  )
}

describe('useFilterOverflow — real measured-width overflow arithmetic', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() { return Number(this.getAttribute('data-w') || 0) },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() { return Number(this.getAttribute('data-w') || 0) },
    })
  })

  afterAll(() => {
    delete HTMLElement.prototype.offsetWidth
    delete HTMLElement.prototype.clientWidth
  })

  it('shows every item when they all fit within the container width', () => {
    render(<Harness itemWidths={[50, 50, 50]} containerWidth={300} moreWidth={80} />)
    expect(screen.getByTestId('visible-count').textContent).toBe('3')
  })

  it('overflows items past the point the row (plus a reserved "More filters" button) no longer fits', () => {
    // Per-item box = 100 + 8 gap = 108. "More" reserve = 80 + 8 gap = 88.
    // i=0: 0+108+88=196 <= 250 -> fits. i=1: 108+108+88=304 > 250 -> stop.
    render(<Harness itemWidths={[100, 100, 100, 100]} containerWidth={250} moreWidth={80} />)
    expect(screen.getByTestId('visible-count').textContent).toBe('1')
  })

  it('the LAST item never reserves room for the More button — it only needs to fit itself', () => {
    // Two 100px items (108 boxed) = 216 exactly. If the last item also
    // reserved 88px for "More", this would overflow (304 > 216) — it
    // must not, since there's nothing left to put in a "More" menu once
    // every item is accounted for.
    render(<Harness itemWidths={[100, 100]} containerWidth={216} moreWidth={80} />)
    expect(screen.getByTestId('visible-count').textContent).toBe('2')
  })

  it('a container too narrow for even the first item overflows everything', () => {
    render(<Harness itemWidths={[100, 100]} containerWidth={50} moreWidth={80} />)
    expect(screen.getByTestId('visible-count').textContent).toBe('0')
  })

  it('zero items never renders a container that needs measuring', () => {
    render(<Harness itemWidths={[]} containerWidth={300} moreWidth={80} />)
    expect(screen.getByTestId('visible-count').textContent).toBe('0')
  })

  it('a generously wide container never overflows', () => {
    render(<Harness itemWidths={[80, 90, 70, 120, 60]} containerWidth={2000} moreWidth={80} />)
    expect(screen.getByTestId('visible-count').textContent).toBe('5')
  })
})
