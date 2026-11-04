// src/pages/ProposalPublic.jsx
//
// /proposal/:token — the page a CLIENT opens from the link in an email or chat.
// No login, no AppShell, no LanceraOS account: the token in the URL is the
// credential. Fixed light palette (DESIGN.md Section 10), never theme tokens.
//
// Rules this page keeps (DECISIONS.md, Proposals frontend part B):
//   * It talks to the backend ONLY through publicApi — a bare Axios instance with
//     no interceptors — so answering can never trigger the CSRF prefetch to
//     /auth/, read a cookie, or reach the refresh -> forced-logout path (D12).
//     It imports neither the auth store nor the shared api, and touches no
//     cookie or browser storage.
//   * Everything shown is escaped text; money comes from the server's strings.
//   * It does not over-claim (D8): the answer is final, "your answer has been
//     recorded" — never that the sender was told anything (their bell and email
//     depend on their own settings and on delivery), never a legal claim. The
//     COPY block below is the single home of the wording so a test can scan it.
//   * It stays out of search engines and Referer headers (usePublicPageMeta).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Printer, XCircle } from 'lucide-react'

import { publicApi } from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import usePublicPageMeta from '@/hooks/usePublicPageMeta'
import ProposalDocument from '@/components/ProposalDocument'
import { charCount, formatDate, formatTimestamp } from './proposalHelpers'
import { classifySendFailure } from './proposalLifecycle'

const MESSAGE_MAX = 1000
const NAVY = '#1e3a5f'
const TEXT = '#334155'
const MUTED = '#64748b'
const BORDER = 'rgba(0,0,0,.08)'

export const COPY = {
  loading: 'Loading proposal…',
  responseHeading: 'Your response',
  responseText: 'Choose an option below. You can add a message before you confirm.',
  accept: 'Accept proposal',
  decline: 'Decline proposal',
  confirmHeading: { accept: 'Accept this proposal?', decline: 'Decline this proposal?' },
  messageLabel: (name) => `Message to ${name} (optional)`,
  placeholder: { accept: 'Anything you would like to add?', decline: "Tell them why, if you'd like." },
  tooLong: (n) => `Your message is ${n} character${n === 1 ? '' : 's'} too long.`,
  finality: "Your answer is final. You won't be able to change it afterwards.",
  confirm: { accept: 'Confirm acceptance', decline: 'Confirm decline' },
  back: 'Back',
  busy: 'Sending…',
  resultHeading: { accepted: 'You accepted this proposal', declined: 'You declined this proposal' },
  recorded: 'Your answer has been recorded.',
  yourMessage: 'Your message:',
  expiredHeading: (date) => `This proposal expired on ${date}`,
  expiredText: (name) => `It can no longer be accepted or declined. Please contact ${name} if you would still like to go ahead.`,
  withdrawnHeading: 'This proposal was withdrawn',
  withdrawnText: (name, title) => `${name} withdrew “${title}”. You can no longer accept or decline it. Please contact them if you have questions.`,
  ownerBanner: 'This is a preview of your own proposal. Your client sees the Accept and Decline buttons here.',
  notFoundHeading: "This link doesn't work",
  notFoundText: 'The proposal may not exist, or the link may be incomplete. Please ask the sender to send it again.',
  rateHeading: 'Too many requests',
  rateText: 'Please wait a little while and refresh this page.',
  errorHeading: "We couldn't load this proposal",
  errorText: 'Check your connection and try again.',
  tryAgain: 'Try again',
  race: {
    already_answered: 'This proposal was already answered, so nothing changed.',
    withdrawn: 'This proposal was withdrawn before your answer was recorded.',
    expired: 'This proposal expired before your answer was recorded.',
    owner: "You own this proposal, so you can't answer it.",
  },
  answer429: 'Too many attempts. Please wait a few minutes and try again.',
  answerAmbiguous: "We couldn't record your answer. Please try again.",
  print: 'Print or save as PDF',
}

