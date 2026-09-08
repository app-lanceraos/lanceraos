import React from 'react';
import { ELEMENT_TYPES } from '../../data/elementCatalog';
import { useEditor } from '../../state/EditorContext';
import Tooltip from '../Tooltip';

// Renders the content-element list (no outer .panel wrapper — this is
// composed into LeftPanel alongside the shape library).
//
// (text/bindings prompt) reworked from a pure toggle list into a real
// insert palette: the on/off toggle only still makes sense for a
// SINGLETON type (ELEMENT_TYPES[type].multiInstance is falsy) — "on"
// meaning "at least one instance exists" is a coherent, reversible
// concept there, same as it always was. A multiInstance type
// (customText) has no such concept once more than one instance is
// possible — clicking it now always INSERTS a new instance (same
// pattern ShapeLibraryPanel's own shape buttons already use, `.shape-btn`
// reused verbatim here), never toggles anything off. The Layers panel is
// where "what's currently on canvas" actually reads clearly for a
// multi-instance type (every instance listed, individually
// selectable/deletable/hideable) — this panel's own toggle affordance
// was never going to show per-instance state for more than one instance
// anyway, so it doesn't try.
//
// Prompt 23 item 2: required elements are never listed here at all — every
// element defaults on (Prompt 21), so a required type's toggle could never
// actually be switched off, and a permanently-on, permanently-disabled
// toggle has no function. Only genuinely optional types (a user can turn
// them on AND off, or — for a multiInstance type — add more of) belong
// in this list.
export default function ElementLibraryPanel() {
  const { template, toggleContentItem, insertContentItem } = useEditor();

  const entries = Object.entries(ELEMENT_TYPES).filter(([, def]) => !def.hidden && !def.required);
  const singletons = entries.filter(([, def]) => !def.multiInstance);
  const insertable = entries.filter(([, def]) => def.multiInstance);

  return (
    <>
      <div className="panel__section-title">Invoice elements</div>
      {singletons.map(([type, def]) => {
        const isOn = template.items.some((i) => i.kind === 'content' && i.type === type);
        return (
          <div key={type} className="lib-item">
            <span>{def.label}</span>
            <Tooltip label="Toggle on/off">
              <div
                className={`lib-item__toggle${isOn ? ' lib-item__toggle--on' : ''}`}
                onClick={() => toggleContentItem(type)}
              >
                <div className="lib-item__toggle__dot" />
              </div>
            </Tooltip>
          </div>
        );
      })}

      {insertable.length > 0 && (
        <>
          <div className="panel__section-title">Insert</div>
          {insertable.map(([type, def]) => {
            const count = template.items.filter((i) => i.kind === 'content' && i.type === type).length;
            return (
              <button key={type} className="shape-btn" onClick={() => insertContentItem(type)}>
                <span className="shape-swatch" style={{ borderRadius: 4 }} />
                {def.label}
                {count > 0 && <span className="empty-hint" style={{ marginLeft: 'auto' }}>{count} on canvas</span>}
              </button>
            );
          })}
        </>
      )}
    </>
  );
}
