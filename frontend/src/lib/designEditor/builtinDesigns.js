// src/lib/designEditor/builtinDesigns.js
//
// A hand-kept mirror of apps/invoices/design_seeds.py's BUILTIN_DESIGNS —
// needed so the Path 1 gallery (DesignGallery.jsx) can render a real preview
// of all 3 templates before the user has picked one (design_duplicate only
// creates a real, owned InvoiceDesign row once they *have* picked — there's
// deliberately no "list builtins" backend endpoint, see DECISIONS.md's Step
// 8b entry). This duplication is a real tradeoff, flagged rather than
// hidden: if design_seeds.py changes, this file needs a matching manual
// update, or the gallery preview silently drifts from what design_duplicate
// actually creates. Values copied verbatim from design_seeds.py as of the
// Step 8 build.
export const BUILTIN_DESIGN_DATA = {
  professional: {
    zone_1: {
      elements: [
        { type: 'logo', x: 20, y: 16, width: 15, height: 15, style: { border_radius_mm: 2.5 } },
        {
          type: 'business_info', x: 39, y: 16, width: 90, height: 17,
          style: { font: 'Source Serif 4', font_size_pt: 21, color: '#1a2b42', eyebrow: 'Invoice', show_tagline: true },
        },
        {
          type: 'dates', x: 133, y: 16, width: 57, height: 20,
          style: { align: 'right', font: 'IBM Plex Mono', show_invoice_number: true },
        },
        { type: 'client_info', x: 20, y: 48, width: 85, height: 28, style: { label: 'Bill to', align: 'left' } },
        {
          type: 'business_info', x: 115, y: 48, width: 75, height: 28,
          style: { label: 'From', align: 'right', variant: 'sender_repeat' },
        },
      ],
    },
    zone_2: {
      table: { style: { header_border_color: '#a8813c', row_border_color: '#e5e1d6', font: 'IBM Plex Mono' } },
      elements: [
        { type: 'totals', spacing_after_previous: 6, style: { width: 62, align: 'right' } },
        { type: 'notes', spacing_after_previous: 14, style: { width: 56 } },
        {
          type: 'payment_info', spacing_after_previous: 0,
          style: { width: 40, label: 'Payment methods', variant: 'bank_methods' },
        },
        {
          type: 'payment_info', spacing_after_previous: 18,
          style: { label: 'Pay online', variant: 'qr_and_link' }, paired_side_by_side: true,
        },
        { type: 'signature', spacing_after_previous: 0, style: { label: 'Authorised signature' }, paired_side_by_side: true },
      ],
    },
  },

  minimal: {
    zone_1: {
      elements: [
        { type: 'logo', x: 18, y: 20, width: 12, height: 12, style: {} },
        {
          type: 'business_info', x: 34, y: 20, width: 90, height: 15,
          style: { font: 'IBM Plex Sans', font_size_pt: 19, eyebrow: 'Invoice', show_tagline: true },
        },
        {
          type: 'dates', x: 130, y: 20, width: 62, height: 16,
          style: { align: 'right', font: 'IBM Plex Mono', show_invoice_number: true },
        },
        { type: 'client_info', x: 18, y: 48, width: 85, height: 26, style: { label: 'Bill to', align: 'left' } },
        {
          type: 'business_info', x: 115, y: 48, width: 77, height: 26,
          style: { label: 'From', align: 'right', variant: 'sender_repeat' },
        },
      ],
    },
    zone_2: {
      table: { style: { header_border_color: '#171614', row_border_color: '#e8e6de', font: 'IBM Plex Mono' } },
      elements: [
        { type: 'totals', spacing_after_previous: 6, style: { width: 62, align: 'right', rows: ['subtotal', 'tax', 'discount'] } },
        { type: 'totals', spacing_after_previous: 12, style: { align: 'right', variant: 'total_due_display', font_size_pt: 34 } },
        { type: 'notes', spacing_after_previous: 4, style: { width: 56 } },
        {
          type: 'payment_info', spacing_after_previous: 0,
          style: { width: 40, label: 'Payment methods', variant: 'bank_methods' },
        },
        {
          type: 'payment_info', spacing_after_previous: 16,
          style: { label: 'Pay online', variant: 'qr_and_link' }, paired_side_by_side: true,
        },
        {
          type: 'signature', spacing_after_previous: 0,
          style: { label: 'Authorised signature', has_signature_image: true }, paired_side_by_side: true,
        },
      ],
    },
  },

  modern: {
    zone_1: {
      elements: [
        { type: 'logo', x: 6, y: 14, width: 15, height: 15, style: { sidebar: true } },
        {
          type: 'business_info', x: 6, y: 31, width: 30, height: 22,
          style: { sidebar: true, font: 'Space Grotesk', show_tagline: true },
        },
        {
          type: 'dates', x: 58, y: 14, width: 136, height: 18,
          style: { eyebrow: 'Invoice', show_invoice_number: true, font: 'Space Grotesk' },
        },
        { type: 'client_info', x: 58, y: 40, width: 64, height: 26, style: { label: 'Bill to', align: 'left' } },
        {
          type: 'business_info', x: 126, y: 40, width: 68, height: 26,
          style: { label: 'From', align: 'right', variant: 'sender_repeat' },
        },
      ],
    },
    zone_2: {
      table: { style: { header_bg: '#2d2a6e', header_color: '#ffffff', font: 'IBM Plex Mono' } },
      elements: [
        {
          type: 'totals', spacing_after_previous: 6,
          style: { width: 62, align: 'right', variant: 'total_pill', pill_color: '#d4e157' },
        },
        { type: 'notes', spacing_after_previous: 12, style: { width: 56 } },
        {
          type: 'payment_info', spacing_after_previous: 0,
          style: { width: 40, label: 'Payment methods', variant: 'bank_methods' },
        },
        {
          type: 'payment_info', spacing_after_previous: 0,
          style: { label: 'Pay online', variant: 'qr_and_link', sidebar: true },
        },
        {
          type: 'signature', spacing_after_previous: 16,
          style: { label: 'Authorised signature', has_signature_image: true, align: 'right' },
        },
      ],
    },
  },
}

// A handful of curated palette keys per template — not a raw color picker
// (the task's own instruction). These are presentation-only swap targets;
// InvoiceDesign.color_variant just stores the key string, same as the
// backend model field's own "curated palette key" help_text.
export const COLOR_VARIANTS = {
  professional: [
    { key: 'default', label: 'Amber & Navy', primary: '#a8813c', secondary: '#1a2b42' },
    { key: 'forest', label: 'Forest', primary: '#4a7c59', secondary: '#1f2e1a' },
    { key: 'burgundy', label: 'Burgundy', primary: '#8c3a4d', secondary: '#2a1a20' },
  ],
  minimal: [
    { key: 'default', label: 'Sage', primary: '#6b8570', secondary: '#171614' },
    { key: 'slate', label: 'Slate', primary: '#5b6b78', secondary: '#171614' },
    { key: 'clay', label: 'Clay', primary: '#a8663c', secondary: '#171614' },
  ],
  modern: [
    { key: 'default', label: 'Indigo & Lime', primary: '#2d2a6e', secondary: '#d4e157' },
    { key: 'midnight', label: 'Midnight & Gold', primary: '#1a1a2e', secondary: '#e8b84b' },
    { key: 'plum', label: 'Plum & Mint', primary: '#4a2d5e', secondary: '#8fd9c4' },
  ],
}

export const BASE_TEMPLATE_LABELS = {
  professional: 'Professional',
  minimal: 'Minimal',
  modern: 'Modern',
}
