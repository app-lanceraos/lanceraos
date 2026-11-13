// src/components/HelpBlocks.jsx
//
// Draws the typed blocks of a guide or of a written answer: paragraph, numbered steps, note, link. ONE component for both, so
// an answer can never look different from a guide. Only valid blocks are drawn (renderableBlocks drops the rest); every text is
// a plain React text node, never HTML; a link goes through the router and only when `to` is an in-app path.
import { ArrowRight, Info } from 'lucide-react'
import { Link } from 'react-router-dom'

import { renderableBlocks } from '@/pages/helpHelpers'

const TEXT = { margin: 0, fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-primary)', overflowWrap: 'anywhere' }

export default function HelpBlocks({ blocks }) {
  const list = renderableBlocks(blocks)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {list.map((block, index) => {
        const key = `${index}-${block.type}`
        if (block.type === 'p') return <p key={key} style={TEXT}>{block.text}</p>
        if (block.type === 'steps') {
          return (
            <ol key={key} style={{ ...TEXT, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {block.items.map((item, i) => <li key={`${i}-${item}`} style={{ paddingLeft: 4 }}>{item}</li>)}
            </ol>
          )
        }
        if (block.type === 'note') {
          return (
            <div
              key={key}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
              }}
            >
              <Info size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-tertiary)' }} />
              <p style={{ ...TEXT, color: 'var(--text-secondary)' }}>{block.text}</p>
            </div>
          )
        }
        return (
          <div key={key}>
            <Link to={block.to} className="fos-btn fos-btn-ghost" style={{ textDecoration: 'none', maxWidth: '100%', textAlign: 'left' }}>
              <span style={{ overflowWrap: 'anywhere' }}>{block.label}</span>
              <ArrowRight size={15} aria-hidden="true" style={{ flexShrink: 0 }} />
            </Link>
          </div>
        )
      })}
    </div>
  )
}
