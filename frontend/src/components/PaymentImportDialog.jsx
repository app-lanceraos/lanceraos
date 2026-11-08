// src/components/PaymentImportDialog.jsx
//
// The payment import dialog (Prompt 13): choose a file, optionally check the columns, review every row, import, undo.
// A wide PaymentDialog, full-screen at <= 768 px, NOT a routed page (the app uses BrowserRouter, which has no useBlocker to
// guard leaving mid-review, and a route would lose the File on reload anyway). All of the flow lives in
// hooks/usePaymentImport.js; the four steps are presentational.
//
// Focus: the dialog's own title is the step heading and takes focus whenever the step CHANGES (a ref lookup and an
// effect that compares with the previous step — never `autoFocus`), so a keyboard or screen-reader user is not left on a button that has
// disappeared. Closing on Columns/Review asks first; Escape and the X are ignored while a request runs (PaymentDialog).
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import FosAlert from './FosAlert'
import { PaymentDialog } from './PaymentDialog'
import PaymentImportColumns from './PaymentImportColumns'
import PaymentImportDone from './PaymentImportDone'
import PaymentImportFileStep from './PaymentImportFileStep'
import PaymentImportHistory from './PaymentImportHistory'
import PaymentImportReview from './PaymentImportReview'
import usePaymentImport from '@/hooks/usePaymentImport'
import usePaymentImportBatches from '@/hooks/usePaymentImportBatches'
import { STEP, STEP_TITLES, importedSummaryText } from '@/pages/paymentImportHelpers'

// The shared dialog overlay is z-index 200 inside AppShell's main frame, which is itself a stacking context (z-index 1):
// UNDER the desktop sidebar (250), the header (350) and the mobile drawer (400). That never mattered for the narrow
// dialogs, but this one is 980 px wide (it covered the tick-box column of the table at 1280 px) and full-screen on a
// phone (the header covered its title and close button) — found in browser verification, 08 November 2026. So it is
// rendered through a portal to <body> and its own overlay class (ours, not the shared frame's) sits above all of them.
const RESPONSIVE_CSS = `
  .pay-import-overlay { z-index: 600 !important; }
  .pay-import-cards { display: none; }
  @media (max-width: 768px) {
    .pay-import-overlay { padding: 0 !important; align-items: stretch !important; }
    .pay-import-card {
      height: 100vh; height: 100dvh; max-width: none !important; max-height: none !important;
      border-radius: 0 !important; padding: 18px 16px !important;
    }
    .pay-import-table { display: none !important; }
    .pay-import-cards { display: flex !important; }
    .pay-import-grid { grid-template-columns: 1fr !important; }
    .pay-import-bar { bottom: -18px !important; margin-left: -16px !important; margin-right: -16px !important; margin-bottom: -18px !important; padding: 12px 16px !important; }
  }
`

export default function PaymentImportDialog({ currencies, onImported, onUndone, onClose }) {
  // The history list is created first so the import flow can reload it: a finished import or undo changes what "Past
  // imports" must show (Prompt 15, Part 0). The history's OWN undo passes the page callback unwrapped; it reloads itself.
  const history = usePaymentImportBatches({ onUndone })
  const { load: reloadHistory } = history
  const { state, actions } = usePaymentImport({
    onImported: (batch) => { onImported?.(batch); reloadHistory() },
    onUndone: () => { onUndone?.(); reloadHistory() },
  })
  const requestBusy = Boolean(state.busy) || history.busyId !== null
  const [leaving, setLeaving] = useState(false)
  const rootRef = useRef(null)
  // The step the heading focus last ran for. A "first render" boolean flag is NOT safe here: React StrictMode runs mount
  // effects twice, which used up the flag and sent focus to the heading instead of the source select (found in browser
  // verification, 08 November 2026).
  const focusedStep = useRef(STEP.FILE)
  const keepRef = useRef(null)
  const { step, batch, undoResult } = state

  // Move focus to the step heading (the dialog's own title) whenever the step changes after the first render.
  useEffect(() => {
    if (focusedStep.current === step) return
    focusedStep.current = step
    const dialog = rootRef.current?.closest('[role="dialog"]')
    const heading = dialog ? document.getElementById(dialog.getAttribute('aria-labelledby')) : null
    if (heading) {
      heading.setAttribute('tabindex', '-1')
      heading.style.outline = 'none'
      heading.focus()
    }
  }, [step])

  useEffect(() => { if (step === STEP.COLUMNS) currencies.ensureLoaded() }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // Whenever the file step is shown AGAIN (Import another file, Back, Choose another file) the list is reloaded; the rows
  // already on screen stay until the answer arrives.
  const previousStep = useRef(STEP.FILE)
  useEffect(() => {
    if (step === STEP.FILE && previousStep.current !== STEP.FILE) reloadHistory()
    previousStep.current = step
  }, [step, reloadHistory])

  useEffect(() => { if (leaving) keepRef.current?.focus() }, [leaving])
  useEffect(() => { setLeaving(false) }, [step])

  // After a finished import the page flashes what was added, unless the person has just undone it.
  const finish = useCallback(() => {
    onClose(step === STEP.DONE && batch && !undoResult ? importedSummaryText(batch) : undefined)
  }, [onClose, step, batch, undoResult])

  const requestClose = useCallback(() => {
    if (step === STEP.REVIEW || step === STEP.COLUMNS) { setLeaving((value) => !value); return }
    finish()
  }, [step, finish])

  return createPortal((
    <PaymentDialog
      title={STEP_TITLES[step]} busy={requestBusy} onClose={requestClose} maxWidth={980} initialFocus="select"
      overlayClassName="pay-import-overlay" cardClassName="pay-import-card"
    >
      <div ref={rootRef}>
        {leaving && (
          <div role="alert" style={{ position: 'sticky', top: 0, zIndex: 3, marginBottom: 12 }}>
            <FosAlert type="warning">
              <span style={{ display: 'block', marginBottom: 8 }}>Leave without importing? Your choices on this screen will be lost.</span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button ref={keepRef} type="button" className="fos-btn fos-btn-ghost" onClick={() => setLeaving(false)}>Keep reviewing</button>
                <button type="button" className="fos-btn fos-btn-danger" onClick={() => onClose()} disabled={requestBusy}>Leave</button>
              </span>
            </FosAlert>
          </div>
        )}

        {step === STEP.FILE && (
          <>
            <PaymentImportFileStep state={state} actions={actions} />
            <PaymentImportHistory history={history} />
          </>
        )}
        {step === STEP.COLUMNS && <PaymentImportColumns state={state} actions={actions} currencies={currencies} />}
        {step === STEP.REVIEW && <PaymentImportReview state={state} actions={actions} />}
        {step === STEP.DONE && <PaymentImportDone state={state} actions={actions} onViewPayments={finish} />}
      </div>
      <style>{RESPONSIVE_CSS}</style>
    </PaymentDialog>
  ), document.body)
}
