// src/hooks/useProposalAutosave.js
//
// Owns saving ONE proposal draft: a thin wrapper that gives the generic useDraftAutosave (Prompt 23, F1) the
// Proposals spec — PUT /proposals/<id>/, the Proposals save keys and field rules. Every behaviour (debounce, max wait,
// one request in flight, back-off, 429 pause, 403/404 stop, readiness) lives in useDraftAutosave and is described
// there. Arguments and return value are unchanged from before the promotion.
import useDraftAutosave, {
  AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS, AUTOSAVE_RATE_LIMIT_RETRY_MS, AUTOSAVE_RETRY_DELAYS_MS,
} from '@/hooks/useDraftAutosave'
import {
  SAVE_KEYS, buildSavePayload, diffPayload, errorMessage, fieldErrorsFromResponse, validateForm,
} from '@/pages/proposalHelpers'

export {
  AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS, AUTOSAVE_RATE_LIMIT_RETRY_MS, AUTOSAVE_RETRY_DELAYS_MS,
}

const PROPOSAL_SPEC = {
  url: (id) => `/proposals/${id}/`,
  method: 'put',
  saveKeys: SAVE_KEYS,
  buildSavePayload,
  diffPayload,
  validateForm,
  fieldErrorsFromResponse,
  errorMessage,
}

/**
 * @param {object} args
 * @param {string} args.proposalId
 * @param {object|null} args.form - current editor form (see proposalToForm)
 * @param {object} args.initialSnapshot - buildSavePayload() of what the server holds right now
 * @param {boolean} args.enabled - false for a non-draft proposal: nothing is ever scheduled or sent
 * @param {(data: object, sent: object) => void} [args.onSaved] - fresh server detail + the payload that was sent
 * @param {() => void} [args.onNotDraft] - the server said 403: the proposal is no longer a draft
 * @param {() => void} [args.onNotFound] - the server said 404: the proposal was deleted elsewhere
 */
export default function useProposalAutosave({
  proposalId, form, initialSnapshot, enabled, onSaved, onNotDraft, onNotFound,
}) {
  return useDraftAutosave(PROPOSAL_SPEC, { id: proposalId, form, initialSnapshot, enabled, onSaved, onNotDraft, onNotFound })
}
