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

// jsdom does not implement ResizeObserver at all — useFilterOverflow.js
// (Invoices.jsx/Clients.jsx's filter-row overflow detection, List/Table
// restructure pass) observes a container to re-measure on layout change.
// A no-op stub is enough here: jsdom also never lays out real pixel
// widths (every offsetWidth/clientWidth is 0), so the observer callback
// firing or not doesn't change what useFilterOverflow.test.js actually
// exercises — that file mocks offsetWidth/clientWidth directly instead.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}