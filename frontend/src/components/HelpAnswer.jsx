// src/components/HelpAnswer.jsx
//
// One result of the ask request (DESIGN.md "Help page"; the table is Appendix B of Prompt 26).
//   answered     -> "You asked: ...", the answer blocks (the SAME HelpBlocks a guide uses), the source note, the guides it was
//                   written from, and the rating row.
//   guides_only  -> "You asked: ...", the SERVER's notice in an info alert, the closest guides, and, only if the server sent a
//                   plain address, "Still stuck? Email ...". No rating, no source note.
//   off_topic    -> the notice only.
// The question is shown back as a text node. `reason`, `ai_reason`, `cached` and `library_version` are never shown. The card
// heading is the focus target (the page moves focus to it when a result arrives).
import FosAlert from '@/components/FosAlert'
import HelpBlocks from '@/components/HelpBlocks'
import HelpCard from '@/components/HelpCard'
import HelpGuideLinks from '@/components/HelpGuideLinks'
import HelpRating from '@/components/HelpRating'
import {
  ANSWER_SOURCE_NOTE, ANSWER_TITLE, CLOSEST_GUIDES, FROM_GUIDES, NOTICE_TITLE, SUPPORT_LEAD, YOU_ASKED, ratingSlugs, supportEmailFor, supportHref,
} from '@/pages/helpHelpers'

const SUBHEADING = { margin: '16px 0 6px', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }

export default function HelpAnswer({ result, question, titles, rating, headingRef }) {
  const answered = result.outcome === 'answered'
  const support = supportEmailFor(result)
  const canRate = answered && ratingSlugs(result).length >= 1

  return (
    <HelpCard title={answered ? ANSWER_TITLE : NOTICE_TITLE} headingRef={headingRef}>
      <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
        <span style={{ fontWeight: 600 }}>{YOU_ASKED}</span> {question}
      </p>

      {answered ? (
        <>
          <HelpBlocks blocks={result.answer.blocks} />
          <p style={{ margin: '12px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{ANSWER_SOURCE_NOTE}</p>
        </>
      ) : (
        <FosAlert type="info">{result.notice}</FosAlert>
      )}

      {result.guides.length > 0 && (
        <>
          <h3 style={SUBHEADING}>{answered ? FROM_GUIDES : CLOSEST_GUIDES}</h3>
          <HelpGuideLinks guides={result.guides} titles={titles} />
        </>
      )}

      {support && (
        <p style={{ margin: '14px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
          {SUPPORT_LEAD} <a href={supportHref(support)} style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'underline' }}>{support}</a>
        </p>
      )}

      {canRate && <HelpRating status={rating.status} message={rating.message} onRate={rating.rate} />}
    </HelpCard>
  )
}
