// src/lib/api.js
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/admin`
  : 'http://localhost:8000/api/admin'

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  // Sends/receives the admin-specific httpOnly cookies
  // (lanceraos_admin_access/refresh) and the shared csrftoken cookie —
  // CSRF is one global Django mechanism, not something this app
  // reinvents separately from the main frontend.
  withCredentials: true,
})

// ══════════════════════════════════════════════════════════════════
// CSRF — same mechanism as the main app, own trigger endpoint so this
// app never needs to know about apps.users' URL structure.
// ══════════════════════════════════════════════════════════════════

export function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

let csrfReadyPromise = null

async function ensureCsrfCookie() {
  if (getCookie('csrftoken')) return
  if (!csrfReadyPromise) {
    csrfReadyPromise = axios
      .get(`${BASE_URL}/csrf/`, { withCredentials: true })
      .catch(() => {
        /* If this fails, the subsequent request fails with a clear 403
           CSRF error anyway — no need to also throw here. */
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
// 401 HANDLING — silent refresh via httpOnly cookie, then retry.
// The CSRF-on-refresh fix already learned the hard way on the main
// app is applied here from the start, not reintroduced: the refresh
// call itself also needs a CSRF token attached, or it always fails
// with 403 for anyone without an already-fetched CSRF cookie.
// ══════════════════════════════════════════════════════════════════

let isRefreshing = false
let pendingQueue = []

function flushQueue(error) {
  pendingQueue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve()))
  pendingQueue = []
}

const SKIP_REFRESH_URLS = ['/login/', '/token/refresh/', '/2fa/verify/']

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
      await axios.post(`${BASE_URL}/token/refresh/`, {}, {
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
  import('@/store/adminAuthStore')
    .then(({ default: useAdminAuthStore }) => useAdminAuthStore.getState().clearLocalAuth())
    .catch(() => {})
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

export default api