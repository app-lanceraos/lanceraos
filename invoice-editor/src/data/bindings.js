// Real invoice/client/business data bindings a `generic:text` element can
// be bound to — sourced from `SUPPORTED_BINDINGS` in
// apps/invoices/design_schema.py (the monorepo checkout's own backend app,
// read directly rather than re-typed from memory — see that file's own
// list, ~line 164). This is the SINGLE place that list is copied into the
// editor; if design_schema.py's set ever grows/shrinks, only this array
// needs updating (BINDING_OPTIONS below, PropertiesPanel's picker, and the
// singleton-per-binding check in EditorContext all read from it, nothing
// duplicates the raw string list a second time).
//
// SYNCED (Phase 3c): re-diffed against design_schema.py's real
// SUPPORTED_BINDINGS directly (28 entries, confirmed by direct count) after
// Phase 3a landed its two new bindings (invoice.client_currency_conversion,
// invoice.tax_rate) — both added below. This list is current as of that
// diff; if design_schema.py's set changes again, only this array needs
// updating.
//
// `label` is a short, human display name for the picker.
// `sample` is placeholder text shown on the editor canvas in place of the
// real value this binding would resolve to in production (this editor has
// no real Invoice/Client/FreelancerProfile to read from — same "baked-in
// placeholder" convention every existing catalog item already uses, e.g.
// invoiceNumber's 'INV-0001').
export const BINDING_OPTIONS = [
  { value: 'invoice.number', label: 'Invoice number', sample: 'INV-0001' },
  { value: 'invoice.issue_date', label: 'Issue date', sample: '01-01-2026' },
  { value: 'invoice.due_date', label: 'Due date', sample: '15-01-2026' },
  { value: 'invoice.subtotal', label: 'Subtotal', sample: '$2,930.00' },
  { value: 'invoice.tax_amount', label: 'Tax amount', sample: '$146.50' },
  { value: 'invoice.discount_amount', label: 'Discount amount', sample: '−$100.00' },
  { value: 'invoice.notes', label: 'Notes', sample: 'Thank you for your business.' },
  { value: 'invoice.terms', label: 'Terms', sample: 'Payment due within 14 days.' },
  { value: 'invoice.payment_link', label: 'Payment link', sample: 'pay.example.com/inv-0001' },
  { value: 'business.name', label: 'Business name', sample: 'Business Name' },
  { value: 'business.email', label: 'Business email', sample: 'owner@business.com' },
  { value: 'business.address_line1', label: 'Business address', sample: '456 Business Ave' },
  { value: 'business.city', label: 'Business city', sample: 'Karachi' },
  { value: 'business.country', label: 'Business country', sample: 'Pakistan' },
  { value: 'business.phone', label: 'Business phone', sample: '+92 300 1234567' },
  { value: 'client.name', label: 'Client name', sample: 'Client Name' },
  { value: 'client.company', label: 'Client company', sample: 'Client Company' },
  { value: 'client.email', label: 'Client email', sample: 'client@email.com' },
  { value: 'client.phone', label: 'Client phone', sample: '+1 555 0100' },
  { value: 'client.address', label: 'Client address', sample: '123 Client Street' },
  { value: 'totals.grand_total', label: 'Grand total', sample: '$2,976.50' },
  { value: 'business.bank_name', label: 'Bank name', sample: 'Example Bank' },
  { value: 'business.bank_account_number', label: 'Bank account number', sample: '••1234' },
  { value: 'business.jazzcash_number', label: 'JazzCash number', sample: '0300-1234567' },
  { value: 'business.easypaisa_number', label: 'Easypaisa number', sample: '0300-1234567' },
  { value: 'business.payoneer_email', label: 'Payoneer email', sample: 'pay@business.com' },
  // Phase 3a additions (design_renderer.py's BINDING_RESOLVERS, ~line 163
  // and ~183) — sample strings mirror each resolver's real output shape.
  { value: 'invoice.client_currency_conversion', label: 'Currency conversion', sample: '≈ Rs280,000.00 at rate 280.00' },
  { value: 'invoice.tax_rate', label: 'Tax rate', sample: '5%' },
];

const BY_VALUE = new Map(BINDING_OPTIONS.map((b) => [b.value, b]));

export function bindingLabel(value) {
  return BY_VALUE.get(value)?.label || value;
}

// Placeholder canvas text for a binding — including one NOT in
// BINDING_OPTIONS (an unfamiliar binding string, e.g. imported from a
// hand-authored production design_data this editor's own catalog never
// anticipated — see the "generic construction" import capability). A
// genuinely unrecognized binding still needs SOMETHING to render on
// canvas, so this falls back to a generic bracketed placeholder rather
// than throwing or rendering blank.
export function bindingSample(value) {
  const known = BY_VALUE.get(value);
  if (known) return known.sample;
  return `[${value}]`;
}

export function isKnownBinding(value) {
  return BY_VALUE.has(value);
}
