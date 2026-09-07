import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { initThemeBridge } from './theme-bridge.js';
import './styles/tokens.css';
import './styles/editor.css';

// Phase 1b — applies the real data-theme attribute before first paint,
// same mechanism the main app's own useTheme.js hook uses. See
// theme-bridge.js's own header for why this observes rather than owns
// the theme.
initThemeBridge();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
