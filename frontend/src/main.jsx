// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'

// Design system first — sets the CSS variables everything else uses.
import './styles/theme.css'

import App from './App'

// Apply the saved theme to <html> before React mounts, so there's zero
// flash of the wrong theme on load.
;(function applyThemeEarly() {
  const saved = localStorage.getItem('lanceraos-theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = (saved === 'dark' || saved === 'light') ? saved : (prefersDark ? 'dark' : 'light')
  document.documentElement.setAttribute('data-theme', theme)
})()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>,
)