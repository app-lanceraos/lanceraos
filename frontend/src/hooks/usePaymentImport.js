// src/hooks/usePaymentImport.js
//
// The whole flow of the payment import dialog, so the step components stay presentational (Prompt 13).
//
// Facts about the server this hook is built around (apps/payments/views_import.py):
//   - It is STATELESS. A preview uploads the file and returns the plan; the commit uploads THE SAME FILE AGAIN with the
//     person's choices and the server rebuilds the plan from the bytes. So the browser keeps the `File` for the whole
//     dialog and re-sends it.
//   - A preview is rate limited (20 an hour): it only ever runs on an explicit button, never on a keystroke or a change.
//   - The commit sends the `mapping` object EXACTLY as the latest preview returned it, plus that response's fingerprint.
//     Only the Columns form builds a mapping, and its result always goes through one more preview before it can commit.
//   - A commit is made safe by the server (fingerprint, one transaction), so the UI never retries it on its own. A 409
//     re-checks the file once and returns to Review with a notice; a dropped connection stays on Review and the person
//     presses Import again.
//
// Guards: a request counter makes a late answer to an older request ignored, unmounting bumps it so nothing sets state
// afterwards, and a ref lock makes a double click on Import send ONE request.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { commitImport, previewFile, undoBatch } from '@/pages/paymentImportApi'
import {
  PLAN_CHANGED_NOTICE, ROWS_PER_VIEW, STEP, clearSelection, draftToMapping, importErrorCode, importErrorMessage,
  includeRows, initialSelection, isPlanConflict, selectAllReady, toggleRow, validateFile, validateMappingDraft,
} from '@/pages/paymentImportHelpers'

const INITIAL = {
  step: STEP.FILE,
  file: null,
  fileProblem: '',
  source: '',
  plan: null,
  selection: new Set(),
  filter: 'all',
  shown: ROWS_PER_VIEW,
  busy: null, // 'check' | 'commit' | 'undo' | null
  error: '',
  notice: '',
  columnErrors: {},
  batch: null,
  undoResult: null,
  confirmingUndo: false,
}

