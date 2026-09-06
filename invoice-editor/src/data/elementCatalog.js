import { create as createQRCode } from 'qrcode/lib/core/qrcode.js';

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
    defaultBox: { x: 32, y: 32, width: 42, height: 42 },
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
    defaultBox: { x: 90, y: 24, width: 60, height: 16 },
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
    defaultBox: { x: 90, y: 46, width: 130, height: 18 },
    render: () => 'Business Name',
  },
  invoiceNumber: {
    label: 'Invoice number',
    required: true,
    defaultOn: true,
    variant: 'text',
    defaultBox: { x: 236, y: 46, width: 90, height: 18 },
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
    defaultBox: { x: 342, y: 46, width: 150, height: 18 },
    render: () => ({ label: 'Issue date:', value: '01-01-2026' }),
  },
  dueDate: {
    label: 'Due date',
    required: true,
    defaultOn: true,
    variant: 'label-value',
    defaultBox: { x: 508, y: 46, width: 150, height: 18 },
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
    defaultBox: { x: 32, y: 100, width: 170, height: 56 },
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
    defaultBox: { x: 222, y: 100, width: 170, height: 46 },
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
    defaultBox: { x: 32, y: 220, width: 730, height: 150 },
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
    defaultBox: { x: 542, y: 390, width: 220, height: 14 },
    render: () => ({ label: 'Subtotal', value: '$2,930.00' }),
  },
  tax: {
    label: 'Tax',
    required: false,
    defaultOn: true,
    variant: 'label-value',
    spread: true,
    defaultBox: { x: 542, y: 416, width: 220, height: 14 },
    render: () => ({ label: 'Tax (5%)', value: '$146.50' }),
  },
  discount: {
    label: 'Discount',
    required: false,
    defaultOn: true,
    variant: 'label-value',
    spread: true,
    defaultBox: { x: 542, y: 442, width: 220, height: 14 },
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
    defaultBox: { x: 542, y: 468, width: 220, height: 20 },
    render: () => ({ label: 'Total due', value: '$2,976.50' }),
  },
  currencyConversion: {
    label: 'Currency conversion',
    required: false,
    defaultOn: true,
    variant: 'note',
    defaultBox: { x: 542, y: 498, width: 220, height: 16 },
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
    defaultBox: { x: 32, y: 700, width: 340, height: 26 },
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
    defaultBox: { x: 32, y: 746, width: 340, height: 26 },
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
    defaultBox: { x: 400, y: 700, width: 340, height: 36 },
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
    defaultBox: { x: 400, y: 750, width: 110, height: 130 },
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
    defaultBox: { x: 32, y: 800, width: 37, height: 35 },
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
    defaultBox: { x: 32, y: 845, width: 70, height: 2 },
    render: () => null,
  },
  signatureLabel: {
    label: 'Signature label',
    required: false,
    defaultOn: true,
    variant: 'text',
    defaultBox: { x: 32, y: 854, width: 110, height: 16 },
    render: () => 'Authorised Signature',
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
    defaultBox: { x: 0, y: 1085, width: 794, height: 38 },
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

export const createContentItem = (type) => {
  const def = ELEMENT_TYPES[type];
  const { x, y, width, height } = def.defaultBox;
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
  };
};
