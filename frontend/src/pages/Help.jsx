// src/pages/Help.jsx
//
// The Help page (/help and /help/<slug>, Prompt 26). ONE route (`/help/:slug?`) so React Router keeps this component mounted
// when the slug changes: Back from a guide returns to the typed text, the search results and (in ask mode) the answer on screen
// with no new request. The page decides between the "home" view and the "guide" view.
//
// Two modes, decided by GET /help/guides/ `answers_enabled` and failing closed (decision H24):
//   * search mode (the shipped default; also any unusable or failed index): one box that searches the guides as you type. Nothing
//     typed here is EVER sent to /help/ask/.
//   * ask mode (answers_enabled === true, the strict boolean): one box and an explicit Ask button, the AI disclosure as visible
//     text, a written answer or the server's notice, and a rating row on a real answer.
// A result area REPLACES the browse area (Popular guides + Browse by topic) while it has something to show; clearing the box
// brings the browse area back.
//
// PITFALLS: nothing a person types is kept (no URL parameter, no storage, no history entry, no previous_question); the guide
// and the answer are drawn only when complete (a half-drawn page is never shown); the page scrolls inside AppShell's inner
// container, not the window, so a slug change resets THAT scroll parent; every sentence of a guide, a notice and an answer is the
// SERVER's; AI off, busy, failing or rejected is a normal 200 answer, never an error screen.
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import FosAlert from '@/components/FosAlert'
import HelpAnswer from '@/components/HelpAnswer'
import HelpCard, { HelpSkeletonLines } from '@/components/HelpCard'
import HelpGuideLinks from '@/components/HelpGuideLinks'
import HelpGuideView from '@/components/HelpGuideView'
import HelpSearchBox from '@/components/HelpSearchBox'
import HelpTopics from '@/components/HelpTopics'
import useDebouncedValue from '@/hooks/useDebouncedValue'
import useHelpAsk from '@/hooks/useHelpAsk'
import useHelpRating from '@/hooks/useHelpRating'
import useReportData from '@/hooks/useReportData'
import useTitle from '@/hooks/useTitle'
import { visuallyHidden } from '@/pages/dashboardHelpers'
import {
  ASK_DISCLOSURE, ASK_HINT, ASK_WORKING, GUIDE_LOAD_FALLBACK, INDEX_LOADING, INDEX_LOAD_FALLBACK, NO_RESULTS, POPULAR_TITLE, RELOAD,
  RESULTS_TITLE, SEARCH_DEBOUNCE_MS, SEARCH_FALLBACK, SEARCH_LOADING, SEARCH_MIN_CHARS, SEARCH_TOO_SHORT, answersEnabled, canAsk,
  documentTitle, guideIsUsable, guidePath, guideErrorMessage, indexErrorMessage, indexIsUsable, isValidSlug, resultCountLine, searchActive,
  searchErrorMessage, searchIsUsable, searchParams, searchQuery, topicTitles,
} from './helpHelpers'

const COLUMN = { maxWidth: 860, minWidth: 0 }

// The nearest ancestor that scrolls (AppShell's inner container), or null when the window scrolls.
function scrollParentOf(element) {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const overflowY = window.getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

function ReloadAlert({ message, onReload }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div role="alert"><FosAlert type="error">{message}</FosAlert></div>
      <button type="button" className="fos-btn fos-btn-ghost" onClick={onReload} style={{ marginTop: 10 }}>{RELOAD}</button>
    </div>
  )
}