export default function usePaymentImport({ onImported, onUndone } = {}) {
  const [state, setState] = useState(INITIAL)
  const ref = useRef(state)
  const alive = useRef(true)
  const requestId = useRef(0)
  const commitLock = useRef(false)
  const undoLock = useRef(false)
  // The mapping the latest preview REQUEST used (undefined for a plain check), so a re-check repeats the same inputs.
  const previewMapping = useRef(undefined)
  const callbacks = useRef({ onImported, onUndone })
  callbacks.current = { onImported, onUndone }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      requestId.current += 1
    }
  }, [])

  const patch = useCallback((changes) => {
    if (!alive.current) return
    ref.current = { ...ref.current, ...changes }
    setState(ref.current)
  }, [])

  // One preview. Returns true when the answer was applied, false when it failed or was superseded.
  const runPreview = useCallback(async ({ file, source, mapping, notice = '' }) => {
    const id = ++requestId.current
    patch({ busy: 'check', error: '', columnErrors: {} })
    previewMapping.current = mapping
    try {
      const plan = await previewFile({ file, source, mapping })
      if (id !== requestId.current || !alive.current) return false
      if (plan.needs_mapping) {
        patch({ plan, source, step: STEP.COLUMNS, selection: clearSelection(), busy: null, notice })
      } else {
        patch({
          plan, source, step: STEP.REVIEW, selection: initialSelection(plan.rows), filter: 'all', shown: ROWS_PER_VIEW,
          busy: null, notice,
        })
      }
      return true
    } catch (error) {
      if (id !== requestId.current || !alive.current) return false
      patch({ busy: null, error: importErrorMessage(error) })
      return false
    }
  }, [patch])

  const actions = useMemo(() => ({
    chooseFile(file) {
      if (!file) { patch({ file: null, fileProblem: '', plan: null }); return }
      const check = validateFile(file)
      if (!check.ok) { patch({ file: null, fileProblem: check.message, plan: null, error: '' }); return }
      patch({ file, fileProblem: '', plan: null, error: '' })
    },

    setSource(source) {
      patch({ source, error: '' })
    },

    check() {
      const { file, source, busy } = ref.current
      if (busy || !file || !source) return Promise.resolve(false)
      return runPreview({ file, source })
    },

    applyMapping(draft) {
      const { file, source, plan, busy } = ref.current
      if (busy || !file || !plan) return Promise.resolve(false)
      const currentHeaderRow = plan.mapping?.header_row ? String(plan.mapping.header_row) : ''
      // While the header row is being changed the old list of headers no longer describes the file.
      const headers = String(draft.headerRow ?? '').trim() === currentHeaderRow ? plan.headers : null
      const result = validateMappingDraft(draft, headers)
      if (!result.ok) { patch({ columnErrors: result.errors, error: '' }); return Promise.resolve(false) }
      return runPreview({ file, source, mapping: draftToMapping(draft) })
    },

    changeColumns() {
      patch({ step: STEP.COLUMNS, error: '', columnErrors: {}, notice: '' })
    },

    useWise() {
      const { file, busy } = ref.current
      if (busy || !file) return Promise.resolve(false)
      return runPreview({ file, source: 'wise' })
    },

    toggle(number) {
      const { plan, selection } = ref.current
      if (!plan) return
      patch({ selection: toggleRow(selection, plan.rows, number) })
    },
    selectReady() {
      const { plan } = ref.current
      if (plan) patch({ selection: selectAllReady(plan.rows) })
    },
    clear() {
      patch({ selection: clearSelection() })
    },
    setFilter(filter) {
      patch({ filter, shown: ROWS_PER_VIEW })
    },
    showMore() {
      patch({ shown: ref.current.shown + ROWS_PER_VIEW })
    },

    async commit() {
      if (commitLock.current) return
      const { file, source, plan, selection } = ref.current
      if (!file || !plan || plan.needs_mapping || !source) return
      const rows = includeRows(selection, plan.rows)
      if (rows.length === 0) return
      commitLock.current = true
      patch({ busy: 'commit', error: '', notice: '' })
      try {
        const { batch } = await commitImport({
          file, source, mapping: plan.mapping, fingerprint: plan.plan_fingerprint, includeRows: rows,
        })
        if (!alive.current) return
        patch({ batch, step: STEP.DONE, busy: null, undoResult: null, confirmingUndo: false })
        callbacks.current.onImported?.(batch)
      } catch (error) {
        if (!alive.current) return
        if (isPlanConflict(error)) {
          // Exactly one re-check, with the inputs of the preview the person was looking at.
          const ok = await runPreview({ file, source, mapping: previewMapping.current, notice: PLAN_CHANGED_NOTICE })
          if (!ok && alive.current && ref.current.busy === 'check') patch({ busy: null })
        } else {
          patch({ busy: null, error: importErrorMessage(error, { commit: true }) })
        }
      } finally {
        commitLock.current = false
      }
    },

    askUndo() { patch({ confirmingUndo: true, error: '' }) },
    cancelUndo() { patch({ confirmingUndo: false }) },

    async undo() {
      const { batch } = ref.current
      if (undoLock.current || !batch) return
      undoLock.current = true
      patch({ busy: 'undo', error: '' })
      try {
        const result = await undoBatch(batch.id)
        if (!alive.current) return
        patch({ undoResult: { removed: result.removed, kept: result.kept }, confirmingUndo: false, busy: null })
        callbacks.current.onUndone?.()
      } catch (error) {
        if (!alive.current) return
        // Nothing left to remove is not a failure the person can act on: show the server's own sentence.
        patch({ busy: null, confirmingUndo: importErrorCode(error) === 'nothing_to_undo' ? false : ref.current.confirmingUndo, error: importErrorMessage(error) })
      } finally {
        undoLock.current = false
      }
    },

    again() {
      requestId.current += 1
      patch({
        step: STEP.FILE, file: null, fileProblem: '', plan: null, selection: clearSelection(), filter: 'all', shown: ROWS_PER_VIEW,
        busy: null, error: '', notice: '', columnErrors: {}, batch: null, undoResult: null, confirmingUndo: false,
      })
    },

    back() {
      const { step, plan } = ref.current
      if (step === STEP.COLUMNS) {
        patch({ step: plan && (plan.rows || []).length > 0 ? STEP.REVIEW : STEP.FILE, error: '', columnErrors: {} })
      } else if (step === STEP.REVIEW) {
        patch({ step: STEP.FILE, error: '', notice: '' })
      }
    },

    reset() {
      requestId.current += 1
      ref.current = INITIAL
      if (alive.current) setState(INITIAL)
    },
  }), [patch, runPreview])

  return { state, actions }
}
