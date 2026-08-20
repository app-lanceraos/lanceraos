// src/components/design-editor/DesignLivePreview.jsx
//
// A real, live-rendered preview — an iframe pointing directly at the
// backend's own design-preview endpoint (real sample data, the real
// template/color, the user's own real logo), scaled down via CSS
// transform to fit a small gallery card. Replaces the old
// DesignCanvasPreview.jsx client-side approximation (SEV1 report, 20
// August 2026 — "all 3 cards render the exact same generic thumbnail,
// not reflecting the real template or the selected color swatch at
// all"). See DECISIONS.md's 20 August 2026 "color_variant wiring" entry
// for why this is the honest approach: it's provably the same render
// path (apps/invoices/pdf_generator.render_html_for_design /
// design_preview.py) a real client will actually see, not a second,
// approximate reimplementation.
//
// The iframe src carries the same-site httpOnly auth cookie
// automatically (localhost:5173/localhost:8000, or app.lanceraos.com/
// api.lanceraos.com in production, are same-SITE even though
// cross-origin for CORS purposes — see api.js's own withCredentials
// comment) — no fetch/blob plumbing needed, just a plain <iframe src>.
import api from '@/lib/api'

// The real, unscaled render is roughly A4-proportioned at CSS 96dpi
// (210mm ≈ 794px) — these are intrinsic iframe dimensions, then scaled
// down via transform to fit the card. A fixed crop height (not the full
// page) is deliberate — a gallery thumbnail only needs to show enough
// to read as that template (header + a couple of line items), not the
// entire invoice.
const INTRINSIC_WIDTH = 794
const INTRINSIC_HEIGHT = 620

/**
 * Either pass `baseTemplate` (+ optional `colorVariant`) for a Path 1
 * ready-made-template preview, or `designId` for an already-saved
 * InvoiceDesign's own preview — never both.
 */
export default function DesignLivePreview({ baseTemplate, colorVariant, designId, width = 240 }) {
  const scale = width / INTRINSIC_WIDTH
  const src = designId
    ? `${api.defaults.baseURL}/invoices/designs/${designId}/preview/`
    : `${api.defaults.baseURL}/invoices/designs/preview/?base_template=${encodeURIComponent(baseTemplate)}&color_variant=${encodeURIComponent(colorVariant || '')}`

  return (
    <div style={{
      width, height: Math.round(INTRINSIC_HEIGHT * scale), overflow: 'hidden',
      borderRadius: 6, border: '1px solid var(--border-default)', background: '#fff',
    }}>
      <iframe
        key={src}
        src={src}
        title="Design preview"
        scrolling="no"
        style={{
          width: INTRINSIC_WIDTH, height: INTRINSIC_HEIGHT, border: 'none',
          transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none',
        }}
      />
    </div>
  )
}
