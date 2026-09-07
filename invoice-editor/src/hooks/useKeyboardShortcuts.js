import { useEffect } from 'react';
import { useEditor } from '../state/EditorContext';
import { copyToClipboard, readClipboard } from '../state/clipboard';
import { loadImageFile } from '../utils/imageFile';
import { isFreelyDuplicable } from '../data/elementCatalog';

// Prompt 30 item 5 guarded shortcuts behind "is the user typing?", but
// answered it with `tagName === 'INPUT'` — which is true of plenty of
// controls that swallow no keystrokes of their own. A native
// `<input type="range">` in particular KEEPS focus after a drag ends, so
// once you touched a slider, every later Ctrl+Z was silently discarded
// until you clicked elsewhere. Prompt 34 item 2: ask the narrower, real
// question instead — is the focused element somewhere text is being
// entered? — so range/checkbox/radio/color/file inputs and focusable
// buttons (color swatches, toggles) all keep the shortcuts working, while
// genuine text entry (including the number half of a slider row) still
// wins. `contenteditable` counts too: canvas text is edited in place.
const TEXT_ENTRY_TYPES = new Set([
  'text', 'number', 'search', 'email', 'url', 'tel', 'password', 'date', 'time', 'datetime-local', 'month', 'week',
]);

function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return TEXT_ENTRY_TYPES.has(el.type);
  return false;
}

export function useKeyboardShortcuts({ onPreviewToggle } = {}) {
  const {
    template, selection, setSelection,
    undo, redo, runSave,
    deleteItems, canDeleteSelection, deleteBlockLine, canDeleteBlockLine, duplicateItems,
    addItemsFromClipboard, addImageItem,
  } = useEditor();

  useEffect(() => {
    const handler = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (isTextEntry(document.activeElement)) return; // don't hijack typing in property fields

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); runSave(); return; }

      // Prompt 17 item 2: select every canvas item — content AND shapes,
      // the unified template.items model from Prompt 3 — and, critically,
      // preventDefault so the browser's own "select all text on the page"
      // never fires alongside it (that native behavior firing unopposed
      // was the actual bug; there was no prior select-all of any kind to
      // widen — Prompt 2 predates the unified item model entirely).
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        // Prompt 26 item 1: a hidden item isn't rendered/selectable on
        // canvas at all — select-all shouldn't silently include it either.
        setSelection({ ids: template.items.filter((i) => !i.hidden).map((i) => i.id), part: null });
        return;
      }

      // Prompt 23 item 3: gated the same way the Toolbar button and
      // ContextMenu item already are — "at least one shape in the
      // selection" (duplicateItems itself would silently no-op on a
      // content-only selection anyway, but every SURFACE that offers
      // Duplicate should agree on when it's actually available, not just
      // the underlying data-layer guard). Prompt 27: `image` counts too.
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const canDuplicate = selection.ids.some((id) => {
          const item = template.items.find((i) => i.id === id);
          return item && isFreelyDuplicable(item) && !item.locked;
        });
        if (canDuplicate) duplicateItems(selection.ids);
        return;
      }

      // Prompt 21 item 2: content items are single-instance and never go
      // to the clipboard at all — copying a mixed shape+content
      // selection copies just the shape(s); a pure-content selection
      // copies nothing (and leaves whatever was already on the
      // clipboard untouched, rather than clobbering it with an empty
      // payload). Prompt 27: `image` travels through this same
      // clipboard, alongside shapes. (text/bindings prompt): an unbound
      // multiInstance content item (customText) joins the same set — see
      // elementCatalog.js's isFreelyDuplicable.
      if (mod && e.key.toLowerCase() === 'c') {
        if (selection.ids.length > 0) {
          const items = template.items.filter((i) => selection.ids.includes(i.id) && isFreelyDuplicable(i));
          if (items.length > 0) copyToClipboard({ items });
        }
        return;
      }

      if (mod && e.key.toLowerCase() === 'v') {
        const clip = readClipboard();
        if (clip?.items?.length) addItemsFromClipboard(clip.items);
        return;
      }

      if (!mod && e.key.toLowerCase() === 'p') { e.preventDefault(); onPreviewToggle?.(); return; }

      if (e.key === 'Escape') { setSelection({ ids: [], part: null }); return; }

      // Prompt 25: explicitly gated the same way the Toolbar button and
      // ContextMenu item now are — deleteItems/deleteBlockLine already
      // no-op safely on their own, but every surface that offers Delete
      // should agree on when it's actually available, not just rely on
      // an internal guard elsewhere (same reasoning as Prompt 23's
      // Duplicate gate above).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.part && selection.ids.length === 1) {
          if (canDeleteBlockLine(selection.ids[0], selection.part.key)) {
            deleteBlockLine(selection.ids[0], selection.part.key);
          }
        } else if (canDeleteSelection(selection.ids)) {
          deleteItems(selection.ids);
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [template, selection, undo, redo, runSave, deleteItems, canDeleteSelection, deleteBlockLine, canDeleteBlockLine, duplicateItems, setSelection, addItemsFromClipboard, onPreviewToggle]);

  // Prompt 27 item 2: real OS clipboard image data (e.g. a screenshot
  // copied elsewhere, then Cmd/Ctrl+V'd here) — a genuinely separate
  // mechanism from the app's own internal item clipboard above (that one
  // is keydown-driven and reads localStorage; this is the browser's
  // native `paste` event, which is what actually carries real clipboard
  // content). Deliberately does nothing at all when the pasted data
  // isn't an image — no preventDefault, no side effect — so the keydown
  // handler's own Cmd+V branch (a completely separate event) keeps
  // pasting shapes/images from the internal clipboard exactly as before;
  // the two coexist because each only ever acts on the case it owns.
  useEffect(() => {
    const handlePaste = (e) => {
      if (isTextEntry(document.activeElement)) return; // same narrowed guard as the keydown handler
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItem = Array.from(items).find((it) => it.type?.startsWith('image/'));
      if (!imageItem) return; // no image in this paste — leave it to the internal-clipboard handler
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) loadImageFile(file, addImageItem);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [addImageItem]);
}
