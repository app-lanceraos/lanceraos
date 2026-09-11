// src/lib/designTemplatesApi.js
//
// The Design Gallery's own backend calls for the two "first-class
// starting mode" template payloads (a ready-made builtin, or the same
// builtin's blank-canvas variant) plus the real template/variant
// inventory. Both endpoints live in apps/invoices/views_design_editor.py.
//
// Split out of the old lib/designEditor/canvasApi.js (the GrapesJS
// editor's own API module, removed with that editor — see DECISIONS.md)
// because these two functions have a real second caller (DesignGallery.jsx)
// independent of any editor UI; everything else canvasApi.js exported
// (fetchCanvasDocument/fetchElementContent/fetchDesignValidation) had no
// caller left once GrapesJS was removed and was deleted along with it.
import api from '@/lib/api'

export async function fetchDesignTemplates() {
  const { data } = await api.get('/invoices/designs/templates/')
  return data // { templates: [...], variants: { professional: [...], ... } }
}

// The editor's second first-class starting mode ("blank canvas AND
// built-in templates, both fully editable"). `?blank=true` on the same
// endpoint fetchBuiltinDesignData would use — the underlying color/
// typography foundation (`baseTemplate`) still applies, only the
// pre-arranged content differs.
export async function fetchBlankDesignData(baseTemplate) {
  const { data } = await api.get('/invoices/designs/template/', { params: { base_template: baseTemplate, blank: 'true' } })
  return data.design_data
}