const PAGE_CSS = `
  .proposal-public-card { padding: 28px 24px; }
  @media (max-width: 560px) { .proposal-public-card { padding: 20px 16px; } }
  .proposal-public-page button:focus-visible, .proposal-public-page textarea:focus-visible { outline: 3px solid #2e5987; outline-offset: 2px; }
  @media print {
    .proposal-public-noprint { display: none !important; }
    html, body, .proposal-public-page { background: #fff !important; }
    .proposal-public-card { box-shadow: none !important; border: none !important; padding: 0 !important; max-width: none !important; }
    .proposal-doc-row, .proposal-doc-section { break-inside: avoid; }
  }
`

const buttonBase = {
  minHeight: 44, padding: '0 22px', borderRadius: 10, fontSize: '0.95rem', fontWeight: 600,
  fontFamily: "'DM Sans', sans-serif", cursor: 'pointer', border: `1.5px solid ${NAVY}`,
}
const primaryButton = { ...buttonBase, background: NAVY, color: '#fff' }
const outlineButton = { ...buttonBase, background: '#fff', color: NAVY }

function Page({ children }) {
  return (
    <main className="proposal-public-page" style={{ minHeight: '100vh', background: '#f8fafc', padding: '24px 12px 56px', fontFamily: "'DM Sans', sans-serif", color: TEXT }}>
      <style>{PAGE_CSS}</style>
      <div className="proposal-public-card" style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
        {children}
      </div>
    </main>
  )
}

function Notice({ icon: Icon, color, heading, children, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '16px 0' }}>
      <Icon size={30} aria-hidden="true" style={{ color, marginBottom: 12 }} />
      <h1 style={{ margin: '0 0 8px', fontSize: '1.2rem', fontWeight: 700, color: NAVY }}>{heading}</h1>
      <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.6, color: MUTED }}>{children}</p>
      {action}
    </div>
  )
}

function SenderName({ name }) {
  return <p style={{ margin: '0 0 6px', fontSize: '0.85rem', fontWeight: 700, color: MUTED, textAlign: 'center', overflowWrap: 'anywhere' }}>{name}</p>
}

const ANSWER_REASONS = new Set(['already_answered', 'withdrawn', 'expired'])

