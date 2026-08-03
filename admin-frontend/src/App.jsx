// src/App.jsx
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import useAdminAuthStore from '@/store/adminAuthStore'
import AdminPrivateRoute from '@/components/AdminPrivateRoute'
import AdminLayout from '@/components/AdminLayout'
import AdminLogin from '@/pages/AdminLogin'
import AdminTwoFAVerify from '@/pages/AdminTwoFAVerify'
import AdminUserSearch from '@/pages/AdminUserSearch'
import AdminUserDetail from '@/pages/AdminUserDetail'
import AdminAuditLog from '@/pages/AdminAuditLog'
import AdminDeletionQueue from '@/pages/AdminDeletionQueue'

export default function App() {
  const initialize = useAdminAuthStore((s) => s.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AdminLogin />} />
        <Route path="/2fa-verify" element={<AdminTwoFAVerify />} />
        <Route
          element={
            <AdminPrivateRoute>
              <AdminLayout />
            </AdminPrivateRoute>
          }
        >
          <Route path="/users" element={<AdminUserSearch />} />
          <Route path="/users/:userId" element={<AdminUserDetail />} />
          <Route path="/audit-log" element={<AdminAuditLog />} />
          <Route path="/deletion-queue" element={<AdminDeletionQueue />} />
          <Route path="/" element={<Navigate to="/users" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}