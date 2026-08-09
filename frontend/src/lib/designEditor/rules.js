// src/lib/designEditor/rules.js
//
// Pure, framework-free versions of the two "real UI affordance, not just a
// save-time 400" rules the task called for — extracted out of
// componentTypes.js (GrapesJS model methods) and ElementSettingsPanel.jsx
// (React) so they're directly unit-testable without a live editor instance
// or a DOM. Both call sites below wrap these.

/**
 * The mandatory-totals-block rule: a 'totals' zone_2 element is only
 * removable while at least one other 'totals' sibling still exists — a
 * live count check, not a static flag, since some real designs (e.g. the
 * minimal builtin seed) legitimately have two.
 */
export function isTotalsElementRemovable(elementType, siblingTypesIncludingSelf) {
  if (elementType !== 'totals') return true
  const totalsCount = siblingTypesIncludingSelf.filter((t) => t === 'totals').length
  return totalsCount > 1
}

/**
 * The "exactly two, signature+payment_info only" pairing rule's live
 * status message — the same text shown in ElementSettingsPanel while the
 * user is still working, ahead of (not instead of) the backend's own
 * save-time validate_design_data_schema check.
 */
export function pairingStatusMessage(pairCount) {
  if (pairCount === 2) return 'exactly 2 marked, ready to save.'
  if (pairCount === 1) return '1 marked — pairing needs exactly 2.'
  if (pairCount > 2) return `${pairCount} marked — pairing needs exactly 2, unmark ${pairCount - 2} more.`
  return 'mark one more element to pair with.'
}

export function isPairingValid(pairCount) {
  return pairCount === 0 || pairCount === 2
}
