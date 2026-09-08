import { create as createQRCode } from 'qrcode/lib/core/qrcode.js';
import { pxToMm, roundMm } from '../utils/units';
import { bindingSample } from './bindings';

// Phase 2a: every defaultBox below is still AUTHORED at its original px
// value (preserving this file's own historical layout comments, which all
// reason in px) and converted to mm once, here, at module load — the same
// boundary conversion every other px->mm crossing in this app goes
// through (see utils/units.js). A mechanical conversion is the right call
// specifically for these: they're seed/demo layout positions, not a
// tuned UX-feel constant the way geometry.js's PAGE_PADDING/
// COLLISION_MARGIN are (those were deliberately retuned to clean mm
// values instead — see that file's own comments for why the two cases
// call for different treatment).
function boxMm(x, y, width, height) {
  return { x: roundMm(pxToMm(x)), y: roundMm(pxToMm(y)), width: roundMm(pxToMm(width)), height: roundMm(pxToMm(height)) };
}

// Every content element the editor knows about. Elements are FIXED WIDGETS —
// users never type invoice data, they only toggle, restyle, position, resize
// and rotate them. `render` returns the static display string/structure baked
// into the element itself.
//
// `defaultBox` is both the item's placement AND its natural size the first
// time it's added — the natural size a resize's content-scaling transform
// measures against (see CanvasItem.jsx). Positions are hand-placed to
// roughly reconstruct the old zone-based layout as a sensible starting
// point; nothing after creation depends on these values, they're just seed
// data for `initialTemplateState` and for whatever appears when re-toggling
// an element back on.

// 'From' and the fixed footer both show the same business identity — one
// source, referenced by both, so they can never drift into separate copies
// of what's meant to be the same fixed demo data.
const FROM_BUSINESS_NAME = 'Business Name';
const FROM_EMAIL = 'owner@business.com';

// The QR pattern is generated once, at module load, from the same static
// demo link already shown as text — `qrcode`'s synchronous `create()` (the
// core encoder, no canvas/PNG renderer pulled in) hands back the raw module
// matrix, which we turn into a single SVG path of unit squares ourselves.
// A real vector path — not a rasterized image — so it scales cleanly
// through the same CSS transform every other item's content does.
const PAY_LINK = 'pay.example.com/inv-0001';
const qr = createQRCode(PAY_LINK, { errorCorrectionLevel: 'M' });
const QR_SIZE = qr.modules.size;
const QR_PATH = (() => {
  const data = qr.modules.data;
  let d = '';
  for (let row = 0; row < QR_SIZE; row++) {
    for (let col = 0; col < QR_SIZE; col++) {
      if (data[row * QR_SIZE + col]) d += `M${col},${row}h1v1h-1z`;
    }
  }
  return d;
})();

