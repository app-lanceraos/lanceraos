// src/components/HelpTopics.jsx
//
// "Browse by topic": a grid of cards, one per topic, each with its blurb and a link to every guide in it, each with a trailing chevron so it reads as tappable without a hover. Always expanded
// (no fold-outs): the page is a table of contents, so a person can see everything that exists without opening anything.
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useId } from 'react'

import { hoverProps } from '@/lib/hoverProps'
import { TOPICS_TITLE, guideRoute } from '@/pages/helpHelpers'

export default function HelpTopics({ topics }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} style={{ marginBottom: 16 }}>
      <h2 id={headingId} style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: 'var(--text-primary)' }}>
        {TOPICS_TITLE}
      </h2>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {topics.map((topic) => (
          <TopicCard key={topic.slug} topic={topic} />
        ))}
      </div>
    </section>
  )
}

function TopicCard({ topic }) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', minWidth: 0 }}
    >
      <h3 id={headingId} style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{topic.title}</h3>
      <p style={{ margin: '4px 0 10px', fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{topic.blurb}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {topic.guides.map((guide) => (
          <li key={guide.slug}>
            <Link
              to={guideRoute(guide.slug)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', margin: '0 -10px',
                borderRadius: 'var(--radius-md)', textDecoration: 'none', fontSize: '0.85rem', color: 'var(--text-primary)',
                background: 'transparent', transition: 'background 0.15s ease',
              }}
              {...hoverProps(
                (e) => { e.currentTarget.style.background = 'var(--bg-surface-3)' },
                (e) => { e.currentTarget.style.background = 'transparent' },
              )}
            >
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{guide.title}</span>
              {/* Without a hover (a phone), the chevron is what says "this opens a guide" (Prompt 27, B1). */}
              <ChevronRight size={16} aria-hidden="true" data-guide-link-cue="" style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
