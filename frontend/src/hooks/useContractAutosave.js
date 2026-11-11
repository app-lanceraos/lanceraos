// src/hooks/useContractAutosave.js
//
// Owns saving ONE contract draft: a thin wrapper that gives the generic useDraftAutosave (Prompt 23, F1) the Contracts spec —
// PATCH /contracts/<id>/, the contract save keys and field rules. The snapshot is what was SENT (never what the server
// returned), so the server's trimming of a title or a section can never cause a re-save loop. Both 403 (the draft-only
// refusal on PATCH) and 409 mean "this is no longer a draft".
import useDraftAutosave from '@/hooks/useDraftAutosave'
import {
  SAVE_KEYS, buildSavePayload, diffPayload, errorMessage, fieldErrorsFromResponse, validateForm,
} from '@/pages/contractHelpers'

const CONTRACT_SPEC = {
  url: (id) => `/contracts/${id}/`,
  method: 'patch',
  saveKeys: SAVE_KEYS,
  buildSavePayload,
  diffPayload,
  validateForm,
  fieldErrorsFromResponse,
  errorMessage,
  notDraftStatuses: [403, 409],
}

/**
 * @param {object} args
 * @param {string} args.contractId
 * @param {object|null} args.form - the editor form (see formFromDetail)
 * @param {object} args.initialSnapshot - buildSavePayload() of what the server holds right now
 * @param {boolean} args.enabled - false for a contract that is not a draft: nothing is ever scheduled or sent
 * @param {(data: object, sent: object) => void} [args.onSaved]
 * @param {() => void} [args.onNotDraft] - the server said the contract is no longer a draft
 * @param {() => void} [args.onNotFound]
 */
export default function useContractAutosave({
  contractId, form, initialSnapshot, enabled, onSaved, onNotDraft, onNotFound,
}) {
  return useDraftAutosave(CONTRACT_SPEC, { id: contractId, form, initialSnapshot, enabled, onSaved, onNotDraft, onNotFound })
}
