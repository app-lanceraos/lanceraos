// src/test-setup.js

// jsdom does not implement window.matchMedia at all. Several real
// components rely on it (useTheme.js for prefers-color-scheme,
// AuthLayout.jsx for prefers-reduced-motion), so this is global test
// infrastructure, not a one-off mock local to a single test file.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {}, // deprecated, some libraries still call it
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

// jsdom does not implement Element.prototype.scrollIntoView at all —
// AppShell.jsx calls it to keep the active nav item visible on route
// change / mobile drawer open.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}