// src/lib/designEditor/constants.js
//
// Mirrors apps/invoices/design_schema.py's ZONE_1_TYPES / ZONE_2_TYPES /
// PAIRABLE_ZONE_2_TYPES exactly — the backend is the real source of truth
// and does the actual validation (InvoiceDesignSerializer.validate_design_data);
// this file exists only so the editor's block palette and the pairing-toggle
// UI restriction (Step 8b's own requirement: "a real UI affordance... don't
// just let the user attempt anything and rely on the save-time 400") can know
// the vocabulary without a round-trip. Kept in sync by hand — flagged here
// deliberately rather than hidden, same tradeoff as builtinDesigns.js's
// design_seeds.py mirror.
import { Building2, CalendarDays, FileSignature, Image as ImageIcon, StickyNote, User, Wallet } from 'lucide-react'

export const ZONE_1_TYPES = ['logo', 'business_info', 'client_info', 'dates']
export const ZONE_2_TYPES = ['totals', 'notes', 'signature', 'payment_info']
export const PAIRABLE_ZONE_2_TYPES = ['signature', 'payment_info']

// mm <-> px conversion for the canvas — 96dpi, the standard CSS px-per-inch
// assumption (25.4mm / inch). design_data itself is always mm (the schema's
// own unit); the canvas edits in px internally (GrapesJS's drag/resize math
// is px-native) and this is the single conversion boundary, applied only at
// load (mm -> px) and save (px -> mm).
export const MM_TO_PX = 96 / 25.4
export const PX_TO_MM = 25.4 / 96

export const PAGE_WIDTH_MM = 210 // A4
// Zone 1's own editable region height — not derived from any one template
// (the 3 seeds top out around y+height=76mm), a generous fixed canvas height
// so a user has real room to place elements. Not a schema field; an editor
// presentation choice only.
export const ZONE_1_HEIGHT_MM = 100

export const ZONE_1_TYPE_META = {
  logo: { label: 'Logo', icon: ImageIcon, defaultWidth: 15, defaultHeight: 15 },
  business_info: { label: 'Business Info', icon: Building2, defaultWidth: 70, defaultHeight: 20 },
  client_info: { label: 'Client Info', icon: User, defaultWidth: 70, defaultHeight: 26 },
  dates: { label: 'Dates', icon: CalendarDays, defaultWidth: 55, defaultHeight: 18 },
}

export const ZONE_2_TYPE_META = {
  totals: { label: 'Totals', icon: Wallet, mandatory: true },
  notes: { label: 'Notes', icon: StickyNote, mandatory: false },
  signature: { label: 'Signature', icon: FileSignature, mandatory: false, pairable: true },
  payment_info: { label: 'Payment Info', icon: Wallet, mandatory: false, pairable: true },
}

export const TABLE_ELEMENT_ID = '__table__' // synthetic id for the mandatory line-items table
export const TOTALS_MIN_COUNT = 1

// The true "blank" starting point for Path 2 — the schema's own mandatory
// elements (table, one totals block) with everything else empty, rather than
// a literal {} that would fail validate_design_data_schema outright.
export const BLANK_DESIGN_DATA = {
  zone_1: { elements: [] },
  zone_2: {
    table: { style: {} },
    elements: [
      { type: 'totals', spacing_after_previous: 6, style: {} },
    ],
  },
}