export const ELEMENT_TYPES = {
  logo: {
    label: 'Logo',
    required: false,
    defaultOn: true,
    variant: 'image',
    shapeOptions: ['square', 'rounded', 'circle'],
    defaultBox: boxMm(32, 32, 42, 42),
    render: () => ({ kind: 'image', placeholder: 'logo' }),
  },
  // The small eyebrow label the original Django template placed above the
  // business name (`<div class="eyebrow">Invoice</div>`) — never made it
  // into this catalog until now.
  invoice: {
    label: 'Invoice',
    required: false,
    defaultOn: true,
    variant: 'text',
    defaultBox: boxMm(90, 24, 60, 16),
    render: () => 'Invoice',
  },
  businessName: {
    label: 'Business name',
    required: true,
    defaultOn: true,
    variant: 'text',
    // y: 46, not 36 — Invoice's box sits right above it (y:24, height:16
    // stored), and Prompt 14's live text measurement found its TRUE
    // rendered height is ~17px, not exactly 16 (sub-pixel line-height,
    // invisible until a text item's collision box started reflecting its
    // real measured size instead of the stored one). Leaving a genuine
    // few-px margin here — not the bare Prompt-12 2px minimum this row
    // was previously tuned to exactly — so ordinary sub-pixel rendering
    // variance can never tip these two into an actual collision. The
    // whole header row shifted down together with it (invoiceNumber,
    // issueDate, dueDate) to keep the row's own baseline aligned.
    defaultBox: boxMm(90, 46, 130, 18),
    render: () => 'Business Name',
  },
  invoiceNumber: {
    label: 'Invoice number',
    required: true,
    defaultOn: true,
    variant: 'text',
    defaultBox: boxMm(236, 46, 90, 18),
    render: () => 'INV-0001',
  },
  // 'label-value' is a styling split only — the label ("Issue date:") and
  // the value ("01-01-2026") are each their own independently-selectable
  // part (see item.label / item.value in CanvasItem.jsx, same pattern as
  // block title/lines), but the displayed text itself is exactly what it
  // always was, still fixed baked-in content.
  issueDate: {
    label: 'Issue date',
    required: true,
    defaultOn: true,
    variant: 'label-value',
    defaultBox: boxMm(342, 46, 150, 18),
    render: () => ({ label: 'Issue date:', value: '01-01-2026' }),
  },
  dueDate: {
    label: 'Due date',
    required: true,
    defaultOn: true,
    variant: 'label-value',
    defaultBox: boxMm(508, 46, 150, 18),
    render: () => ({ label: 'Due Date:', value: '15-01-2026' }),
  },
  // block-variant `render()` returns { title, lines }: `title` is the
  // heading (never individually deletable), `lines` is the body, each with
  // its own `key` (used for per-line selection/style, see item[line.key]
  // in CanvasItem.jsx) and `required` (blocks that one line from being
  // deleted the same way a required top-level item is protected — an
  // item's currently-hidden optional lines live in item.hiddenLines).
  billTo: {
    label: 'Bill to',
    required: true,
    defaultOn: true,
    variant: 'block',
    defaultBox: boxMm(32, 100, 170, 56),
    render: () => ({
      title: { key: 'title', label: 'Title', text: 'Bill To' },
      lines: [
        { key: 'clientName', label: 'Client name', text: 'Client Name', required: true },
        { key: 'clientCompany', label: 'Company', text: 'Client Company', required: false },
        { key: 'address', label: 'Address', text: '123 Client Street', required: false },
        { key: 'email', label: 'Email', text: 'client@email.com', required: true },
      ],
    }),
  },
  from: {
    label: 'From',
    required: true,
    defaultOn: true,
    variant: 'block',
    defaultBox: boxMm(222, 100, 170, 46),
    render: () => ({
      title: { key: 'title', label: 'Title', text: 'From' },
      lines: [
        { key: 'businessName', label: 'Business name', text: FROM_BUSINESS_NAME, required: true },
        { key: 'address', label: 'Address', text: '456 Business Ave', required: false },
        { key: 'email', label: 'Email', text: FROM_EMAIL, required: true },
      ],
    }),
  },
  itemsTable: {
    label: 'Items table',
    required: true,
    defaultOn: true,
    variant: 'table',
    defaultBox: boxMm(32, 220, 730, 150),
    render: () => ({
      columns: ['Description', 'Qty', 'Rate', 'Amount'],
      rows: [
        ['Website design', '1', '$1,200.00', '$1,200.00'],
        ['Logo & brand kit', '1', '$450.00', '$450.00'],
        ['Development (hrs)', '20', '$60.00', '$1,200.00'],
        ['Hosting setup', '1', '$80.00', '$80.00'],
      ],
    }),
  },
  // Prompt 13: these four used to be a single fused `row`/`row-strong`
  // unit (label + value, styled as one). Reusing `label-value` — the same
  // variant/mechanism Due Date and Issue Date already use — gives each its
  // own independently selectable/styleable label and value part, without
  // building a second sub-part system. `spread: true` is what keeps the
  // price-row look (label left, value right, `justify-content: space-
  // between` across the row's full width) instead of label-value's
  // default tight left-anchored pair (see CanvasItem.jsx's 'label-value'
  // case) — content alignment (left/center/right) doesn't apply to a
  // spread row for the same reason it doesn't apply to a table cell: the
  // spread itself already defines where label/value sit.
  subtotal: {
    label: 'Subtotal',
    required: true,
    defaultOn: true,
    variant: 'label-value',
    spread: true,
    defaultBox: boxMm(542, 390, 220, 14),
    render: () => ({ label: 'Subtotal', value: '$2,930.00' }),
  },
  tax: {
    label: 'Tax',
    required: false,
    defaultOn: true,
    variant: 'label-value',
    spread: true,
    defaultBox: boxMm(542, 416, 220, 14),
    render: () => ({ label: 'Tax (5%)', value: '$146.50' }),
  },
  discount: {
    label: 'Discount',
    required: false,
    defaultOn: true,
    variant: 'label-value',
    spread: true,
    defaultBox: boxMm(542, 442, 220, 14),
    render: () => ({ label: 'Discount', value: '−$100.00' }),
  },
  // `strong: true` on top of `spread` is what used to be `row-strong` —
  // bold weight, a larger default size, and the border-top rule above it
  // (see CanvasItem.jsx), still independently overridable per part.
  totalDue: {
    label: 'Total due',
    required: true,
    defaultOn: true,
    variant: 'label-value',
    spread: true,
    strong: true,
    defaultBox: boxMm(542, 468, 220, 20),
    render: () => ({ label: 'Total due', value: '$2,976.50' }),
  },
  currencyConversion: {
    label: 'Currency conversion',
    required: false,
    defaultOn: true,
    variant: 'note',
    defaultBox: boxMm(542, 498, 220, 16),
    render: () => '≈ PKR 826,000 at rate 278.0',
  },
  // Prompt 21: the lower section (notes/terms/payment methods/pay online/
  // signature) is where "everything defaultOn" actually collides —
  // these 7 items' positions were re-laid-out from scratch as one
  // coherent two-column group (notes+terms left, payment info+QR right)
  // rather than the old single-column stack these boxes never had to
  // coexist with each other at before. See design_layout.mjs-style
  // verification in the Prompt 21 report: zero overlaps across the full
  // 21-item default set, no sizes needed to shrink to fit.
  notes: {
    label: 'Notes',
    required: false,
    defaultOn: true,
    variant: 'block',
    defaultBox: boxMm(32, 700, 340, 26),
    // A single-line block: that one line is `required` (not individually
    // removable) since deleting it would just leave an empty card behind —
    // removing the whole thing is what the top-level toggle is for.
    render: () => ({
      title: { key: 'title', label: 'Title', text: 'Notes' },
      lines: [
        { key: 'body', label: 'Note', text: 'Thank you for your business. Please reach out with any questions.', required: true },
      ],
    }),
  },
  terms: {
    label: 'Terms',
    required: false,
    defaultOn: true,
    variant: 'block',
    defaultBox: boxMm(32, 746, 340, 26),
    render: () => ({
      title: { key: 'title', label: 'Title', text: 'Terms' },
      lines: [
        { key: 'body', label: 'Terms', text: 'Payment due within 14 days of the issue date.', required: true },
      ],
    }),
  },
  paymentMethods: {
    label: 'Payment methods',
    required: false,
    defaultOn: true,
    variant: 'block',
    defaultBox: boxMm(400, 700, 340, 36),
    render: () => ({
      title: { key: 'title', label: 'Title', text: 'Payment methods' },
      lines: [
        { key: 'bankTransfer', label: 'Bank transfer', text: 'Bank transfer — Example Bank ••1234', required: false },
        { key: 'payoneer', label: 'Payoneer', text: 'Payoneer — pay@business.com', required: false },
      ],
    }),
  },
  payOnline: {
    label: 'Pay online',
    required: false,
    defaultOn: true,
    variant: 'qr',
    defaultBox: boxMm(400, 750, 110, 130),
    render: () => ({ label: 'Pay online', link: PAY_LINK, qrPath: QR_PATH, qrSize: QR_SIZE }),
  },
  // The original template composed a signature out of three stacked
  // pieces (image, rule, caption) rather than one unit — kept as three
  // fully independent top-level items here too, not a single item with
  // nested parts (contrast with the block title/lines pattern): each has
  // its own position/size/style/delete, no shared bounding box. Default
  // positions just stack them in the same visual order as a courtesy for
  // "turn all three on at once"; nothing ties them together afterward.
  signatureImage: {
    label: 'Signature image',
    required: false,
    defaultOn: true,
    variant: 'image',
    // width:height matches signature.png's own visible-content aspect
    // ratio (~1.06:1, nearly square) — the old 110x35 box was much wider
    // than the asset itself, so `object-fit: contain` (CanvasItem's image
    // case) letterboxed it down to a small centered strip, leaving a big
    // empty margin inside the item's own bounding box/selection outline
    // (Prompt 16 item 2). Matching the aspect ratio here means the image
    // fills its box edge-to-edge, so the box IS the visible content.
    defaultBox: boxMm(32, 800, 37, 35),
    render: () => ({ kind: 'image', placeholder: 'signature' }),
  },
  signatureDivider: {
    label: 'Signature divider',
    required: false,
    defaultOn: true,
    variant: 'divider',
    // Prompt 23 item 6: was 110x3 — the same full width as signatureLabel
    // below it, visually oversized next to signatureImage's much smaller
    // 37px-wide mark. Sized closer to the image it sits under, thin
    // enough to read as a rule rather than a bar.
    defaultBox: boxMm(32, 845, 70, 2),
    render: () => null,
  },
  signatureLabel: {
    label: 'Signature label',
    required: false,
    defaultOn: true,
    variant: 'text',
    defaultBox: boxMm(32, 854, 110, 16),
    render: () => 'Authorised Signature',
  },
  // Reverses this catalog's original "closed, fixed-content, single-
  // instance" rule for exactly this one type — see this file's own
  // header comment and the Phase (text/bindings) prompt report for the
  // full reasoning. `multiInstance: true` is the flag that opts a
  // catalog type OUT of the toggle-based single-instance model
  // (EditorContext's toggleContentItem/insertContentItem,
  // ElementLibraryPanel's insert-vs-toggle split, LayersPanel's
  // per-group numbering) — every OTHER entry in this file is
  // implicitly single-instance (multiInstance defaults to falsy/absent).
  //
  // Two independent content modes live on the SAME catalog type, chosen
  // per-item via `item.binding`:
  //   - `item.binding` unset/null: STATIC text — `item.text` is the
  //     user's own typed string (unlimited instances; each one is a
  //     wholly independent copy, editable in PropertiesPanel).
  //   - `item.binding` set to one of bindings.js's BINDING_OPTIONS (or,
  //     for a design imported from production, ANY string at all — see
  //     bindingSample's own unfamiliar-binding fallback): BOUND text —
  //     content is the binding's own placeholder sample (this editor has
  //     no real invoice/client to resolve a live value from, same
  //     "baked-in placeholder" convention as invoiceNumber's 'INV-0001'
  //     etc.), and this is single-instance PER BINDING VALUE (enforced
  //     in EditorContext, not here — this file has no notion of "what
  //     else is currently on canvas").
  //
  // `render(item)` — unlike every sibling entry above, this one actually
  // reads its `item` argument (every other entry's `render()` ignores
  // the extra parameter ContentBody now always passes — see
  // CanvasItem.jsx). Text is rendered as plain JSX text content
  // (`{data}`), never dangerouslySetInnerHTML — React escapes it exactly
  // the way Django's own `{{ el.resolved_text|linebreaksbr }}` in
  // apps/invoices/templates/invoices/canonical/_element_content.html
  // auto-escapes (confirmed directly: Django template variables
  // auto-escape by default, and linebreaksbr itself autoescapes its
  // input before converting newlines to <br> — same net effect, same
  // "escape untrusted content, still allow real line breaks" contract).
  customText: {
    label: 'Text',
    required: false,
    defaultOn: false,
    multiInstance: true,
    variant: 'text',
    defaultBox: boxMm(32, 520, 220, 16),
    render: (item) => (item?.binding ? bindingSample(item.binding) : (item?.text ?? 'Text')),
  },
  // Fixed page chrome, not an optional element: `hidden` keeps it out of the
  // elements library panel entirely, `locked` (propagated onto the created
  // item below) is the one mechanism CanvasItem/deleteItems/duplicateItems
  // already respect for "can't be selected, moved, resized, or duplicated".
  // Sources its business identity from the same FROM_* constants `from`
  // itself renders from, so the two can never drift apart.
  footer: {
    label: 'Footer',
    required: false,
    defaultOn: true,
    hidden: true,
    locked: true,
    variant: 'footer',
    // Hand-fixed rather than run through boxMm's mechanical conversion
    // (unlike every other defaultBox above): footer.y is what getFooterTop
    // (geometry.js) hands out AS the boundary every other item's own
    // bottom edge is measured against, and footer.width visually defines
    // how far the footer bar spans — both deserve to land on the real
    // page's own exact mm dimensions (210 x 297) rather than a
    // mechanically-converted 794px/1085px landing 0.03-0.05mm off from
    // them. Height 38px -> 10.05mm rounds to a clean 10mm; y is then
    // 297 - 10 = 287 so the bar still sits flush at the true bottom edge.
    defaultBox: { x: 0, y: 287, width: 210, height: 10 },
    render: () => ({ businessName: FROM_BUSINESS_NAME, email: FROM_EMAIL }),
  },
};

