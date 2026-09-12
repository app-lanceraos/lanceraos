const KEY = 'invoice-editor:clipboard';

// Clipboard payload shape: { items: [...] } — one or more full unified
// canvas items (shape or content, each one's own `kind` tells you which),
// copied wholesale. A single-item copy is just a one-element array — there
// is no separate singular shape — so paste always has a uniform "add this
// whole group, offset together" path (Prompt 16 item 6) whether it's one
// item or several.

export function copyToClipboard(payload) {
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch (e) {
    // localStorage can fail (private mode, quota) — clipboard just won't
    // persist across a refresh in that case, no need to interrupt the user.
    console.warn('Clipboard persist failed', e);
  }
}

export function readClipboard() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
