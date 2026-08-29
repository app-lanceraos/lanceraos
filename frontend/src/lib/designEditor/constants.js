// src/lib/designEditor/constants.js
//
// The production Template Builder canvas adapter's own constants.
// The schema shape (page/header/flow, kind+type, overrides, generic
// vocabulary, page-level margins/sidebar) is deliberately different from
// the legacy zone_1/zone_2 shape (see design_migration.py for the
// converter) — a design_data payload is always one shape or the other,
// never a mix.
//
// Coordinate convention — mm at rest, px only at the canvas boundary
// (see this same directory's serialization.js module docstring):
// design_data is always mm; GrapesJS's drag/resize math is px-native, so
// the canvas edits in px internally, and MM_TO_PX/PX_TO_MM convert only at
// the two boundaries (building the tree from a loaded canvas document —
// mm -> px — and reading the live tree back out on save — px -> mm).
// Nothing in between (drag, resize, spacing edits) touches mm.
export const MM_TO_PX = 96 / 25.4
export const PX_TO_MM = 25.4 / 96

export const mmToPx = (mm) => Math.round((mm || 0) * MM_TO_PX)
export const pxToMm = (px) => Math.round(((px || 0) * PX_TO_MM) * 100) / 100 // 2dp, matches design_schema.py's own numbers

// Mirrors legacy_design_schema.py's own OVERLAP_EPSILON_MM — design_schema.py's
// _validate_page_bounds reuses that exact same tolerance for its own x>=0/
// y>=0/x+width<=boundW checks (a real element placed exactly edge-to-edge
// with the page's own edge can pick up a razor-thin apparent overflow purely
// from the canvas's own mm<->px<->mm round-trip; the same tolerance that
// already absorbs this for sibling-to-sibling edges absorbs it here too).
// This clamp MUST use the identical tolerance, not a stricter one — a client
// that clamps at a tighter bound than the backend actually enforces would
// disagree with it in the other direction, visibly repositioning an element
// the backend was always going to accept unchanged (confirmed live: the
// production table seed's own default width is already 0.1mm over its
// content area for exactly this reason, and the backend accepts it as-is).
export const OVERLAP_EPSILON_MM = 0.3

// Phase 5.1 client-side bounds clamp — the ONE shared clamp implementation
// every real interaction path (drag-commit, keyboard nudge, and resize)
// calls, in mm, so it stays a single pure/testable rule rather than three
// independently-drifting copies. Mirrors design_schema.py's own
// _validate_page_bounds exactly, epsilon tolerance included: x >= -epsilon,
// y >= -epsilon, x + width <= boundWMm + epsilon — no bottom-edge
// (y + height) ceiling, matching the backend's own deliberate
// non-enforcement of one (content may legitimately flow onto a second page
// — see that function's own docstring). `boundWMm` is always the CALLER's
// own already-server-resolved page.content_width_mm/page.sidebar.width_mm
// (design_canvas.py's build_canvas_document resolves the real margin
// fallback chain once, server-side) — never a constant re-hardcoded here,
// so a custom-margin or sidebar-flagged design is bounded correctly with no
// extra logic.
//
// `mode: 'position'` (drag/nudge — DesignEditor.jsx) only ever moves x/y
// to stay in bounds, never touches width/height, since neither
// interaction resizes anything. `mode: 'resize'` (componentTypes.js's
// resizableConfig) only ever shrinks width to fit — never repositions x
// to compensate, since _validate_page_bounds itself doesn't care which
// edge is the "anchor", only that both bounds hold afterward; a resize
// handle simply stops at the page edge rather than silently relocating
// the element.
export function clampToBoundsMm({ x, y, width, height }, boundWMm, mode = 'position') {
  if (boundWMm == null) return { x, y, width, height }
  const minCoord = -OVERLAP_EPSILON_MM
  const maxRight = boundWMm + OVERLAP_EPSILON_MM
  const clampedY = Math.max(minCoord, y)
  if (mode === 'resize') {
    const clampedX = Math.max(minCoord, x)
    const clampedWidth = Math.min(width, Math.max(0, maxRight - clampedX))
    return { x: clampedX, y: clampedY, width: clampedWidth, height }
  }
  const clampedX = Math.max(minCoord, Math.min(x, maxRight - width))
  return { x: clampedX, y: clampedY, width, height }
}

