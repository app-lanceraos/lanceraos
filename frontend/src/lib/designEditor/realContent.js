// src/lib/designEditor/realContent.js
//
// 20 August 2026 — Step 8b canvas rework (see DECISIONS.md's "canvas must
// render the real thing" entry). Fetches the REAL rendered markup for the
// design currently being edited — the exact same backend render path
// (apps/invoices/design_renderer.py's render_editor_canvas_html, via
// design_preview.py) a real invoice using this design would produce, with
// the real logged-in freelancer's own profile data — and parses out what
// the editor needs: the real per-element content fragments (indexed,
// matching design_data.zone_1/zone_2.elements array order exactly) and the
// real CSS (including @font-face) to load into the canvas iframe.
//
// Deliberately NOT a raw-HTML-into-GrapesJS import (editor.setComponents
// (fullHtmlString) relying on GrapesJS's own parser to figure out the
// right component types for arbitrary real markup) — that would mean
// trusting GrapesJS's HTML/CSS extraction heuristics for something this
// precise. Instead, this module extracts real content STRINGS by index,
// and serialization.js's own existing, proven position/size tree-building
// (unchanged, still mm<->px at the same two boundaries it always was)
// embeds them as each component's raw `content` — GrapesJS's own
// documented mechanism for "manage the wrapper/position via a real
// component type, but the inner HTML is plain content, not further
// parsed into child components." This keeps 100% of the existing,
// working coordinate math untouched while making the CONTENT genuinely
// real — see DECISIONS.md for why this, not full-DOM isComponent
// matching, is the real fix for item 3's coordinate-fidelity concern
// (the actual root cause was never a unit-conversion bug — that math was
// already self-consistent — it was that resize/reflow decisions were
// being made against synthetic placeholder content with zero relationship
// to what the real business name/address/totals variant would actually
// need, in a font the canvas never even loaded).
import api from '@/lib/api'

/**
 * Fetches and parses the real canvas HTML for the given design state.
 * Returns { cssText, zone1Content: string[], zone2Content: string[],
 * tableHeaderCellCss, tableRowCellCss, tableOuterStyle }.
 */
export async function fetchRealCanvasContent(designData, baseTemplate, colorVariant, sampleRows) {
  const { data: html } = await api.post('/invoices/designs/editor-canvas/', {
    design_data: designData, base_template: baseTemplate, color_variant: colorVariant || '', sample_rows: sampleRows,
  })

  const doc = new DOMParser().parseFromString(html, 'text/html')

  const cssText = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent).join('\n')

  const zone1Content = extractIndexed(doc, '1')
  const zone2Content = extractIndexed(doc, '2')

  const table = doc.getElementById('lancera-table')

  return {
    cssText,
    zone1Content,
    zone2Content,
    tableHeadHtml: table ? table.querySelector('thead').outerHTML : '',
    tableRowCellCss: table ? (table.getAttribute('data-row-cell-css') || '') : '',
  }
}

/**
 * Fetches ONE real element's own content fragment — the canvas's live
 * style-panel-driven refresh. Returns the raw inner HTML string
 * (_dynamic_element_content.html's real output for this exact type+style),
 * never the whole canvas — every other element's current live position on
 * the canvas is left completely untouched by this call.
 */
export async function fetchRealElementContent(elType, style, baseTemplate, colorVariant) {
  const { data } = await api.post('/invoices/designs/editor-element/', {
    el_type: elType, style, base_template: baseTemplate, color_variant: colorVariant || '',
  })
  return data.html
}

function extractIndexed(doc, zone) {
  const nodes = doc.querySelectorAll(`[data-el-zone="${zone}"]`)
  const byIndex = []
  nodes.forEach((node) => {
    const index = parseInt(node.getAttribute('data-el-index'), 10)
    byIndex[index] = node.innerHTML
  })
  return byIndex
}
