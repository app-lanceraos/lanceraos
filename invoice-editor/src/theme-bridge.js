// src/theme-bridge.js
//
// Phase 1b — this editor doesn't own a theme switch; it OBSERVES the
// same one LanceraOS's main app already has (frontend/src/hooks/
// useTheme.js): a `data-theme="light"|"dark"` attribute on <html>,
// sourced from the `lanceraos-theme` localStorage key with a
// system-preference fallback when nothing's been chosen yet. This is a
// deliberate, minimal PORT of that hook's own real logic — same key,
// same fallback, same live-update behavior — not a second, independent
// theme concept; there is no setter here, only observation, since this
// standalone project has no toggle UI of its own to offer (see the
// phase's own explicit "no second switching system" requirement).
//
// The moment this editor is actually mounted inside the main app
// (replacing DesignEditor.jsx) and shares its real <html> with
// useTheme.js, that hook is what will be setting `data-theme` — this
// bridge becomes a redundant no-op at that point (it would just
// re-read/re-apply the same attribute value something else already
// set), safe to delete then, but harmless to leave running meanwhile.
const THEME_KEY = 'lanceraos-theme';

function resolveTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', resolveTheme());
}

export function initThemeBridge() {
  applyTheme();

  // Another tab (e.g. the real app, once same-origin) changing the
  // stored preference — `storage` only fires in OTHER windows/tabs on
  // the same origin, which is exactly the cross-tab-sync case this
  // exists for.
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY) applyTheme();
  });

  // No explicit preference stored yet — follow the OS live, same as
  // useTheme.js's own identical listener.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem(THEME_KEY)) applyTheme();
  });
}
