// src/lib/retryPolicy.js
//
// When may the app quietly send the SAME request again after it failed? Pure decision logic, no axios and no timers, so it
// is unit-tested on its own and shared by the interceptor in lib/api.js and the CSRF prefetch.
//
// Why this exists: from some home networks, a new HTTPS connection to the API is reset during the TLS handshake now and
// then (curl: "Connection reset by peer", Chrome: ERR_CONNECTION_RESET). Such a request never reaches the server, and the
// next connection usually works. For a request that only READS, sending it again is harmless, so the person never sees
// the blip.
//
// What is deliberately never retried:
//   * Anything but GET and HEAD. A POST/PUT/PATCH/DELETE that "failed" may in fact have been carried out, with only the
//     answer lost on the way back; sending it again could pay, send or delete twice. Those requests are reported as
//     failed, once, and the caller decides.
//   * A timeout. The person already waited the whole timeout; waiting for it two more times is worse than failing.
//   * A cancelled request (the caller no longer wants the answer).
//   * Any answer from the server other than 502, 503 and 504. A 400/401/403/404/429/500 is the server speaking; asking
//     again gives the same answer (a 401 has its own refresh path in lib/api.js).
//
// 502/503/504 are what the Cloudflare tunnel and edge answer when they cannot reach the origin for a moment.

export const MAX_RETRIES = 2
export const JITTER_MAX_MS = 150

// Delay before retry number 1 and number 2 (index = retries already made).
const BASE_DELAYS_MS = [300, 900]
const RETRYABLE_METHODS = new Set(['get', 'head'])
const RETRYABLE_STATUSES = new Set([502, 503, 504])

// `attempt` is the number of retries ALREADY made for this request (0 on its first failure).
export function shouldRetry(error, attempt) {
  const config = error?.config
  if (!config) return false
  if (config.retry === false) return false
  if (attempt >= MAX_RETRIES) return false
  if (config.signal?.aborted) return false
  if (error.code === 'ERR_CANCELED') return false

  const method = (config.method || 'get').toLowerCase()
  if (!RETRYABLE_METHODS.has(method)) return false

  const status = error.response?.status
  if (status === undefined) return error.code === 'ERR_NETWORK'
  return RETRYABLE_STATUSES.has(status)
}

// How long to wait before the next try: 300 ms, then 900 ms, each plus 0-150 ms of random jitter so that many tabs (or
// many people) recovering from the same blip do not all reconnect in the same instant.
export function retryDelayMs(attempt, random = Math.random) {
  const base = BASE_DELAYS_MS[Math.min(attempt, BASE_DELAYS_MS.length - 1)]
  return base + Math.floor(random() * (JITTER_MAX_MS + 1))
}
