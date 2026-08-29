// src/lib/designEditor/canvasApi.js
//
// LanceraOS Template Builder — the editor's own backend calls (initial
// canvas load, live per-element content refresh, Template Health,
// blank/builtin template data). Every endpoint here lives in
// apps/invoices/views_design_editor.py; design_data always travels in
// the request body, never fetched by id from another user's row.
import api from '@/lib/api'

export async function fetchDesignTemplates() {
  const { data } = await api.get('/invoices/designs/templates/')
  return data // { templates: [...], variants: { professional: [...], ... } }
}

export async function fetchBuiltinDesignData(baseTemplate) {
  const { data } = await api.get('/invoices/designs/template/', { params: { base_template: baseTemplate } })
  return data.design_data
}

// The editor's second first-class starting mode ("blank canvas AND
// built-in templates, both fully editable"). Same endpoint as
// fetchBuiltinDesignData, `?blank=true` instead — the underlying color/
// typography foundation (`baseTemplate`) still applies, only the
// pre-arranged content differs.
export async function fetchBlankDesignData(baseTemplate) {
  const { data } = await api.get('/invoices/designs/template/', { params: { base_template: baseTemplate, blank: 'true' } })
  return data.design_data
}

// `contentMode` ('alias' | 'real') — 'alias' (the default the page
// itself passes) shows semantic field labels ("Client Name") instead of
// real/sample data, so the canvas reads as a design environment, not a
// live invoice preview, and never collapses to zero size just because a
// real field happens to be blank.
export async function fetchCanvasDocument(designData, baseTemplate, colorVariant, contentMode = 'alias') {
  const { data } = await api.post('/invoices/designs/canvas/', {
    design_data: designData, base_template: baseTemplate, color_variant: colorVariant || '', content_mode: contentMode,
  })
  return data
}

// `binding` is optional (undefined/null for a static, unbound text
// element or any semantic type) — threaded through so the backend can
// resolve a bound generic text element's real/alias value on a
// debounced style-panel refresh without blanking its own content.
export async function fetchElementContent(kind, elType, style, overrides, baseTemplate, colorVariant, contentMode = 'alias', binding = null) {
  const { data } = await api.post('/invoices/designs/canvas-element/', {
    kind, el_type: elType, style, overrides, base_template: baseTemplate, color_variant: colorVariant || '',
    content_mode: contentMode, binding: binding || undefined,
  })
  return data.html
}

// The Template Health check. Runs every real validation layer
// (apps.invoices.design_validation.run_validation) against the editor's
// CURRENT design_data, live, on demand. Returns {valid, errors, warnings};
// each entry is {code, severity, category, component_id, message}.
export async function fetchDesignValidation(designData, baseTemplate, colorVariant) {
  const { data } = await api.post('/invoices/designs/validate/', {
    design_data: designData, base_template: baseTemplate, color_variant: colorVariant || '',
  })
  return data
}
