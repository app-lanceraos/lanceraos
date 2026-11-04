// src/lib/api.js
import axios from 'axios'

import { classifyAuthError } from '@/lib/authErrors'
import { refreshCoordinator } from '@/lib/refreshCoordinator'

const REFRESH_TIMEOUT_MS = 15000

const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : 'http://localhost:8000/api'

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  // Sends/receives the httpOnly JWT cookies and the (non-httpOnly)
  // csrftoken cookie on every request, including cross-origin ones
  // between app.lanceraos.com and lanceraos.com in production.
  withCredentials: true,
})

// A bare instance for PUBLIC pages that need no CSRF and no session refresh
// (the client's proposal page, /proposal/:token). It has NO interceptors on
// purpose: the shared instance above prefetches GET /auth/csrf/ and reads
// document.cookie before any non-GET request, and its 401 handler can redirect
// to /login — none of which a person who has never used LanceraOS should ever
// trigger just by pressing Accept. The two public proposal endpoints are
// CSRF-exempt (they carry no ambient credential) and never answer 401, so this
// makes "the page cannot call /auth/ or force a logout" structural, not a
// convention. withCredentials stays true: the backend recognises the owner only
// from the login cookie, and without it every owner visit would count as a
// client view.
export const publicApi = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  withCredentials: true,
})

// ══════════════════════════════════════════════════════════════════
// CSRF
// ══════════════════════════════════════════════════════════════════
// Django only sends the csrftoken cookie once something server-side
// calls get_token() during a request (see GET /api/auth/csrf/, which
// exists purely to trigger this). It is NOT httpOnly on purpose — the
// frontend has to read it and echo it back in a header for Django's
// double-submit check to pass.

export function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

let csrfReadyPromise = null

async function ensureCsrfCookie() {
  if (getCookie('csrftoken')) return
  if (!csrfReadyPromise) {
    csrfReadyPromise = axios
      .get(`${BASE_URL}/auth/csrf/`, { withCredentials: true })
      .catch(() => {
        /* If this fails, the subsequent request will fail with a clear
           403 CSRF error anyway — no need to also throw here. */
      })
  }
  await csrfReadyPromise
}

const SAFE_METHODS = new Set(['get', 'head', 'options'])

api.interceptors.request.use(async (config) => {
  const method = (config.method || 'get').toLowerCase()
  if (!SAFE_METHODS.has(method)) {
    await ensureCsrfCookie()
    const token = getCookie('csrftoken')
    if (token) config.headers['X-CSRFToken'] = token
  }
  return config
})

// ══════════════════════════════════════════════════════════════════
// REDIRECT-AFTER-LOGIN HELPERS
// ══════════════════════════════════════════════════════════════════

export function getRedirectPath() {
  const path = sessionStorage.getItem('redirectTo')
  sessionStorage.removeItem('redirectTo')
  if (path && path.startsWith('/') && path !== '/login' && path !== '/register') {
    return path
  }
  return '/dashboard'
}

export function setRedirectPath(path) {
  if (!path || path === '/login' || path === '/register' || path === '/') return
  if (!path.startsWith('/')) return
  if (!sessionStorage.getItem('redirectTo')) {
    sessionStorage.setItem('redirectTo', path)
  }
}

export function forceSetRedirectPath(path) {
  if (!path || path === '/login' || path === '/register' || path === '/') return
  if (!path.startsWith('/')) return
  sessionStorage.setItem('redirectTo', path)
}

// ══════════════════════════════════════════════════════════════════
// 401 HANDLING — silent refresh via httpOnly cookie, then retry
// ══════════════════════════════════════════════════════════════════
// Unlike v1, there is no access/refresh token string to read or
// re-attach here. The refresh endpoint rotates the httpOnly cookie via
// Set-Cookie; retrying just means resending the original request now
// that a fresh cookie is already in place.

let isRefreshing = false
let pendingQueue = []

function flushQueue(error) {
  pendingQueue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve()))
  pendingQueue = []
}

