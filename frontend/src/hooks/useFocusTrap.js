// src/hooks/useFocusTrap.js
//
// Keeps keyboard focus inside a dialog while it is open and gives it back when
// it closes. A hook, not a shared Modal component: DESIGN.md Section 12 still
// forbids a generic Modal, so each dialog keeps its own markup and only borrows
// this behaviour.
//
// On activation: remember what had focus, move focus to the first focusable
// element inside (or the container itself when there is none — give it
// tabIndex={-1}). Tab / Shift+Tab cycle inside; if focus has escaped (an element
// disabled under the cursor drops focus to <body>) the next Tab pulls it back.
// On deactivation or unmount: restore focus to the remembered element if it is
// still in the document.
import { useEffect } from 'react'

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]'

function focusablesIn(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((el) => (
    !el.disabled
    && el.getAttribute('tabindex') !== '-1'
    && !el.hidden
    && !el.closest('[hidden]')
    && el.getAttribute('aria-hidden') !== 'true'
  ))
}

export default function useFocusTrap(containerRef, active = true) {
  useEffect(() => {
    if (!active) return undefined
    const container = containerRef.current
    if (!container) return undefined

    const previous = document.activeElement
    const initial = focusablesIn(container)[0] || container
    initial.focus()

    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return
      const items = focusablesIn(container)
      if (items.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      const inside = container.contains(current) && current !== container
      if (event.shiftKey) {
        if (!inside || current === first) { event.preventDefault(); last.focus() }
      } else if (!inside || current === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previous && previous !== document.body && document.contains(previous) && typeof previous.focus === 'function') {
        previous.focus()
      }
    }
  }, [active, containerRef])
}
