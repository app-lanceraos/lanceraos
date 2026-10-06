// src/hooks/useAppTooltip.js
//
// The one tooltip mechanism for every element carrying a `data-tooltip`
// attribute: a single delegated controller, installed ONCE at the app root
// (main.jsx), that drives one shared `.app-tooltip` div (styled in
// theme.css) appended to <body>.
//
// Why delegated instead of binding listeners per element (what this file
// used to do): per-element `mouseenter`/`mouseleave`/`focus`/`blur`
// listeners cannot cover the cases that actually left tooltips stuck on
// screen (see DECISIONS.md, 03 October 2026):
//   - a target that is removed from the DOM while its tooltip is pending or
//     visible (a Close button that unmounts its own panel) never fires
//     `mouseleave`, and Safari/iOS never blur a removed button either;
//   - touch fires compatibility mouse events (`mouseenter`, no
//     `mouseleave`) on a tap, so a tooltip appeared 500ms AFTER the tap and
//     stayed until some other element was tapped;
//   - a tooltip anchored to a position stayed there when the page scrolled,
//     resized, navigated or the user pressed Escape;
//   - the old `initTooltipBindings()` had to be re-run after every render
//     (a full-document `querySelectorAll` per render) to find new targets.
// A controller on `document` needs no per-element setup, so the target
// elements may mount and unmount freely.
//
// Policy: tooltips are for MOUSE/PEN hover and KEYBOARD focus only. Touch
// never shows one — there is no hover on touch, and a tap-to-toggle tooltip
// would be a second interaction model nobody asked for. Because of that, a
// tooltip must never be the only place information lives (STANDARDS.md).
const TOOLTIP_ID = 'app-tooltip'
const HOVER_DELAY_MS = 500
const TARGET_SELECTOR = '[data-tooltip]'

let tooltipEl = null
let showTimer = null
// What the tooltip is for right now. `source` is who is holding it open:
// 'pointer' (a mouse/pen resting on it) or 'focus' (keyboard focus).
let active = null // { target, source, shown, prevDescribedBy }
let observer = null
// Last input modality. Programmatic focus (a modal handing focus back to its
// trigger) must not pop a tooltip nobody asked for, so focus only counts
// while the most recent real interaction was the keyboard.
let keyboardModality = false
let removeListeners = null

function ensureTooltipEl() {
  if (tooltipEl && tooltipEl.isConnected) return tooltipEl
  // Reuse an existing node (hot-module reload, or a second copy of this
  // module) rather than ever leaving two tooltip elements in the page.
  tooltipEl = document.getElementById(TOOLTIP_ID)
  if (!tooltipEl) {
    tooltipEl = document.createElement('div')
    tooltipEl.id = TOOLTIP_ID
    tooltipEl.className = 'app-tooltip'
    tooltipEl.setAttribute('role', 'tooltip')
    document.body.appendChild(tooltipEl)
  }
  return tooltipEl
}

function targetFrom(node) {
  return node instanceof Element ? node.closest(TARGET_SELECTOR) : null
}

function setDescribedBy(target, on) {
  if (on) {
    active.prevDescribedBy = target.getAttribute('aria-describedby')
    const ids = (active.prevDescribedBy || '').split(/\s+/).filter(Boolean)
    if (!ids.includes(TOOLTIP_ID)) ids.push(TOOLTIP_ID)
    target.setAttribute('aria-describedby', ids.join(' '))
  } else if (active.prevDescribedBy == null) {
    target.removeAttribute('aria-describedby')
  } else {
    target.setAttribute('aria-describedby', active.prevDescribedBy)
  }
}

function place(target) {
  const el = ensureTooltipEl()
  const rect = target.getBoundingClientRect()
  const tooltipRect = el.getBoundingClientRect()
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2
  left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8))
  let top = rect.bottom + 8
  // A target near the bottom edge (the fixed bulk-action bar) would push the
  // tooltip off-screen — put it above instead.
  if (top + tooltipRect.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - tooltipRect.height - 8)
  }
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

