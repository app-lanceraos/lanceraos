// src/components/design-editor/DesignCanvasPreview.jsx
//
// A lightweight, non-interactive preview renderer for the Path 1 gallery —
// real design_data + real sample invoice data + the user's own logo when
// they have one, scaled to a small card. Deliberately not a pixel-perfect
// reproduction of the actual WeasyPrint-rendered PDF (that's apps/invoices/
// pdf_generator.py's job, a different rendering pipeline entirely) — this
// is a fast, honest approximation using the same element-type vocabulary
// the editor itself edits, at gallery-thumbnail scale.
import { MM_TO_PX, PAGE_WIDTH_MM, ZONE_1_HEIGHT_MM } from '@/lib/designEditor/constants'

const SAMPLE_CLIENT = { name: 'Callahan & Reyes LLP', email: 'accounts@callahanreyes.com' }
const SAMPLE_BUSINESS = { name: 'Horizon Studio', tagline: 'Brand & Product Design' }
const SAMPLE_DATES = { invoiceNumber: 'INV-2026-0042', issue: '09 Aug 2026', due: '23 Aug 2026' }
const SAMPLE_ITEMS = [
  { desc: 'Homepage redesign', total: '$1,200.00' },
  { desc: 'Design system components', total: '$860.00' },
  { desc: 'Revisions round 1', total: '$240.00' },
]

function zone1ElementLabel(el) {
  switch (el.type) {
    case 'logo': return null // rendered as an image below
    case 'business_info': return el.style?.label === 'From' ? SAMPLE_BUSINESS.name : SAMPLE_BUSINESS.name
    case 'client_info': return SAMPLE_CLIENT.name
    case 'dates': return `${SAMPLE_DATES.invoiceNumber}`
    default: return el.type
  }
}

export default function DesignCanvasPreview({ designData, logoUrl, scale = 0.42 }) {
  const widthPx = Math.round(PAGE_WIDTH_MM * MM_TO_PX * scale)
  const zone1HeightPx = Math.round(ZONE_1_HEIGHT_MM * MM_TO_PX * scale)

  return (
    <div style={{
      width: widthPx, background: '#fff', border: '1px solid var(--border-default)',
      borderRadius: 6, overflow: 'hidden', fontFamily: 'sans-serif',
    }}>
      <div style={{ position: 'relative', width: '100%', height: zone1HeightPx, background: '#fafafa' }}>
        {(designData?.zone_1?.elements || []).map((el, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: el.x * MM_TO_PX * scale, top: el.y * MM_TO_PX * scale,
              width: el.width * MM_TO_PX * scale, height: el.height * MM_TO_PX * scale,
              display: 'flex', alignItems: 'center', justifyContent: el.style?.align === 'right' ? 'flex-end' : 'flex-start',
              overflow: 'hidden', fontSize: 9 * scale * 2.4,
              color: el.style?.color || '#333',
              background: el.type === 'logo' ? 'transparent' : 'rgba(0,0,0,0.03)',
            }}
          >
            {el.type === 'logo'
              ? (logoUrl
                ? <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <div style={{ width: '100%', height: '100%', background: '#e0e0e0', borderRadius: 4 }} />)
              : <span style={{ padding: 2, whiteSpace: 'nowrap' }}>{zone1ElementLabel(el)}</span>}
          </div>
        ))}
      </div>

      <div style={{ padding: 6 * scale * 2.4, fontSize: 8 * scale * 2.4, borderTop: '1px solid #eee' }}>
        {SAMPLE_ITEMS.slice(0, 2).map((item, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: '#555' }}>
            <span>{item.desc}</span><span>{item.total}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', marginTop: 2, borderTop: '1px solid #eee', fontWeight: 700, color: '#222' }}>
          <span>Total due</span><span>$2,300.00</span>
        </div>
      </div>
    </div>
  )
}
