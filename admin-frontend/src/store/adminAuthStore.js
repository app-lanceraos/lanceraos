// src/store/adminAuthStore.js
import { create } from 'zustand'
import api from '@/lib/api'

const useAdminAuthStore = create((set, get) => ({
  admin: null,
  isAuthenticated: false,
  isInitializing: true,

  initialize: async () => {
    try {
      const res = await api.get('/me/')
      set({ admin: res.data, isAuthenticated: true, isInitializing: false })
    } catch {
      set({ admin: null, isAuthenticated: false, isInitializing: false })
    }
  },

  loginSuccess: (admin) => {
    set({ admin, isAuthenticated: true })
  },

  logout: async () => {
    try {
      await api.post('/logout/')
    } catch {
      /* best-effort */
    }
    get().clearLocalAuth()
  },

  clearLocalAuth: () => set({ admin: null, isAuthenticated: false }),
}))

export default useAdminAuthStore