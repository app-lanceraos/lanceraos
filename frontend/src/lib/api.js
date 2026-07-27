// src/lib/api.js
import axios from 'axios'

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
const SKIP_REFRESH_URLS = [
  '/auth/login/', '/auth/register/', '/auth/token/refresh/',
  '/auth/google/', '/auth/facebook/', '/auth/2fa/verify/',
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

    try {
      await ensureCsrfCookie()
      const csrfToken = getCookie('csrftoken')
      await axios.post(`${BASE_URL}/auth/token/refresh/`, {}, {
        withCredentials: true,
        headers: csrfToken ? { 'X-CSRFToken': csrfToken } : {},
      })
      flushQueue(null)
      return api(originalRequest)
    } catch (refreshError) {
      flushQueue(refreshError)
      _forceLogout()
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)

function _forceLogout() {
  import('@/store/authStore')
    .then(({ default: useAuthStore }) => useAuthStore.getState().clearLocalAuth())
    .catch(() => {})
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

export default api