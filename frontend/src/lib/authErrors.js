// src/lib/authErrors.js
//
// One rule for "does this failure mean the user is signed out?", shared by
// authStore.initialize() and lib/api.js's refresh handling so the two can
// never disagree.
//
//   'definitive' — the server answered 401 or 403. The session really is
//                  gone (or the account disabled); signing out is correct.
//   'transient'  — no answer at all (network error, timeout, request
//                  cancelled by the browser) or an answer that says
//                  "try later" (408, 429, any 5xx — e.g. a 502/503 from the
//                  tunnel). The cookies are untouched and probably fine;
//                  never sign the user out because of this.
//   'unexpected' — any other response (e.g. 400, 404). Not a sign-out
//                  either, but it should not happen, so callers log it.
//
// One 403 is not definitive: a CSRF failure (see isCsrfFailure). It is classed 'transient'.

// True for the 403 Django answers when the CSRF token is missing or stale. DRF renders it as
// {"detail": "CSRF Failed: <reason>"} (apps/users/authentication.py, enforce_csrf_standalone). The disabled-account 403
// from the same endpoint has a different body ({"error": "Your account has been disabled."}) and is not matched.
export function isCsrfFailure(error) {
  if (error?.response?.status !== 403) return false
  const detail = error.response.data?.detail
  return typeof detail === 'string' && detail.startsWith('CSRF Failed')
}

export function classifyAuthError(error) {
  const status = error?.response?.status
  // A CSRF refusal is a 403 that says nothing about the session (the refresh endpoint checks CSRF before it looks at
  // the session at all), so it is the one 403 that is NOT a sign-out.
  if (isCsrfFailure(error)) return 'transient'
  if (status === 401 || status === 403) return 'definitive'
  if (!error?.response) return 'transient'
  if (status === 408 || status === 429 || status >= 500) return 'transient'
  return 'unexpected'
}
