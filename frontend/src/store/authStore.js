// src/store/authStore.js
import { create } from 'zustand'
import api from '@/lib/api'

const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  // True until the first /me/ check resolves. Cookies are httpOnly, so
  // unlike v1 (which could read localStorage synchronously), there is
  // no way to know the auth state before asking the server at least once.
  isInitializing: true,
  deletionScheduledAt: null,

  // Call exactly once, on app mount.
  initialize: async () => {
    try {
      const res = await api.get('/auth/me/')
      set({
        user: res.data,
        isAuthenticated: true,
        deletionScheduledAt: res.data.deletion_scheduled_at || null,
        isInitializing: false,
      })
    } catch {
      set({ user: null, isAuthenticated: false, deletionScheduledAt: null, isInitializing: false })
    }
  },

  // Called after a successful login / 2FA-verify / OAuth response. The
  // server has already set the httpOnly cookies via Set-Cookie — this
  // only updates in-memory state from the user object in the response body.
  loginSuccess: (user) => {
    set({
      user,
      isAuthenticated: true,
      deletionScheduledAt: user?.deletion_scheduled_at || null,
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
  clearLocalAuth: () => set({ user: null, isAuthenticated: false, deletionScheduledAt: null }),

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