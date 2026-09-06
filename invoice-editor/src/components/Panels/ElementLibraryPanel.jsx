import React from 'react';
import { ELEMENT_TYPES } from '../../data/elementCatalog';
import { useEditor } from '../../state/EditorContext';
import Tooltip from '../Tooltip';

// Renders just the content-element toggle list (no outer .panel wrapper —
// this is composed into LeftPanel alongside the shape library). "On" means
// at least one instance of that type currently exists on the canvas;
// toggling off removes every instance.
//
// Prompt 23 item 2: required elements are never listed here at all — every
// element defaults on (Prompt 21), so a required type's toggle could never
// actually be switched off, and a permanently-on, permanently-disabled
// toggle has no function. Only genuinely optional types (a user can turn
// them on AND off) belong in this list.
export default function ElementLibraryPanel() {
  const { template, toggleContentItem } = useEditor();

  return (
    <>
      <div className="panel__section-title">Invoice elements</div>
      {Object.entries(ELEMENT_TYPES).filter(([, def]) => !def.hidden && !def.required).map(([type, def]) => {
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
    </>
  );
}
