import React, { useEffect } from 'react';
import { useEditor } from '../state/EditorContext';
import { copyToClipboard } from '../state/clipboard';
import { copyFormatting, readFormatting, captureFormatting, formattingPatch } from '../state/formatting';
import { isFreelyDuplicable } from '../data/elementCatalog';

// A single item's own available actions, independent of what else is
// selected — the menu shown for a multi-selection is the genuine
// intersection of these across every selected item (Prompt 15), not a
// separate hardcoded "multi-select menu". Duplicate/copy are deliberately
// NOT in this per-item set (Prompt 21 item 2: content items are single-
// instance, full stop) — they're gated separately below by "does ANY
// selected item support it," not the intersection, so a mixed shape+
// content selection still shows Duplicate and acts on just the shape(s),
// rather than the whole action disappearing because one member can't.
// Prompt 25: 'delete' used to live in this intersection set too, but that
// made a required-but-unlocked item's OWN capability set include it
// unconditionally — required-ness only becomes "can't actually be
// deleted" in combination with the rest of the current template (is this
// its last remaining instance?), which a single item can't answer about
// itself the way `item.locked` alone can. That whole-selection question
// is `canDeleteSelection` (EditorContext), checked separately below —
// same "some, not every" pattern `canDuplicate` already uses, so a mixed
// selection still deletes whatever in it actually can be.
function itemCapabilities(item) {
  const caps = new Set();
  if (item.locked) return caps; // the footer: selectable, but no destructive/structural actions
  // Prompt 27: `image` styles its corner radius exactly like a content
  // item (frameStyle's `item.cornerRadius` — see CanvasItem.jsx), so it
  // gets the same reset-to-zero affordance.
  if (item.kind === 'content' || item.kind === 'image' || item.type === 'roundedRect') caps.add('reset-radius');
  return caps;
}

export default function ContextMenu() {
  const {
    template, selection, setSelection, contextMenu, setContextMenu,
    duplicateItems, deleteItems, canDeleteSelection, updateItems, updateItemPart,
    moveSelectionZ,
  } = useEditor();

  const close = () => setContextMenu(null);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const onDown = (e) => {
      if (!e.target.closest?.('.context-menu')) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu]);

  if (!contextMenu) return null;

  const selectedItems = template.items.filter((i) => selection.ids.includes(i.id));
  if (selectedItems.length === 0) return null;

  const single = selectedItems.length === 1 ? selectedItems[0] : null;
  const part = selection.part;
  const formatClip = readFormatting();

  // Genuine intersection, not a hardcoded multi-select list: only an
  // action every selected item actually supports shows up.
  const commonCaps = selectedItems.map(itemCapabilities).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));

  // Prompt 21 item 2: content items can't be duplicated/copied at all —
  // `canDuplicate` uses "at least one shape in the selection" (not the
  // Prompt 15 intersection every OTHER capability here uses) so the
  // action stays available and does the right partial thing for a mixed
  // selection; `canCopy` narrows the existing single-whole-item scope to
  // shapes only, since copying a lone content item would do nothing.
  // Prompt 27: `image` is "shape-like" for duplicate/copy purposes too —
  // freely multipliable, no single-instance rule. (text/bindings prompt):
  // an unbound multiInstance content item (customText) joins the same
  // set via isFreelyDuplicable — a BOUND customText item stays excluded
  // (single-instance per binding).
  const canDuplicate = selectedItems.some((i) => isFreelyDuplicable(i) && !i.locked);
  // Prompt 25: same "some, not every" shape canDuplicate uses — a mixed
  // selection of deletable and required/locked items should still offer
  // Delete and act on just the deletable member(s), not disappear because
  // one member can't go.
  const canDelete = canDeleteSelection(selection.ids);
  const canCopy = !!single && !part && isFreelyDuplicable(single);
  const canCopyFormatting = !!single;
  const canPasteFormatting = !!formatClip && selectedItems.length > 0;
  const canSelectWholeContainer = !!single && !!part;

  const actions = [];
  if (canSelectWholeContainer) {
    actions.push({
      key: 'select-whole',
      label: 'Select whole container',
      run: () => setSelection({ ids: [single.id], part: null }),
    });
  }
  if (canDuplicate) {
    actions.push({ key: 'duplicate', label: 'Duplicate', run: () => duplicateItems(selection.ids) });
  }
  if (canCopy) {
    actions.push({ key: 'copy', label: 'Copy', run: () => copyToClipboard({ items: [single] }) });
  }
  if (canCopyFormatting) {
    actions.push({
      key: 'copy-formatting',
      label: part ? 'Copy formatting (part)' : 'Copy formatting',
      run: () => copyFormatting(captureFormatting(single, part?.key)),
    });
  }
  if (canPasteFormatting) {
    actions.push({
      key: 'paste-formatting',
      label: 'Paste formatting',
      run: () => {
        if (part && single) {
          updateItemPart(single.id, part.key, formattingPatch(formatClip, single, part.key));
        } else {
          updateItems(selection.ids, (item) => formattingPatch(formatClip, item, null));
        }
      },
    });
  }
  if (commonCaps.has('reset-radius')) {
    actions.push({
      key: 'reset-radius',
      label: 'Reset border radius',
      run: () => updateItems(selection.ids, (item) => (item.kind === 'shape' ? { radius: 0 } : { cornerRadius: 0 })),
    });
  }
  // Prompt 26 item 2: z-order actions, available for any non-empty
  // selection regardless of lock state (locking blocks
  // move/resize/rotate/delete/duplicate, not stacking order — a locked
  // item can still be brought forward/back). moveSelectionZ itself
  // enforces the shape-behind-content rule (see EditorContext/utils/
  // zorder.js) and surfaces the "clamped" feedback via zOrderClamped —
  // this menu doesn't need its own copy of that logic.
  if (selectedItems.length > 0) {
    actions.push({ key: 'bring-front', label: 'Bring to Front', run: () => moveSelectionZ(selection.ids, 'front') });
    actions.push({ key: 'bring-forward', label: 'Bring Forward', run: () => moveSelectionZ(selection.ids, 'forward') });
    actions.push({ key: 'send-backward', label: 'Send Backward', run: () => moveSelectionZ(selection.ids, 'backward') });
    actions.push({ key: 'send-back', label: 'Send to Back', run: () => moveSelectionZ(selection.ids, 'back') });
  }
  if (canDelete) {
    actions.push({ key: 'delete', label: 'Delete', run: () => deleteItems(selection.ids) });
  }

  if (actions.length === 0) return null;

  return (
    <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
      {actions.map((a) => (
        <button
          key={a.key}
          className="context-menu__item"
          onClick={() => {
            a.run();
            close();
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