// Prompt 28 item 3: new items default to theme-linked style fields
// instead of a hardcoded literal, so a template built entirely from
// defaults already looks cohesive and a later theme change reaches
// everything that was never manually overridden. Only fields with a
// genuinely sensible slot get one — there's no "background" theme slot,
// so bgColor is left unset (transparent), same as before this prompt.
// `borderColor` links on every variant (frame-level, always present even
// while invisible at the default borderWidth:0). `textColor` links to
// `primary` for text/note/table — their existing default (no explicit
// textColor at all) already inherits `--page-text: #262420`, which is
// exactly `theme.primaryColor`'s own default value, so this changes
// nothing visually. block/qr titles link their text to `secondary` and
// heading font (titles read as headings); block lines link to the body
// font; text/note's own whole-item font links to body too.
//
// Three deliberate exceptions, found while checking this against the
// "must look identical" requirement — each is a case where CanvasItem.jsx
// couples the field to a SECOND fallback in a way a theme link would
// silently break:
//   - `footer`'s textColor: `.item__footer`'s own CSS sets `color:
//     #a09a89` (a muted tone, NOT `--page-text`), and that same
//     `item.textColor` also recolors the wordmark via `item.textColor ||
//     '#a09a89'` — linking it to primary (#262420) would darken both
//     away from their actual current default. Left unlinked.
//   - `table`'s fontFamily/fontWeight: `.item__table th`'s own weight
//     fallback is `item.headerFontWeight || item.fontWeight || 700` — if
//     the generic (body-cell-facing) `item.fontFamily`/`fontWeight` were
//     linked, `item.fontWeight` would resolve to the theme's weight
//     (never `undefined`), permanently short-circuiting that `|| 700`
//     and un-bolding the header by default. Left unlinked so the
//     existing fallback chain keeps working exactly as before.
//   - `label-value` with `strong: true` (Total due): its hardcoded
//     fallback weight is 700 for BOTH its label and value
//     (`def.strong ? 700 : undefined` in CanvasItem's fontStyle calls)
//     — a font link would override that per-part fontWeight with the
//     theme's weight the same way, un-bolding it. Rather than special-
//     case just the strong rows, label-value parts are left unlinked by
//     default entirely — still linkable by hand per-item, same as any
//     other field, just not automatic.
function defaultWholeItemStyle(def) {
  const style = { borderColor: { linked: 'primary' } };
  if (['text', 'note', 'table'].includes(def.variant)) {
    style.textColor = { linked: 'primary' };
  }
  if (['text', 'note', 'footer'].includes(def.variant)) {
    style.fontFamily = { linked: 'body' };
  }
  return style;
}

