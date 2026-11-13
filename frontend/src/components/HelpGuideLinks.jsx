// src/components/HelpGuideLinks.jsx
//
// A list of guides: each row is one router link with the guide's title, its one-line summary and, when the topic is known, a
// small neutral topic label written as a word. Used for popular guides, search results, the guides under an answer and the
// related guides of a guide. Hover uses hoverProps (pointer events, touch ignored); the browser's focus ring is kept.
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { hoverProps } from '@/lib/hoverProps'
import { guideRoute, topicLabel } from '@/pages/helpHelpers'

export default function HelpGuideLinks({ guides, titles }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {guides.map((guide) => {
        const label = topicLabel(guide, titles)
        return (
          <li key={guide.slug}>
            <Link
              to={guideRoute(guide.slug)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', margin: '0 -12px', borderRadius: 'var(--radius-md)',
                textDecoration: 'none', color: 'inherit', background: 'transparent', transition: 'background 0.15s ease',
              }}
              {...hoverProps(
                (e) => { e.currentTarget.style.background = 'var(--bg-surface-3)' },
                (e) => { e.currentTarget.style.background = 'transparent' },
              )}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{guide.title}</span>
                  {label && (
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--bg-surface-3)', color: 'var(--text-secondary)' }}>
                      {label}
                    </span>
                  )}
                </span>
                <span style={{ display: 'block', marginTop: 2, fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{guide.summary}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