export default function Help() {
  const { slug } = useParams()
  const guideMode = slug !== undefined

  const [text, setText] = useState('')
  const debounced = useDebouncedValue(text, SEARCH_DEBOUNCE_MS)

  const index = useReportData({ path: '/help/guides/', params: {}, errorMessage: indexErrorMessage })
  const indexData = indexIsUsable(index.data) ? index.data : null
  const indexFailure = index.error || (index.data && !indexData ? INDEX_LOAD_FALLBACK : '')
  const answersOn = Boolean(indexData) && answersEnabled(indexData)
  const titles = topicTitles(indexData)

  const search = useReportData({
    path: '/help/search/',
    params: searchParams(debounced),
    enabled: !index.loading && !answersOn && searchActive(text) && searchActive(debounced),
    errorMessage: searchErrorMessage,
  })
  const searchData = searchIsUsable(search.data) ? search.data : null
  const searchFailure = search.error || (search.data && !searchData ? SEARCH_FALLBACK : '')

  const askState = useHelpAsk()
  const rating = useHelpRating(askState.result)

  const slugValid = guideMode && isValidSlug(slug)
  const guide = useReportData({ path: slugValid ? guidePath(slug) : '/help/guides/', params: {}, enabled: slugValid, errorMessage: guideErrorMessage })
  const guideForSlug = guide.data && guide.data.slug === slug ? guide.data : null
  const guideData = guideForSlug && guideIsUsable(guideForSlug) ? guideForSlug : null
  const guideFailure = guide.error || (guideForSlug && !guideData ? GUIDE_LOAD_FALLBACK : '')

  useTitle(documentTitle(guideMode ? guideData : null))

  // ── Slug change: reset the scroll parent, and move focus to the guide heading once the guide is shown ──────────────
  const rootRef = useRef(null)
  const guideHeadingRef = useRef(null)
  const answerHeadingRef = useRef(null)
  const previousSlug = useRef(slug)
  const focusGuideWhenShown = useRef(false)

  useEffect(() => {
    if (previousSlug.current === slug) return
    previousSlug.current = slug
    const parent = scrollParentOf(rootRef.current)
    if (parent) parent.scrollTop = 0
    else window.scrollTo(0, 0)
    focusGuideWhenShown.current = slug !== undefined
  }, [slug])

  const guideShown = Boolean(guideData) || Boolean(guideFailure) || (guideMode && !slugValid)
  useEffect(() => {
    if (guideShown && focusGuideWhenShown.current) {
      focusGuideWhenShown.current = false
      guideHeadingRef.current?.focus()
    }
  }, [guideShown, guideData])

  // ── A written answer arrived: move focus to its heading so a screen reader announces it ──────────────────────────
  useEffect(() => {
    if (answersOn && askState.result) answerHeadingRef.current?.focus()
  }, [answersOn, askState.result])

  const clear = () => {
    setText('')
    askState.clear()
  }

  // ── Home view pieces ──────────────────────────────────────────────────────────────────────────────────────────────
  const trimmedLength = searchQuery(text).length
  const tooShort = !answersOn && trimmedLength > 0 && trimmedLength < SEARCH_MIN_CHARS
  const showResults = !answersOn && searchActive(text)
  const stale = search.loading || searchQuery(debounced) !== searchQuery(text)
  const waitingForResults = showResults && !searchData && !searchFailure
  const askArea = answersOn && (askState.busy || Boolean(askState.result))
  const resultArea = showResults || askArea

  let liveLine = ''
  if (waitingForResults) liveLine = SEARCH_LOADING
  else if (showResults && searchData && !stale) liveLine = resultCountLine(searchData.results.length)

  const box = index.loading ? (
    <div style={{ marginBottom: 16 }}>
      <div role="status" style={visuallyHidden}>{INDEX_LOADING}</div>
      <div aria-hidden="true" style={{ height: 46, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
    </div>
  ) : (
    <HelpSearchBox
      mode={answersOn ? 'ask' : 'search'} value={text} onChange={setText} onClear={clear}
      onSubmit={() => askState.ask(text)} busy={askState.busy} canSubmit={canAsk(text)}
      hint={answersOn ? ASK_HINT : (tooShort ? SEARCH_TOO_SHORT : '')} disclosure={ASK_DISCLOSURE}
    />
  )

  const homeView = (
    <>
      <div style={COLUMN}>
        {box}

        {!answersOn && !index.loading && <div role="status" style={visuallyHidden}>{liveLine}</div>}

        {showResults && (
          <HelpCard title={RESULTS_TITLE}>
            {searchFailure ? (
              <ReloadAlert message={searchFailure} onReload={search.reload} />
            ) : waitingForResults ? (
              <HelpSkeletonLines count={4} />
            ) : searchData.results.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{NO_RESULTS}</p>
            ) : (
              <div style={{ opacity: stale ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
                <HelpGuideLinks guides={searchData.results} titles={titles} />
              </div>
            )}
          </HelpCard>
        )}

        {answersOn && askState.busy && (
          <div
            role="status"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 16 }}
          >
            <p style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{ASK_WORKING}</p>
            <HelpSkeletonLines count={4} />
          </div>
        )}
        {answersOn && askState.result && (
          <HelpAnswer result={askState.result} question={askState.question} titles={titles} rating={rating} headingRef={answerHeadingRef} />
        )}
        {answersOn && askState.error && (
          <div role="alert" style={{ marginBottom: 16 }}>
            <FosAlert type="error">{askState.error}</FosAlert>
          </div>
        )}

        {!resultArea && indexFailure && <ReloadAlert message={indexFailure} onReload={index.reload} />}
        {!resultArea && !indexFailure && indexData && (
          <HelpCard title={POPULAR_TITLE}>
            <HelpGuideLinks guides={indexData.popular} titles={titles} />
          </HelpCard>
        )}
        {!resultArea && index.loading && (
          <HelpCard title={POPULAR_TITLE}>
            <HelpSkeletonLines count={4} />
          </HelpCard>
        )}
      </div>
      {!resultArea && !indexFailure && indexData && <HelpTopics topics={indexData.topics} />}
    </>
  )

  return (
    <div ref={rootRef} aria-busy={index.loading || (guideMode && guide.loading)}>
      {guideMode ? (
        <div style={COLUMN}>
          <HelpGuideView
            notFound={!slugValid}
            loading={guide.loading || (slugValid && !guideForSlug && !guide.error)}
            error={guideFailure}
            onReload={guide.reload}
            guide={guideData}
            titles={titles}
            headingRef={guideHeadingRef}
          />
        </div>
      ) : homeView}
    </div>
  )
}