// Phase 4B.2: header/flow no longer carry different positioning
// semantics (see design_schema.py's own docstring) — every element
// type below (semantic, generic, and the one structural type) is now
// independently positioned/resizable/deletable-if-optional through the
// exact same interaction code path, regardless of which original list
// (header vs flow) it came from. The type lists themselves are kept for
// reference/documentation parity with the backend's own schema, though
// nothing in this file branches on header-vs-flow membership anymore.
export const HEADER_SEMANTIC_TYPES = ['logo', 'business_info', 'client_info', 'dates']
export const FLOW_SEMANTIC_TYPES = ['totals', 'notes', 'signature', 'payment_info', 'qr_code', 'online_payment_link']
export const GENERIC_TYPES = ['text', 'image', 'rectangle', 'divider', 'container']
export const STRUCTURAL_TYPES = ['table']

// GrapesJS component-type ids used by the production canvas — namespaced
// `lancera-v2-*` (a leftover of this schema's own internal naming history,
// not visible anywhere in the product).
//
// Phase 4B.2: ONE coordinate-space container per real coordinate space
// (main content, sidebar) — replacing the old 4-container split
// (header/flow x main/sidebar) now that header and flow elements share
// one absolutely-positioned shape and render as siblings, the table
// included, matching canonical_v2.html's own `.v2-elements` div exactly.
export const SIDEBAR_ID = 'lancera-v2-sidebar'
export const SIDEBAR_ELEMENTS_ID = 'lancera-v2-sidebar-elements'
export const ELEMENTS_CONTAINER_ID = 'lancera-v2-elements'
export const TABLE_ID = 'lancera-v2-table'

// Master Blueprint cutover — real "add a new element" support (the
// blueprint's own top P0 finding: no phase ever built a way to add a
// brand-new element to a design, confirmed absent by direct grep before
// this cutover). Mirrors design_schema.SUPPORTED_BINDINGS (backend)
// exactly — kept as a plain, hand-kept list here rather than a live API
// round-trip; a mismatch here only ever means a binding option is
// missing from the dropdown, never an invalid save (the backend's own
// validator is the real, authoritative gate either way).
export const GENERIC_TYPE_DEFAULTS = {
  text: { width: 60, height: 8, label: 'Text' },
  image: { width: 30, height: 20, label: 'Image' },
  rectangle: { width: 40, height: 15, label: 'Rectangle' },
  divider: { width: 174, height: 2, label: 'Divider' },
  container: { width: 60, height: 20, label: 'Container' },
}

export const BINDING_OPTIONS = [
  { value: '', label: 'Static text (no binding)' },
  { value: 'invoice.number', label: 'Invoice Number' },
  { value: 'invoice.issue_date', label: 'Invoice Date' },
  { value: 'invoice.due_date', label: 'Due Date' },
  { value: 'invoice.subtotal', label: 'Subtotal Amount' },
  { value: 'invoice.tax_amount', label: 'Tax Amount' },
  { value: 'invoice.discount_amount', label: 'Discount Amount' },
  { value: 'invoice.notes', label: 'Notes text' },
  { value: 'invoice.terms', label: 'Terms text' },
  { value: 'invoice.payment_link', label: 'Payment Link' },
  { value: 'business.name', label: 'Business Name' },
  { value: 'business.email', label: 'Business Email' },
  { value: 'business.address_line1', label: 'Business Address' },
  { value: 'business.city', label: 'Business City' },
  { value: 'business.country', label: 'Business Country' },
  { value: 'business.phone', label: 'Business Phone' },
  { value: 'client.name', label: 'Client Name' },
  { value: 'client.company', label: 'Client Company' },
  { value: 'client.email', label: 'Client Email' },
  { value: 'client.phone', label: 'Client Phone' },
  { value: 'client.address', label: 'Client Address' },
  { value: 'totals.grand_total', label: 'Total Amount' },
  { value: 'business.bank_name', label: 'Bank Name' },
  { value: 'business.bank_account_number', label: 'Bank Account Number' },
  { value: 'business.jazzcash_number', label: 'JazzCash Number' },
  { value: 'business.easypaisa_number', label: 'Easypaisa Number' },
  { value: 'business.payoneer_email', label: 'Payoneer Email' },
]
