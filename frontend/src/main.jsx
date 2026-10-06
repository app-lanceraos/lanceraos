// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'

// Design system first — sets the CSS variables everything else uses.
import './styles/theme.css'

import App from './App'
import { installTooltipController } from './hooks/useAppTooltip'

// Apply the saved theme to <html> before React mounts, so there's zero
// flash of the wrong theme on load.
;(function applyThemeEarly() {
  const saved = localStorage.getItem('lanceraos-theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = (saved === 'dark' || saved === 'light') ? saved : (prefersDark ? 'dark' : 'light')
  document.documentElement.setAttribute('data-theme', theme)
})()

// The one delegated tooltip controller — see hooks/useAppTooltip.js. Installed
// once for the whole app, so no component ever binds tooltip listeners itself.
installTooltipController()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>,
)