function defaultPartStyles(def) {
  if (def.variant === 'block') {
    const styles = { title: { textColor: { linked: 'secondary' }, fontFamily: { linked: 'heading' } } };
    def.render().lines.forEach((line) => {
      styles[line.key] = { fontFamily: { linked: 'body' } };
    });
    return styles;
  }
  if (def.variant === 'qr') {
    // The QR pattern's own body has no text to font-link — only its title.
    return { title: { textColor: { linked: 'secondary' }, fontFamily: { linked: 'heading' } } };
  }
  return {};
}

// Drops undefined-valued keys from `obj` — spreading `{ x: undefined }`
// over a default still WRITES the `x` key (as undefined), silently
// clobbering the default it was meant to leave alone. Used below so a
// caller (e.g. createGenericTextItem) can pass a sparse overrides object
// without every unset field blowing away its catalog default.
function stripUndefined(obj) {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v;
  });
  return out;
}

// `overrides` (added for `customText`/generic construction — see
// createGenericTextItem below) is a sparse patch applied on top of the
// catalog default: x/y/width/height override the box (and, since
// naturalWidth/naturalHeight are computed from the box AFTER the merge,
// stay consistent with whatever box actually lands, not the catalog's own
// unrelated default); any other field (text, binding, rotation, locked,
// fontFamily, ...) is just an extra property on the created item. `id` is
// never accepted from `overrides` — every created item gets its own fresh
// id, always.
export const createContentItem = (type, overrides = {}) => {
  const def = ELEMENT_TYPES[type];
  const clean = stripUndefined(overrides);
  delete clean.id;
  const box = { ...def.defaultBox, ...clean };
  const { x, y, width, height } = box;
  return {
    id: `content-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: 'content',
    type,
    x,
    y,
    width,
    height,
    naturalWidth: width,
    naturalHeight: height,
    rotation: 0,
    locked: !!def.locked,
    ...defaultWholeItemStyle(def),
    ...defaultPartStyles(def),
    ...clean,
  };
};

// ── Generic construction from arbitrary production data ────────────────
//
// The later adapter's IMPORT path (a separate, dependent prompt — not
// built here) needs to construct a working, editable canvas item from ANY
// valid production `generic:text` element, including one bound to a
// binding this editor's own bindings.js has never seen before (e.g. a
// hand-authored design_data payload, or SUPPORTED_BINDINGS growing after
// this editor's own copy was last synced — see bindings.js's own
// docstring). `createContentItem('customText', ...)` above already
// accepts an arbitrary x/y/width/height/binding/text combination with NO
// validation against BINDING_OPTIONS at all (bindingSample's own
// unfamiliar-binding fallback renders `[binding.value]` rather than
// throwing) — this function is a thin, intention-revealing wrapper over
// that same general-purpose path, exported here (not inside the adapter
// file, which doesn't exist as an import path yet) so it's directly
// testable and reusable independently of the later adapter-integration
// prompt that will actually call it from designDataToTemplate.
//
// Deliberately narrow in scope, matching this prompt's own acceptance
// criterion ("a hand-constructed arbitrary production-shaped element,
// e.g. a generic:text with an unfamiliar binding") — constructing a
// working item from every OTHER production element kind/type (shapes,
// images, semantic bundles) is what designDataAdapter.js's existing
// import* functions already do for the types the closed catalog
// recognizes; this only closes the one new gap that opened by making text
// genuinely open (an unbound OR arbitrarily-bound generic:text).
// Shared "is this item freely multipliable" predicate — shapes and images
// always were (Prompt 27's own comment: "freely multipliable, no
// single-instance rule"); a multiInstance content item joins them, but
// ONLY while unbound (`!item.binding`) — a BOUND customText item is
// single-instance per its own binding value (the split instance rule),
// so duplicating/copying one would immediately create a second item
// sharing that binding, exactly the state EditorContext's
// isBindingTaken guard exists to prevent. Every OTHER content item
// (single-instance per TYPE, the original rule) stays excluded here,
// same as before this type existed — duplicateItems/addItemsFromClipboard/
// the keyboard Ctrl+C handler/ContextMenu's canDuplicate+canCopy all read
// this one function now, rather than each re-deriving the same
// kind==='shape'||kind==='image' check and silently missing the new case.
export function isFreelyDuplicable(item) {
  if (item.kind === 'shape' || item.kind === 'image') return true;
  return item.kind === 'content' && !!ELEMENT_TYPES[item.type]?.multiInstance && !item.binding;
}

// Pure predicate — "does any item in `items` (other than `excludeItemId`)
// already carry this exact binding" — extracted out of EditorContext so
// it's directly unit-testable with a plain array, no React state/
// provider needed (EditorContext's own isBindingTaken is a thin wrapper
// over this, called with `template.items`). Scoped to `type ===
// 'customText'` specifically — see EditorContext's own isBindingTaken
// comment for why the fixed legacy catalog types (businessName,
// invoiceNumber, ...) aren't unified into this same check.
export function isBindingTakenIn(items, binding, excludeItemId) {
  if (!binding) return false;
  return items.some(
    (i) => i.id !== excludeItemId && i.kind === 'content' && i.type === 'customText' && i.binding === binding
  );
}

// ── Signature trio: constrained to move/resize/rotate as one unit ──────
//
// Production's `semantic:signature` is one bundle whose geometry the
// adapter derives from the union of these 3 editor items' boxes, invertible
// only while they stay in their DEFAULT relative arrangement (see
// designDataAdapter.js's exportSignatureGroup/importSignature docstrings) —
// hand-repositioning any ONE of the three independently makes that
// union-box export lossy and unrecoverable. Rather than invent a new
// grouping concept, this reuses the ids-array selection model the app's
// existing multi-select machinery (GroupSelectionOverlay, CanvasItem's own
// beginGroupMove, selectedMovableCount) already drives group transforms
// off of: whenever any one of the 3 signature items is present in a
// selection, every OTHER currently-visible signature item is folded in
// too, so a selection touching this trio always contains the whole
// present set of it, never a subset — the ">=2 selected" branch those
// existing mechanisms already treat as "transform as a group" is
// therefore guaranteed to fire for these three, and the single-item
// transform path (which is what let one part get hand-repositioned away
// from the other two) becomes unreachable for them.
export const SIGNATURE_GROUP_TYPES = ['signatureImage', 'signatureDivider', 'signatureLabel'];

export function expandLinkedGroupSelection(ids, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const hasVisibleSignatureMember = ids.some((id) => {
    const item = byId.get(id);
    return item && !item.hidden && SIGNATURE_GROUP_TYPES.includes(item.type);
  });
  if (!hasVisibleSignatureMember) return ids;
  const merged = new Set(ids);
  items.forEach((item) => {
    if (!item.hidden && SIGNATURE_GROUP_TYPES.includes(item.type)) merged.add(item.id);
  });
  return merged.size === ids.length ? ids : Array.from(merged);
}

export function createGenericTextItem({
  x, y, width, height, rotation, binding = null, text = '',
  fontFamily, fontWeight, fontSize, textColor, contentAlign, locked, hidden,
} = {}) {
  return createContentItem('customText', {
    x, y, width, height,
    rotation: rotation || 0,
    binding: binding || null,
    // A bound item's content comes from the binding, not typed text — no
    // point carrying stale/irrelevant text alongside a binding (mirrors
    // how the properties panel disables/hides the text field once a
    // binding is set, see PropertiesPanel.jsx).
    text: binding ? undefined : text,
    fontFamily,
    fontWeight,
    fontSize,
    textColor,
    contentAlign,
    locked: !!locked,
    hidden: !!hidden,
  });
}
