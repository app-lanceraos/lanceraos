// src/store/authStore.js
import { create } from 'zustand'
import api from '@/lib/api'
import { getCookie } from '@/lib/api'
import { classifyAuthError } from '@/lib/authErrors'

// A slow link (Pakistan -> Sydney, 1-3.5s on a fresh connection) must not be
// read as "logged out". Each /auth/me/ attempt gets 8s (the global timeout is
// 15s — too long to leave someone staring at "Loading…" before the first
// retry), and we try up to 3 times, waiting 1s then 2s in between.
const INIT_TIMEOUT_MS = 8000
const INIT_MAX_ATTEMPTS = 3
const INIT_BACKOFF_MS = [1000, 2000]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Module-level, not store state: it is a promise, and nothing renders from it.
let initInFlight = null

const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  // True until the first /me/ check resolves. Cookies are httpOnly, so
  // unlike v1 (which could read localStorage synchronously), there is
  // no way to know the auth state before asking the server at least once.
  isInitializing: true,
  // 'network' when /auth/me/ could not be reached at all (timeouts, network
  // errors, 429, 5xx) after every retry. This is NOT a logout: no cookie or
  // cached state was cleared, and PrivateRoute shows a "can't reach" screen
  // with a Retry button instead of redirecting to /login. null otherwise.
  initError: null,
  deletionScheduledAt: null,

  // Call on app mount. Safe to call again: a call made while another is in
  // flight returns that same promise instead of starting a second check.
  //
  // Only a 401/403 from the server means "logged out". Anything else
  // (see lib/authErrors.js) is retried, and if it never recovers the user
  // lands on the retry screen (initError) — still holding valid cookies.
  initialize: () => {
    if (initInFlight) return initInFlight
    initInFlight = (async () => {
      // No hint cookie -> definitely no session -> skip the network call
      // entirely, rather than firing it and getting back an expected but
      // noisy 401. If the hint IS present, it doesn't prove anything on
      // its own (the underlying session could have been revoked or
      // expired since) — the real /auth/me/ check still runs to confirm.
      if (!getCookie('lanceraos_has_session')) {
        set({ user: null, isAuthenticated: false, deletionScheduledAt: null, isInitializing: false, initError: null })
        return
      }

      for (let attempt = 1; attempt <= INIT_MAX_ATTEMPTS; attempt += 1) {
        try {
          const res = await api.get('/auth/me/', { timeout: INIT_TIMEOUT_MS })
          set({
            user: res.data,
            isAuthenticated: true,
            deletionScheduledAt: res.data.deletion_scheduled_at || null,
            isInitializing: false,
            initError: null,
          })
          return
        } catch (error) {
          const kind = classifyAuthError(error)
          if (kind === 'definitive') {
            set({ user: null, isAuthenticated: false, deletionScheduledAt: null, isInitializing: false, initError: null })
            return
          }
          if (kind === 'unexpected' && !import.meta.env.PROD) {
            console.error('Unexpected response from /auth/me/ (not treated as a logout):', error.response?.status)
          }
          if (attempt < INIT_MAX_ATTEMPTS) await sleep(INIT_BACKOFF_MS[attempt - 1])
        }
      }

      // Deliberately no clearLocalAuth() and no cookie changes: the session
      // is probably fine, we just could not reach the server.
      set({ user: null, isAuthenticated: false, deletionScheduledAt: null, isInitializing: false, initError: 'network' })
    })().finally(() => {
      initInFlight = null
    })
    return initInFlight
  },

  // The "Try again" button, and the automatic retry on `online` /
  // tab-visible (hooks/useAuthInitRetry.js).
  retryInitialize: () => {
    set({ initError: null, isInitializing: true })
    return get().initialize()
  },

  // Called after a successful login / 2FA-verify / OAuth response. The
  // server has already set the httpOnly cookies via Set-Cookie — this
  // only updates in-memory state from the user object in the response body.
  loginSuccess: (user) => {
    set({
      user,
      isAuthenticated: true,
      deletionScheduledAt: user?.deletion_scheduled_at || null,
      initError: null,
    })
  },

  // User-initiated logout: revokes the session server-side, then clears
  // local state regardless of whether that call succeeds (best-effort —
  // the UI must never keep claiming the user is logged in either way).
  logout: async () => {
    try {
      await api.post('/auth/logout/')
    } catch {
      /* best-effort */
    }
    get().clearLocalAuth()
  },

  // Local-only cleanup, no network call. Used by lib/api.js when a
  // refresh attempt itself fails — the session is already confirmed
  // dead server-side at that point, so calling /logout/ again would be
  // redundant (and would likely itself fail).
  //
  // Also clears the cached sidebar avatar: without this, logging out
  // and into a DIFFERENT account in the same browser tab would show
  // the previous account's photo in AppShell's sidebar (sessionStorage
  // is scoped to the tab, not to whichever account happens to be
  // logged into it) until that new account uploads its own photo.
  clearLocalAuth: () => {
    sessionStorage.removeItem('profile_logo')
    // initError is reset too: a stale 'network' error must not turn a later,
    // real logout into the "can't reach" screen instead of the login redirect.
    set({ user: null, isAuthenticated: false, deletionScheduledAt: null, initError: null })
  },

  updateUser: (patch) => set((state) => ({
    user: { ...state.user, ...patch },
    deletionScheduledAt: patch.deletion_scheduled_at !== undefined
      ? (patch.deletion_scheduled_at || null)
      : state.deletionScheduledAt,
  })),

  // Also keeps sessionStorage in sync — AppShell.jsx bootstraps its
  // sidebar avatar from a cached sessionStorage value on mount (so it
  // doesn't have to wait on a network round-trip every time), but that
  // cache has no other invalidation path. Without updating it here too,
  // uploading a new photo then refreshing would keep showing the old
  // cached photo indefinitely, for the rest of that browser tab's life.
  updateAvatar: (logoUrl) => {
    sessionStorage.setItem('profile_logo', logoUrl)
    set((state) => ({ user: { ...state.user, profile_logo: logoUrl } }))
  },

  setDeletionWarning: (date) => set({ deletionScheduledAt: date }),
}))

export default useAuthStore