function startObserving() {
  if (observer || typeof MutationObserver === 'undefined') return
  // Only runs while a tooltip is visible: the moment its target leaves the
  // document (or loses/changes its text) the tooltip follows. This is the
  // self-healing that makes "the element was removed" a non-event.
  observer = new MutationObserver(() => {
    if (!active) return
    const text = active.target.getAttribute('data-tooltip')
    if (!active.target.isConnected || !text) { hide(); return }
    if (tooltipEl && tooltipEl.textContent !== text) {
      tooltipEl.textContent = text
      place(active.target)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tooltip'] })
}

function show() {
  if (!active) return
  const { target } = active
  const text = target.getAttribute('data-tooltip')
  // A detached element reports an all-zero bounding rect, which used to put
  // the tooltip in the top-left corner of the screen.
  if (!target.isConnected || !text) { hide(); return }
  const el = ensureTooltipEl()
  el.textContent = text
  el.classList.add('show')
  place(target)
  setDescribedBy(target, true)
  active.shown = true
  startObserving()
}

function hide() {
  clearTimeout(showTimer)
  showTimer = null
  if (observer) { observer.disconnect(); observer = null }
  if (tooltipEl) tooltipEl.classList.remove('show')
  if (active && active.shown) setDescribedBy(active.target, false)
  active = null
}

function schedule(target, source) {
  if (active && active.target === target && active.source === source) return
  hide()
  active = { target, source, shown: false, prevDescribedBy: null }
  showTimer = setTimeout(() => {
    showTimer = null
    // Validate at show time, not schedule time: the pointer/focus may have
    // moved on during the delay (hide() normally cancels this timer; this is
    // the belt to that brace). show() itself refuses a detached target.
    if (!active || active.target !== target) { hide(); return }
    show()
  }, HOVER_DELAY_MS)
}

function isPointerForTooltips(event) {
  // Touch never shows a tooltip (see the file header). 'mouse' and 'pen'
  // both hover; an unknown/empty pointerType is treated as a mouse.
  return event.pointerType !== 'touch'
}

function installTooltipController() {
  if (removeListeners || typeof document === 'undefined') return

  const onPointerOver = (e) => {
    if (!isPointerForTooltips(e)) return
    const target = targetFrom(e.target)
    if (target) schedule(target, 'pointer')
    else if (active && active.source === 'pointer') hide()
  }
  const onPointerOut = (e) => {
    if (!isPointerForTooltips(e)) return
    if (!active || active.source !== 'pointer') return
    // Moving between children of the same target is not leaving it.
    if (targetFrom(e.relatedTarget) !== active.target) hide()
  }
  // A target that was replaced under a resting pointer (route change, a
  // re-mounted panel) fires no pointerout at all — if the pointer moves
  // anywhere that is not the current target, the tooltip is stale.
  const onPointerMove = (e) => {
    if (!isPointerForTooltips(e) || !active) return
    if (active.source === 'pointer' && targetFrom(e.target) !== active.target) hide()
  }
  const onPointerDown = () => { keyboardModality = false; hide() }
  const onKeyDown = () => { keyboardModality = true; hide() }
  const onFocusIn = (e) => {
    const target = targetFrom(e.target)
    if (!target || !keyboardModality) return
    let focusVisible = true
    try { focusVisible = e.target.matches(':focus-visible') } catch { /* engine without :focus-visible */ }
    if (focusVisible) schedule(target, 'focus')
  }
  const onFocusOut = (e) => {
    if (active && active.source === 'focus' && targetFrom(e.target) === active.target) hide()
  }
  const onVisibility = () => { if (document.hidden) hide() }

  const listeners = [
    [document, 'pointerover', onPointerOver, true],
    [document, 'pointerout', onPointerOut, true],
    [document, 'pointermove', onPointerMove, { capture: true, passive: true }],
    [document, 'pointerdown', onPointerDown, true],
    [document, 'click', hide, true],
    [document, 'keydown', onKeyDown, true],
    [document, 'focusin', onFocusIn, true],
    [document, 'focusout', onFocusOut, true],
    [document, 'touchstart', hide, { capture: true, passive: true }],
    // A scroll never bubbles; capture is what catches the one that happens
    // inside a nested scroller (the invoice panel, a table wrapper).
    [document, 'scroll', hide, { capture: true, passive: true }],
    [document, 'wheel', hide, { capture: true, passive: true }],
    [document, 'visibilitychange', onVisibility, false],
    [window, 'resize', hide, false],
    [window, 'orientationchange', hide, false],
    [window, 'popstate', hide, false],
    [window, 'blur', hide, false],
  ]
  listeners.forEach(([t, type, fn, opts]) => t.addEventListener(type, fn, opts))
  removeListeners = () => {
    listeners.forEach(([t, type, fn, opts]) => t.removeEventListener(type, fn, opts))
    removeListeners = null
  }
}

function uninstallTooltipController() {
  hide()
  keyboardModality = false
  if (removeListeners) removeListeners()
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null }
}

export { installTooltipController, uninstallTooltipController }

// Vite hot-reload re-evaluates this module; without this the OLD module's
// listeners would stay registered next to the new module's.
if (import.meta.hot) import.meta.hot.dispose(uninstallTooltipController)