// These must never trigger a refresh-and-retry cycle: login/register
// are meant to fail with a plain 401/400, and refresh itself must
// never try to refresh-on-401-of-refresh (infinite loop).
//
// The two /portal/ prefixes are a real, necessary addition (Step 12):
// client-portal pages authenticate via a completely separate cookie
// (apps.clients.cookies.PORTAL_SESSION_COOKIE_NAME), never the
// freelancer's own JWT — a real client visiting the portal with no
// session at all has no lanceraos_refresh cookie either, so without this
// skip, a 401 there would trigger a refresh attempt that ALSO fails,
// which _forceLogout() below turns into a hard redirect to the
// freelancer's own /login page. Portal pages handle their own 401s
// directly (e.g. showing "request a new link"), matching how this same
// interceptor already stays out of the way for /auth/login//register/.
const SKIP_REFRESH_URLS = [
  '/auth/login/', '/auth/register/', '/auth/token/refresh/',
  '/auth/google/', '/auth/facebook/', '/auth/2fa/verify/',
  '/clients/portal/', '/invoices/portal/',
]

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const isSkipped = SKIP_REFRESH_URLS.some((url) => originalRequest?.url?.includes(url))

    if (error.response?.status !== 401 || originalRequest._retry || isSkipped) {
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject })
      }).then(() => api(originalRequest))
    }

    originalRequest._retry = true
    isRefreshing = true
    // Taken BEFORE waiting for the cross-tab lock: refreshCoordinator skips
    // the POST when another tab refreshed after this moment.
    const sawUnauthorizedAt = Date.now()

    try {
      await refreshCoordinator.refresh(sawUnauthorizedAt, async () => {
        await ensureCsrfCookie()
        const csrfToken = getCookie('csrftoken')
        await axios.post(`${BASE_URL}/auth/token/refresh/`, {}, {
          withCredentials: true,
          // Bare axios has no default timeout; without one a hung refresh
          // would hold the cross-tab lock (and block every other tab) forever.
          timeout: REFRESH_TIMEOUT_MS,
          headers: csrfToken ? { 'X-CSRFToken': csrfToken } : {},
        })
      })
      flushQueue(null)
      // Deliberately not `await`ed: a failure of the RETRY itself must
      // reach the caller as-is, not be mistaken for a refresh failure by
      // the catch below.
      return api(originalRequest)
    } catch (refreshError) {
      flushQueue(refreshError)
      // Only the server saying 401/403 to the refresh means the session is
      // gone. Anything else (network error, timeout, 429, 5xx) leaves the
      // cookies as they were: reject this request so the page shows its own
      // error, and let the next action try again. Reporting "logged out"
      // for a flaky connection is the bug this replaces — a reload "fixed"
      // it only because nothing had actually been cleared.
      //
      // The refresh POST is deliberately NOT retried automatically on a
      // network error. From here we cannot tell "the request never reached
      // the server" from "the server rotated the token and the response was
      // lost". In the second case a retry would send the OLD refresh
      // cookie, get a 401, and the server then deletes every auth cookie —
      // worse than failing once. A retry is only safe once the backend
      // accepts the previous refresh token for a short grace window.
      if (classifyAuthError(refreshError) === 'definitive') {
        _forceLogout()
      }
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)

// A real hard navigation (not React Router's navigate) is deliberate here —
// this runs inside a plain axios interceptor with no router context, and a
// full reload guarantees every last bit of in-memory app state is gone, not
// just what a client-side route change happens to reset. The
// `session_expired` query param is the one improvement worth making: without
// it, a user whose session died mid-use (natural 15-minute access-token
// expiry, or eviction by the 3-concurrent-session cap — see DECISIONS.md's
// reload investigation) just sees the whole app vanish and dump them on a
// blank login form with no explanation, which reads as "the page randomly
// reloaded/crashed" rather than what actually happened.
function _forceLogout() {
  import('@/store/authStore')
    .then(({ default: useAuthStore }) => useAuthStore.getState().clearLocalAuth())
    .catch(() => {})
  if (window.location.pathname !== '/login') {
    window.location.href = '/login?session_expired=1'
  }
}

export default api