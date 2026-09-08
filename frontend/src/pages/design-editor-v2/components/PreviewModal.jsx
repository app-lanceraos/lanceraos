import React, { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { useEditor } from '../state/EditorContext';
import EditorCanvas from './Canvas/EditorCanvas';
import { CloseIcon } from './Icons';
import { mmToPx } from '../utils/units';

// The preview is deliberately just the SAME canvas tree in a modal — no
// separate render path, so there's no risk of preview drifting from what
// the editor actually shows. `readOnly` on EditorCanvas is what keeps it a
// clean read-only render of that shared state: without it, whatever's
// selected in the editor behind this modal would show its outline/handles
// here too (they share the same EditorContext, not a copy), and clicking a
// part inside the preview would mutate the live template.
export default function PreviewModal({ onClose }) {
  const { template } = useEditor();
  const containerRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  // Captures the real `.page-frame` node directly, at its true page
  // dimensions — not the scaled-down wrapper this modal displays it in —
  // so the exported PNG matches true print proportions regardless of the
  // on-screen preview zoom.
  const handleDownload = async (e) => {
    e.stopPropagation();
    const pageEl = containerRef.current?.querySelector('.page-frame');
    if (!pageEl || downloading) return;
    setDownloading(true);
    try {
      // Phase 2a: toPng's own width/height options are real output PIXELS
      // (it rasterizes `.page-frame` into a canvas of exactly this size) —
      // template.page.width/height are mm now, so they need the same
      // mm->px boundary conversion every other pixel-consuming API in
      // this app goes through, or the exported PNG would come out at a
      // tiny ~210x297px instead of the correct ~794x1123 (x pixelRatio).
      const dataUrl = await toPng(pageEl, {
        width: mmToPx(template.page.width),
        height: mmToPx(template.page.height),
        pixelRatio: 2,
        backgroundColor: template.page.backgroundColor,
      });
      const link = document.createElement('a');
      link.download = 'invoice-preview.png';
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Preview download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-actions">
        <button className="modal-btn" onClick={handleDownload} disabled={downloading}>
          {downloading ? 'Preparing…' : 'Download PNG'}
        </button>
        <button className="modal-btn" onClick={onClose}>
          Close preview <CloseIcon size={12} />
        </button>
      </div>
      <div ref={containerRef} onClick={(e) => e.stopPropagation()} style={{ transform: 'scale(0.85)' }}>
        <EditorCanvas readOnly />
      </div>
    </div>
  );
}
