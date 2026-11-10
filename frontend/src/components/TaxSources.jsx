// src/components/TaxSources.jsx
//
// "How this works": the sourced facts behind the numbers (GET /tax/law/), each with how sure we are and where it came from.
// The fact text is the server's, rendered as a plain text node. The confidence legend is static text taken from TAX_LAW.md and is
// part of what the pre-launch reviewer reads. External links open in a new tab with rel="noopener noreferrer", and only for
// absolute https: URLs; any other scheme is shown as plain text. A link key the page does not know is not rendered.
import { ExternalLink, RefreshCw } from 'lucide-react'

import DashboardCard from './DashboardCard'
import FosAlert from './FosAlert'
import ReportNote from './ReportNote'
import {
  CONFIDENCE_LEGEND, LAW_LOADING_LABEL, LINKS_HEADING, RELOAD_LABEL, SOURCES_HEADING, SOURCES_INTRO, checkedLine, confidenceWord, factSources, linkLabel,
  safeHttpsUrl,
} from '@/pages/taxHelpers'

const LINK_STYLE = { color: 'var(--accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, overflowWrap: 'anywhere' }

function ExternalAnchor({ url, children }) {
  const safe = safeHttpsUrl(url)
  if (!safe) return <span style={{ overflowWrap: 'anywhere' }}>{children}</span>
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>
      {children} <ExternalLink size={12} aria-hidden="true" />
    </a>
  )
}

function Badge({ children }) {
  return (
    <span style={{ flexShrink: 0, fontSize: '0.7rem', fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--radius-full)', background: 'var(--bg-surface-3)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

function Skeleton() {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 20px' }}>
      <div style={{ height: 14, width: '40%', marginBottom: 16, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      <div style={{ height: 70, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
    </div>
  )
}

export default function TaxSources({ law, loading, error, onReload }) {
  if (!law && error) {
    return (
      <>
        <FosAlert type="error" style={{ marginBottom: 12 }}>{error}</FosAlert>
        <button type="button" className="fos-btn fos-btn-ghost" onClick={onReload}>
          <RefreshCw size={14} aria-hidden="true" /> {RELOAD_LABEL}
        </button>
      </>
    )
  }

  if (!law) {
    return (
      <div role="status" aria-label={LAW_LOADING_LABEL} aria-busy={loading ? 'true' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    )
  }

  const links = Object.entries(law.links || {}).map(([key, url]) => ({ key, url, label: linkLabel(key) })).filter((l) => l.label)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>{SOURCES_INTRO}</p>
        <ReportNote>{checkedLine(law)}</ReportNote>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
          {CONFIDENCE_LEGEND.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>

      {law.facts.map((fact) => {
        const sources = factSources(fact, law)
        return (
          <DashboardCard key={fact.id} id={`tax-fact-${fact.id}`} title={fact.title} action={<Badge>{confidenceWord(fact.confidence)}</Badge>}>
            <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{fact.text}</p>
            {sources.length > 0 && (
              <>
                <h3 style={{ margin: '14px 0 6px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{SOURCES_HEADING}</h3>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {sources.map((source) => (
                    <li key={source.key}><ExternalAnchor url={source.url}>{source.label}</ExternalAnchor></li>
                  ))}
                </ul>
              </>
            )}
          </DashboardCard>
        )
      })}

      {links.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 8px', fontSize: '0.88rem', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: 'var(--text-primary)' }}>{LINKS_HEADING}</h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.84rem' }}>
            {links.map((link) => <ExternalAnchor key={link.key} url={link.url}>{link.label}</ExternalAnchor>)}
          </div>
        </div>
      )}
    </div>
  )
}