export default function ProposalPublic() {
  const { token } = useParams()
  usePublicPageMeta()

  const [view, setView] = useState('loading') // loading | ready | not_found | rate_limited | error
  const [data, setData] = useState(null)
  const [notice, setNotice] = useState(null)
  const [step, setStep] = useState('choose') // choose | confirm
  const [decision, setDecision] = useState(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [answerError, setAnswerError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const submittingRef = useRef(false)
  const requestRef = useRef(null)
  const confirmHeadingRef = useRef(null)
  const resultHeadingRef = useRef(null)
  const justAnswered = useRef(false)

  useTitle(view === 'ready' && data?.title ? `${data.title} — Proposal` : 'Proposal')

  // One GET at a time; a newer one (or leaving the page) cancels the older.
  const fetchProposal = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const response = await publicApi.get(`/proposals/public/${encodeURIComponent(token)}/`, { signal: controller.signal })
      if (controller.signal.aborted) return { ok: false, aborted: true }
      return { ok: true, data: response.data }
    } catch (error) {
      if (controller.signal.aborted || error?.code === 'ERR_CANCELED') return { ok: false, aborted: true }
      return { ok: false, status: error.response?.status ?? null }
    }
  }, [token])

  useEffect(() => {
    let live = true
    setView('loading')
    fetchProposal().then((result) => {
      if (!live || result.aborted) return
      if (result.ok) { setData(result.data); setView('ready') }
      else setView(result.status === 404 ? 'not_found' : result.status === 429 ? 'rate_limited' : 'error')
    })
    return () => { live = false; requestRef.current?.abort() }
  }, [fetchProposal, reloadKey])

  // Re-read the proposal after the server told us something changed under us.
  async function refetchWithNotice(text) {
    const result = await fetchProposal()
    if (result.aborted) return
    if (result.ok) {
      setData(result.data)
      setView('ready')
      setNotice(text)
      setStep('choose')
      setAnswerError(null)
    } else {
      setView(result.status === 404 ? 'not_found' : 'error')
    }
  }

  useEffect(() => { if (step === 'confirm') confirmHeadingRef.current?.focus() }, [step])
  useEffect(() => {
    if (justAnswered.current && (data?.state === 'accepted' || data?.state === 'declined')) {
      justAnswered.current = false
      resultHeadingRef.current?.focus()
    }
  }, [data])

  const over = charCount(message) - MESSAGE_MAX

  function choose(next) {
    setDecision(next)
    setMessage('')
    setAnswerError(null)
    setNotice(null)
    setStep('confirm')
  }

  async function submit() {
    if (submittingRef.current || over > 0) return
    submittingRef.current = true
    setSubmitting(true)
    setAnswerError(null)
    const body = { decision }
    if (message.trim()) body.message = message.trim()
    try {
      const response = await publicApi.post(`/proposals/public/${encodeURIComponent(token)}/respond/`, body)
      justAnswered.current = true
      setData(response.data)
      setStep('choose')
    } catch (error) {
      const failure = classifySendFailure(error)
      const status = failure.status
      if (failure.kind === 'ambiguous') {
        // The answer may have been recorded. Look, rather than guess.
        const result = await fetchProposal()
        if (result.aborted) return
        if (result.ok && (result.data.state === 'accepted' || result.data.state === 'declined')) {
          setData(result.data)
          setNotice(COPY.race.already_answered)
          setStep('choose')
        } else {
          setAnswerError(COPY.answerAmbiguous)
        }
      } else if (status === 403 && failure.reason === 'owner') {
        await refetchWithNotice(COPY.race.owner)
      } else if (status === 409) {
        await refetchWithNotice(COPY.race[ANSWER_REASONS.has(failure.reason) ? failure.reason : 'already_answered'])
      } else if (status === 404) {
        setView('not_found')
      } else if (status === 429) {
        setAnswerError(COPY.answer429)
      } else {
        setAnswerError(failure.message || COPY.answerAmbiguous)
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (view === 'loading') {
    return <Page><p role="status" style={{ margin: 0, padding: '32px 0', textAlign: 'center', color: MUTED }}>{COPY.loading}</p></Page>
  }
  if (view === 'not_found') {
    return <Page><Notice icon={AlertCircle} color={MUTED} heading={COPY.notFoundHeading}>{COPY.notFoundText}</Notice></Page>
  }
  if (view === 'rate_limited') {
    return <Page><Notice icon={AlertCircle} color="#b45309" heading={COPY.rateHeading}>{COPY.rateText}</Notice></Page>
  }
  if (view === 'error') {
    return (
      <Page>
        <Notice
          icon={AlertCircle} color="#b91c1c" heading={COPY.errorHeading}
          action={<div style={{ marginTop: 18 }}><button type="button" style={primaryButton} onClick={() => setReloadKey((k) => k + 1)}>{COPY.tryAgain}</button></div>}
        >
          {COPY.errorText}
        </Notice>
      </Page>
    )
  }

  const senderName = data.sender?.name || ''
  const noticeBlock = notice && (
    <p role="status" className="proposal-public-noprint" style={{ margin: '0 0 18px', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, fontSize: '0.88rem', color: '#92400e' }}>{notice}</p>
  )

  if (data.state === 'withdrawn') {
    return (
      <Page>
        {noticeBlock}
        <SenderName name={senderName} />
        <Notice icon={XCircle} color={MUTED} heading={COPY.withdrawnHeading}>{COPY.withdrawnText(senderName, data.title)}</Notice>
      </Page>
    )
  }

  const answered = data.state === 'accepted' || data.state === 'declined'
  const canRespond = data.state === 'open' && data.can_respond && !data.preview

  return (
    <Page>
      {noticeBlock}
      {data.preview && (
        <p role="status" className="proposal-public-noprint" style={{ margin: '0 0 18px', padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: '0.88rem', color: '#1e40af' }}>{COPY.ownerBanner}</p>
      )}

      {(data.state === 'open' || answered) && (
        <div className="proposal-public-noprint" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button type="button" onClick={() => window.print()} style={{ ...outlineButton, minHeight: 44, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
            <Printer size={15} aria-hidden="true" /> {COPY.print}
          </button>
        </div>
      )}

      <ProposalDocument data={data} />

      {canRespond && step === 'choose' && (
        <section className="proposal-public-noprint" style={{ marginTop: 28, paddingTop: 22, borderTop: `1px solid ${BORDER}` }}>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 700, color: NAVY }}>{COPY.responseHeading}</h2>
          <p style={{ margin: '0 0 14px', fontSize: '0.9rem', color: MUTED, lineHeight: 1.55 }}>{COPY.responseText}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={primaryButton} onClick={() => choose('accept')}>{COPY.accept}</button>
            <button type="button" style={outlineButton} onClick={() => choose('decline')}>{COPY.decline}</button>
          </div>
        </section>
      )}

      {canRespond && step === 'confirm' && (
        <section className="proposal-public-noprint" style={{ marginTop: 28, paddingTop: 22, borderTop: `1px solid ${BORDER}` }}>
          <h2 ref={confirmHeadingRef} tabIndex={-1} style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 700, color: NAVY, outline: 'none' }}>
            {COPY.confirmHeading[decision]}
          </h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <label htmlFor="proposal-answer-message" style={{ fontSize: '0.85rem', fontWeight: 600, color: TEXT }}>{COPY.messageLabel(senderName)}</label>
            <span id="proposal-answer-count" style={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums', color: over > 0 ? '#b91c1c' : MUTED }}>{charCount(message)} / {MESSAGE_MAX}</span>
          </div>
          <textarea
            id="proposal-answer-message" rows={5} value={message} disabled={submitting}
            onChange={(e) => setMessage(e.target.value)} placeholder={COPY.placeholder[decision]}
            aria-describedby="proposal-answer-count" aria-invalid={over > 0 ? true : undefined}
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '10px 12px', fontSize: '0.95rem', lineHeight: 1.5, fontFamily: "'DM Sans', sans-serif", color: TEXT, border: `1.5px solid ${over > 0 ? '#b91c1c' : 'rgba(0,0,0,.2)'}`, borderRadius: 10, resize: 'vertical' }}
          />
          {over > 0 && <p role="status" style={{ margin: '6px 0 0', fontSize: '0.82rem', color: '#b91c1c' }}>{COPY.tooLong(over)}</p>}
          {answerError && <p role="status" style={{ margin: '10px 0 0', fontSize: '0.88rem', color: '#b91c1c' }}>{answerError}</p>}
          <p style={{ margin: '12px 0 16px', fontSize: '0.88rem', color: MUTED }}>{COPY.finality}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={{ ...primaryButton, opacity: submitting || over > 0 ? 0.6 : 1 }} disabled={submitting || over > 0} onClick={submit}>
              {submitting ? COPY.busy : COPY.confirm[decision]}
            </button>
            <button type="button" style={outlineButton} disabled={submitting} onClick={() => { setStep('choose'); setAnswerError(null) }}>{COPY.back}</button>
          </div>
        </section>
      )}

      {data.state === 'expired' && (
        <section role="status" style={{ marginTop: 28, padding: '16px 18px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: '#92400e' }}>{COPY.expiredHeading(formatDate(data.valid_until))}</h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#92400e', lineHeight: 1.55 }}>{COPY.expiredText(senderName)}</p>
        </section>
      )}

      {answered && (
        <section role="status" style={{ marginTop: 28, padding: '18px 20px', background: data.state === 'accepted' ? '#f0fdf4' : '#f8fafc', border: `1px solid ${BORDER}`, borderRadius: 10 }}>
          <h2 ref={resultHeadingRef} tabIndex={-1} style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 700, color: NAVY, outline: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
            {data.state === 'accepted' ? <CheckCircle2 size={19} aria-hidden="true" style={{ color: '#15803d' }} /> : <XCircle size={19} aria-hidden="true" style={{ color: MUTED }} />}
            {COPY.resultHeading[data.state]}
          </h2>
          <p style={{ margin: '0 0 2px', fontSize: '0.88rem', color: MUTED }}>{formatTimestamp(data.responded_at)} PKT</p>
          <p style={{ margin: 0, fontSize: '0.92rem', color: TEXT }}>{COPY.recorded}</p>
          {data.response_message && (
            <p style={{ margin: '12px 0 0', fontSize: '0.92rem', color: TEXT, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <strong>{COPY.yourMessage}</strong> {data.response_message}
            </p>
          )}
        </section>
      )}
    </Page>
  )
}
