// src/lib/refreshCoordinator.js
//
// Cross-tab single-flight for the access-token refresh.
//
// lib/api.js already de-duplicates refreshes inside ONE tab (isRefreshing /
// pendingQueue), but that is a module variable, so two tabs each fire their
// own refresh. The server rotates the refresh token on every refresh, so
// the loser sends the already-rotated cookie, gets a 401, and the server
// then deletes every auth cookie — logging out both tabs for real.
//
// Two layers fix that, both safe to lose:
//   1. A Web Lock ('lanceraos-token-refresh') so only one tab at a time runs
//      the refresh POST. Cookies are shared by every tab on the domain, so
//      a tab that gets the lock second already holds the freshly rotated
//      refresh cookie — its POST would be valid, just redundant.
//   2. A non-secret timestamp in localStorage ('lanceraos_last_refresh_at').
//      A tab that waited for the lock and finds a refresh newer than its own
//      401 skips the POST and only retries its original request.
//
// If navigator.locks or localStorage is missing or throws (old browser,
// private window), this degrades to exactly the old in-tab behaviour.
// Nothing here is a secret: the timestamp is only "a refresh happened".

export const LOCK_NAME = 'lanceraos-token-refresh'
export const LAST_REFRESH_KEY = 'lanceraos_last_refresh_at'
// A refresh counts as "after my 401" if it finished no more than this long
// before the 401 was seen. Covers the gap between the browser applying the
// new cookies and the timestamp being written.
const CLOCK_TOLERANCE_MS = 2000

function defaultLocks() {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null
}

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null // Accessing localStorage itself can throw when site data is blocked.
  }
}

// locks / storage are resolved per call when not injected, so the module
// never touches browser globals at import time and tests can inject fakes.
export function createRefreshCoordinator({ locks, storage, now = Date.now } = {}) {
  const getLocks = () => (locks === undefined ? defaultLocks() : locks)
  const getStorage = () => (storage === undefined ? defaultStorage() : storage)

  function readLastRefresh() {
    try {
      const raw = getStorage()?.getItem(LAST_REFRESH_KEY)
      const value = Number(raw)
      return raw !== null && raw !== undefined && Number.isFinite(value) ? value : null
    } catch {
      return null
    }
  }

  function writeLastRefresh() {
    try {
      getStorage()?.setItem(LAST_REFRESH_KEY, String(now()))
    } catch {
      /* Storage blocked or full — the lock alone still prevents the race. */
    }
  }

  // requestedAt: Date.now() taken when the 401 was seen, BEFORE waiting for
  // the lock. doRefresh: performs the actual refresh POST (throws on failure).
  // Resolves when the caller may retry its original request.
  async function refresh(requestedAt, doRefresh) {
    const run = async () => {
      const last = readLastRefresh()
      if (last !== null && last >= requestedAt - CLOCK_TOLERANCE_MS) return
      await doRefresh()
      writeLastRefresh()
    }
    const lockProvider = getLocks()
    return lockProvider ? lockProvider.request(LOCK_NAME, run) : run()
  }

  return { refresh }
}

export const refreshCoordinator = createRefreshCoordinator()
