// src/hooks/useInvoiceAutosave.js
//
// Extracted from InvoiceDetailPanel.jsx (this pass) — the exact same
// race-safe debounced-autosave chain, now shared with NewInvoiceWizard.jsx,
// which needs the identical behavior the moment a brand-new invoice
// crosses the creation threshold and gets a real backend id (see
// NewInvoiceWizard.jsx's own comment on why a shared hook, not a second
// hand-copied implementation, was the right call here — this logic's own
// race-safety was verified once, by deliberately forcing a real network
// race, not something worth re-deriving a second time by hand).
//
// Race-safety, the real mechanism (unchanged from the original): never
// more than one PUT for this invoice in flight at a time, full stop. An
// earlier design used AbortController + a response-version counter
// instead — that looked correct and passed casual testing, but a
// deliberate test (delay one PUT's server-side handling by 2.5s via route
// interception, then fire a second edit+save while it's still "in
// flight") proved it wasn't: aborting a request only stops the *client*
// from acting on its response — Django had usually already received and
// would still finish processing the aborted request, so the older write
// could still land in Postgres *after* the newer one, silently
// overwriting it, even though the UI kept showing the newer value.
// Strict serialization fixes this at the only place it can actually be
// fixed: never let a second request exist for the server to reorder in
// the first place. If a save is requested while one is already in
// flight, this remembers only the latest form (coalescing, not queueing
// every intermediate change) and sends it the instant the in-flight one
// finishes.
import { useEffect, useRef, useState } from 'react'
import api from '@/lib/api'
import { formToPayload } from '@/pages/invoiceHelpers'

/**
 * @param {string|null} invoiceId - null disables autosave entirely (used
 *   by NewInvoiceWizard before the creation threshold is crossed).
 * @param {object|null} form - current form state; a debounced save fires
 *   ~700ms after the last change.
 * @param {boolean} enabled - an additional gate beyond invoiceId (e.g.
 *   InvoiceDetailPanel only autosaves while status === 'draft').
 * @param {(data: object) => void} [onSaved] - called with the fresh
 *   server row after each successful save — callers that display any
 *   server-derived field outside the form itself (e.g. InvoiceDetailPanel's
 *   header shows invoice.invoice_number/client_name from the `invoice`
 *   state object, not `form`) need this to stay live; the hook itself
 *   deliberately holds no `invoice` object of its own.
 */
export default function useInvoiceAutosave(invoiceId, form, enabled, onSaved) {
  const [saveState, setSaveState] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [saveErrors, setSaveErrors] = useState({})
  const saveTimerRef = useRef(null)
  const skipNextAutosaveRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const nextFormToSaveRef = useRef(null)
  const saveTailRef = useRef(Promise.resolve(null))

  useEffect(() => {
    if (!form || !invoiceId || !enabled) return
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return }
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { saveTimerRef.current = null; triggerSave(form) }, 700)
    return () => clearTimeout(saveTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, invoiceId, enabled])

  function triggerSave(currentForm) {
    nextFormToSaveRef.current = currentForm
    if (!saveInFlightRef.current) {
      saveTailRef.current = runSaveChain()
    }
    return saveTailRef.current
  }

  async function runSaveChain() {
    let last = null
    while (nextFormToSaveRef.current) {
      const toSave = nextFormToSaveRef.current
      nextFormToSaveRef.current = null
      saveInFlightRef.current = true
      last = await performSave(toSave)
      saveInFlightRef.current = false
    }
    return last
  }

  async function performSave(currentForm) {
    setSaveState('saving')
    try {
      const { data } = await api.put(`/invoices/${invoiceId}/`, formToPayload(currentForm))
      setSaveErrors({})
      setSaveState('saved')
      onSaved?.(data)
      return data
    } catch (e) {
      const body = e.response?.data
      if (body && typeof body === 'object') {
        setSaveErrors(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])))
      }
      setSaveState('error')
      return null
    }
  }

  // Flushes a pending (not-yet-fired) debounced save immediately — called
  // before any lifecycle action so finalise/mark-sent/duplicate/save-as-
  // preset always act on the latest typed content. Returns the fresh
  // invoice row when a flush actually ran, or null when nothing was
  // pending.
  async function flushPendingSave() {
    const hadPendingTimer = !!saveTimerRef.current
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    if (hadPendingTimer && form) return triggerSave(form)
    return saveTailRef.current
  }

  // Call once right after a fresh GET/POST populates `form` from server
  // data, so the very next `form` change (the load itself) doesn't
  // trigger a pointless autosave PUT of data that just came from the server.
  function skipNextAutosave() {
    skipNextAutosaveRef.current = true
  }

  return { saveState, saveErrors, setSaveErrors, flushPendingSave, skipNextAutosave }
}
