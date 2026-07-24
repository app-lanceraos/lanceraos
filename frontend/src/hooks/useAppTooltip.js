// src/hooks/useAppTooltip.js
//
// The .app-tooltip CSS (shared singleton, positioned via JS) already
// exists in theme.css. This is the JS half: it binds hover/focus
// listeners to any element with a data-tooltip attribute and positions
// one shared tooltip div beneath it. Call initTooltipBindings() after
// the shell mounts and again after anything that changes which elements
// have data-tooltip (e.g. the sidebar collapse/expand transition).
let tooltipEl = null
let showTimer = null
const HOVER_DELAY_MS = 500

function ensureTooltipEl() {
  if (tooltipEl) return tooltipEl
  tooltipEl = document.createElement('div')
  tooltipEl.className = 'app-tooltip'
  document.body.appendChild(tooltipEl)
  return tooltipEl
}

function positionAndShow(target) {
  const text = target.getAttribute('data-tooltip')
  if (!text) return
  const el = ensureTooltipEl()
  el.textContent = text
  el.classList.add('show')

  const rect = target.getBoundingClientRect()
  const tooltipRect = el.getBoundingClientRect()
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2
  left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8))
  const top = rect.bottom + 8
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

function scheduleShow(target) {
  clearTimeout(showTimer)
  showTimer = setTimeout(() => positionAndShow(target), HOVER_DELAY_MS)
}

function hideTooltip() {
  clearTimeout(showTimer)
  if (tooltipEl) tooltipEl.classList.remove('show')
}

// Browsers throttle setTimeout in background tabs but still fire it once
// the tab regains focus. If the cursor was resting on a tooltip target
// when the tab was switched away from, the pending 500ms timer keeps
// counting (just slowly) and fires almost instantly on return — real
// wall-clock time had already passed the delay while backgrounded. This
// clears any pending/shown tooltip on tab-hide, so returning to the tab
// always requires a fresh hover, not a resumed one.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideTooltip()
  })
}

/**
 * Binds hover/focus listeners to every [data-tooltip] element under
 * `root` that hasn't already been bound. Idempotent — safe to call
 * repeatedly (e.g. after a collapse/expand re-render) without
 * double-binding the same element.
 */
export function initTooltipBindings(root = document) {
  const targets = root.querySelectorAll('[data-tooltip]')
  targets.forEach((target) => {
    if (target.dataset.tooltipBound) return
    target.dataset.tooltipBound = 'true'
    target.addEventListener('mouseenter', () => scheduleShow(target))
    target.addEventListener('mouseleave', hideTooltip)
    target.addEventListener('focus', () => scheduleShow(target))
    target.addEventListener('blur', hideTooltip)
  })
}