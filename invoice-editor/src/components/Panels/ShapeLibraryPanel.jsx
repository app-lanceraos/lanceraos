import React, { useRef } from 'react';
import { SHAPE_TYPES } from '../../data/shapeCatalog';
import { useEditor } from '../../state/EditorContext';
import { loadImageFile } from '../../utils/imageFile';

const SWATCH_CLASS = {
  roundedRect: 'shape-swatch shape-swatch--rect',
  ellipse: 'shape-swatch shape-swatch--ellipse',
  line: 'shape-swatch shape-swatch--line',
};

export default function ShapeLibraryPanel() {
  const { addShape, addImageItem } = useEditor();
  const fileInputRef = useRef(null);

  // Prompt 27 item 2: standard file-picker flow — no network call
  // involved, the file is read straight into an in-memory data URL
  // (loadImageFile) and handed to addImageItem. Resetting the input's
  // own value afterward is what lets picking the SAME file again still
  // fire onChange (the browser otherwise treats an unchanged selection
  // as a no-op change event).
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) loadImageFile(file, addImageItem);
  };

  return (
    <>
      <div className="panel__section-title">Design shapes</div>
      {Object.entries(SHAPE_TYPES).map(([type, def]) => (
        <button key={type} className="shape-btn" onClick={() => addShape(type)}>
          <span className={SWATCH_CLASS[type]} />
          {def.label}
        </button>
      ))}
      <button className="shape-btn" onClick={() => fileInputRef.current?.click()}>
        <span className="shape-swatch shape-swatch--image" />
        Upload image
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  );
}
