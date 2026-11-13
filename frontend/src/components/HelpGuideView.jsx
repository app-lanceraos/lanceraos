// src/components/HelpGuideView.jsx
//
// One guide (/help/<slug>). States: loading (a skeleton of the final footprint under one status line), not found (a guide that
// does not exist will not appear, so there is no Reload), any other failure (alert + Reload), and the guide itself: back link,
// topic label, title (the focus target), summary, the blocks, "Last checked on ...", and related guides. An invalid slug is the
// not-found state with no request at all. `loading` is true also while a DIFFERENT guide's data is still on screen, so the
// previous guide is never shown under the new URL.
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

import FosAlert from '@/components/FosAlert'
import HelpBlocks from '@/components/HelpBlocks'
import HelpCard, { HelpSkeletonLines } from '@/components/HelpCard'
import HelpGuideLinks from '@/components/HelpGuideLinks'
import { visuallyHidden } from '@/pages/dashboardHelpers'
import {
  BACK_TO_HELP, GUIDE_LOADING, GUIDE_NOT_FOUND, GUIDE_NOT_FOUND_HINT, RELATED_TITLE, RELOAD, checkedLine, isNotFoundMessage,
} from '@/pages/helpHelpers'

function BackLink() {
  return (
    <Link to="/help" className="fos-btn fos-btn-ghost" style={{ textDecoration: 'none', padding: '7px 14px', fontSize: '0.82rem' }}>
      <ArrowLeft size={15} aria-hidden="true" />
      {BACK_TO_HELP}
    </Link>
  )
}

export default function HelpGuideView({ notFound, loading, error, onReload, guide, titles, headingRef }) {
  if (notFound || isNotFoundMessage(error)) {
    return (
      <HelpCard title={GUIDE_NOT_FOUND} headingRef={headingRef}>
        <p style={{ margin: '0 0 14px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{GUIDE_NOT_FOUND_HINT}</p>
        <BackLink />
      </HelpCard>
    )
  }

  if (error) {
    return (
      <div>
        <div role="alert"><FosAlert type="error">{error}</FosAlert></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <button type="button" className="fos-btn fos-btn-ghost" onClick={onReload}>{RELOAD}</button>
          <BackLink />
        </div>
      </div>
    )
  }

  if (loading || !guide) {
    return (
      <div>
        <div role="status" style={visuallyHidden}>{GUIDE_LOADING}</div>
        <div aria-hidden="true" style={{ marginBottom: 14, height: 34, width: 110, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
        <div aria-hidden="true" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
          <div style={{ height: 18, width: '45%', marginBottom: 18, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
          <HelpSkeletonLines count={5} />
        </div>
      </div>
    )
  }

  const checked = checkedLine(guide.checked_on)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <BackLink />
        <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--radius-full)', background: 'var(--bg-surface-3)', color: 'var(--text-secondary)' }}>
          {guide.topic_title}
        </span>
      </div>
      <HelpCard title={guide.title} subtitle={guide.summary} headingRef={headingRef}>
        <HelpBlocks blocks={guide.blocks} />
        {checked && <p style={{ margin: '16px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{checked}</p>}
      </HelpCard>
      {guide.related.length > 0 && (
        <HelpCard title={RELATED_TITLE}>
          <HelpGuideLinks guides={guide.related} titles={titles} />
        </HelpCard>
      )}
    </div>
  )
}
