// src/pages/ContractPublic.jsx
//
// /contract/:token — the page a CLIENT opens from the link in an email or chat to read a contract and sign it (or
// decline it). No login, no AppShell, no LanceraOS account: the token in the URL is the credential. Fixed light palette
// (DESIGN.md Section 10), never theme tokens.
//
// This is the product's most sensitive surface: a stranger uses it, often on a phone, to sign something. The rules it keeps
// (Prompt 23, F14 and F15; DECISIONS.md "Contracts: the pages"):
//   * It talks to the backend ONLY through usePublicContract, which uses publicApi. This file imports neither the auth store
//     nor the shared `api`, and touches no cookie or browser storage.
//   * Everything shown is escaped text. The wording lives in contractCopy.js (scanned for the words the module never uses).
//   * It does not over-claim: the name is a record of what was typed, "Anyone who has this link can sign this contract",
//     and nothing says the signer's identity was checked.
//   * One request per answer (a ref lock lives in the hook); an answer is never retried, and a failure whose outcome is
//     unknown is settled by READING the contract, not by asking the person to try again blindly.
//   * The name and tick-box checks here are advisory: the server decides, and its own sentence is shown when it refuses.
//   * It stays out of search engines and Referer headers (usePublicPageMeta).
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Download, Printer, XCircle } from 'lucide-react'

import ContractDocument from '@/components/ContractDocument'
import usePublicContract from '@/hooks/usePublicContract'
import usePublicPageMeta from '@/hooks/usePublicPageMeta'
import useTitle from '@/hooks/useTitle'
import { PUBLIC_COPY } from './contractCopy'
import {
  CONTRACT_LIMITS, checkSignerName, normaliseName, normaliseReason,
} from './contractHelpers'
import { charCount, formatDate, formatTimestampPkt } from './proposalHelpers'

const NAVY = '#1e3a5f'
const TEXT = '#334155'
const MUTED = '#64748b'
const RED = '#b91c1c'
const BORDER = 'rgba(0,0,0,.1)'
const FONT = "'DM Sans', sans-serif"

const PAGE_CSS = `
  .contract-public-card { padding: 28px 24px; }
  @media (max-width: 560px) { .contract-public-card { padding: 20px 16px; } }
  .contract-public-page button:focus-visible, .contract-public-page textarea:focus-visible,
  .contract-public-page input:focus-visible { outline: 3px solid #2e5987; outline-offset: 2px; }
  .contract-public-page *, .contract-public-page *::before, .contract-public-page *::after { box-sizing: border-box; }
  @media print {
    .contract-public-noprint { display: none !important; }
    html, body, .contract-public-page { background: #fff !important; }
    .contract-public-card { box-shadow: none !important; border: none !important; padding: 0 !important; max-width: none !important; }
  }
`

const buttonBase = {
  minHeight: 44, padding: '0 22px', borderRadius: 10, fontSize: '0.95rem', fontWeight: 600, fontFamily: FONT,
  cursor: 'pointer', border: `1.5px solid ${NAVY}`,
}
const primaryButton = { ...buttonBase, background: NAVY, color: '#fff' }
const outlineButton = { ...buttonBase, background: '#fff', color: NAVY }
const fieldError = { margin: '6px 0 0', fontSize: '0.84rem', color: RED }

function Page({ children, busy }) {
  return (
    <main className="contract-public-page" aria-busy={busy || undefined} style={{ minHeight: '100vh', background: '#f8fafc', padding: '24px 16px 56px', fontFamily: FONT, color: TEXT }}>
      <style>{PAGE_CSS}</style>
      <div className="contract-public-card" style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
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

function Skeleton() {
  const bar = (width, height = 14) => <div style={{ width, height, borderRadius: 6, background: '#e2e8f0', marginBottom: 12 }} />
  return (
    <div role="status" aria-busy="true" style={{ padding: '8px 0' }}>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{PUBLIC_COPY.loading}</span>
      {bar('40%', 18)}{bar('70%', 28)}{bar('100%')}{bar('92%')}{bar('96%')}{bar('60%')}
    </div>
  )
}

export default function ContractPublic() {
  const { token } = useParams()
  usePublicPageMeta()
  const contract = usePublicContract(token)
  const {
    view, data, notice, answerError, submitting, locked, sign, decline, reload, pdf,
  } = contract

  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [showChecks, setShowChecks] = useState(false)
  const [step, setStep] = useState('form') // form | confirm_sign | confirm_decline
  const [reason, setReason] = useState('')

  const nameRef = useRef(null)
  const agreeRef = useRef(null)
  const formHeadingRef = useRef(null)
  const confirmSignRef = useRef(null)
  const confirmDeclineRef = useRef(null)
  const resultRef = useRef(null)
  const previousState = useRef(null)
  const backPressed = useRef(false)

  useTitle(view === 'ready' && data?.title ? `${data.title} — Contract` : 'Contract')

  // Focus follows the step. Back hands focus to the heading of the form it returns to, never on first load.
  useEffect(() => { if (step === 'confirm_sign') confirmSignRef.current?.focus() }, [step])
  useEffect(() => { if (step === 'confirm_decline') confirmDeclineRef.current?.focus() }, [step])
  useEffect(() => {
    if (step === 'form' && backPressed.current) {
      backPressed.current = false
      formHeadingRef.current?.focus()
    }
  }, [step])

  // The page's own answer (or one found on record) moves focus to the result heading.
  const state = data?.state
  useEffect(() => {
    if (previousState.current === 'open' && (state === 'signed' || state === 'declined')) resultRef.current?.focus()
    previousState.current = state
  }, [state])

  // A server sentence about the name or the tick-box belongs to the form: bring the person back to it.
  const errorField = answerError?.field
  useEffect(() => {
    if (step === 'confirm_sign' && (errorField === 'name' || errorField === 'agree')) setStep('form')
  }, [errorField, step])

  if (view === 'loading') return <Page busy><Skeleton /></Page>
  if (view === 'not_found') return <Page><Notice icon={AlertCircle} color={MUTED} heading={PUBLIC_COPY.notFoundTitle}>{PUBLIC_COPY.notFoundBody}</Notice></Page>
  if (view === 'rate_limited') return <Page><Notice icon={AlertCircle} color="#b45309" heading={PUBLIC_COPY.tooManyTitle}>{PUBLIC_COPY.tooManyBody}</Notice></Page>
  if (view === 'error') {
    return (
      <Page>
        <Notice
          icon={AlertCircle} color={RED} heading={PUBLIC_COPY.loadErrorTitle}
          action={<div style={{ marginTop: 18 }}><button type="button" style={primaryButton} onClick={reload}>{PUBLIC_COPY.tryAgain}</button></div>}
        >
          {PUBLIC_COPY.loadErrorBody}
        </Notice>
      </Page>
    )
  }

  const senderName = data.sender?.name || ''
  const noticeBlock = notice && (
    <p role="status" className="contract-public-noprint" style={{ margin: '0 0 18px', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, fontSize: '0.88rem', color: '#92400e' }}>{notice}</p>
  )

  if (state === 'withdrawn') {
    return (
      <Page>
        {noticeBlock}
        <SenderName name={senderName} />
        <Notice icon={XCircle} color={MUTED} heading={PUBLIC_COPY.withdrawnTitle}>{PUBLIC_COPY.withdrawnBody(senderName, data.title)}</Notice>
      </Page>
    )
  }

  const canRespond = state === 'open' && data.can_respond && !data.preview
  const nameCheck = checkSignerName(name)
  const normalisedName = normaliseName(name)
  const formDisabled = submitting || Boolean(locked)
  const over = charCount(normaliseReason(reason)) - CONTRACT_LIMITS.MESSAGE_MAX

  const nameError = (showChecks && !nameCheck.ok ? nameCheck.message : null) || (errorField === 'name' ? answerError.text : null)
  const agreeError = (showChecks && !agree ? PUBLIC_COPY.agreeRequired : null) || (errorField === 'agree' ? answerError.text : null)
  const generalError = answerError && !['name', 'agree', 'reason'].includes(errorField) ? answerError.text : null

  function review(event) {
    event.preventDefault()
    if (formDisabled) return
    setShowChecks(true)
    if (!nameCheck.ok) { nameRef.current?.focus(); return }
    if (!agree) { agreeRef.current?.focus(); return }
    contract.clearAnswerError()
    setStep('confirm_sign')
  }

  function goBack() {
    backPressed.current = true
    contract.clearAnswerError()
    setStep('form')
  }

  async function confirmSign() {
    if (formDisabled || !nameCheck.ok || !agree) return
    await sign(name)
  }

  async function confirmDecline() {
    if (formDisabled || over > 0) return
    await decline(reason)
  }

  const printButton = (
    <div className="contract-public-noprint" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
      <button type="button" onClick={() => window.print()} style={{ ...outlineButton, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
        <Printer size={15} aria-hidden="true" /> {PUBLIC_COPY.printButton}
      </button>
    </div>
  )

  return (
    <Page>
      {noticeBlock}
      {data.preview && (
        <p role="status" className="contract-public-noprint" style={{ margin: '0 0 18px', padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: '0.88rem', color: '#1e40af' }}>{PUBLIC_COPY.ownerBanner}</p>
      )}

      {printButton}
      <ContractDocument data={data} />

      {canRespond && step === 'form' && (
        <section className="contract-public-noprint" style={{ marginTop: 28, paddingTop: 22, borderTop: `1px solid ${BORDER}` }}>
          <h2 ref={formHeadingRef} tabIndex={-1} style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 700, color: NAVY, outline: 'none' }}>{PUBLIC_COPY.signHeading}</h2>
          <p style={{ margin: '0 0 10px', fontSize: '0.92rem', color: TEXT, lineHeight: 1.55 }}>{PUBLIC_COPY.signIntro}</p>
          <p style={{ margin: '0 0 6px', fontSize: '0.88rem', color: MUTED, lineHeight: 1.55 }}>{PUBLIC_COPY.linkNote}</p>
          <p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: MUTED, lineHeight: 1.55 }}>{PUBLIC_COPY.recordedNote}</p>

          <form onSubmit={review} noValidate>
            <label htmlFor="contract-signer-name" style={{ display: 'block', fontSize: '0.88rem', fontWeight: 600, color: TEXT }}>{PUBLIC_COPY.nameLabel}</label>
            <input
              ref={nameRef} id="contract-signer-name" type="text" value={name} disabled={formDisabled}
              onChange={(e) => setName(e.target.value)} autoComplete="name" autoCapitalize="words" spellCheck={false}
              maxLength={400} aria-invalid={nameError ? true : undefined}
              aria-describedby={`contract-signer-name-hint${nameError ? ' contract-signer-name-error' : ''}`}
              style={{ width: '100%', minHeight: 44, marginTop: 6, padding: '8px 12px', fontSize: '1rem', fontFamily: FONT, color: TEXT, border: `1.5px solid ${nameError ? RED : 'rgba(0,0,0,.25)'}`, borderRadius: 10, background: '#fff' }}
            />
            <p id="contract-signer-name-hint" style={{ margin: '6px 0 0', fontSize: '0.8rem', color: MUTED }}>{PUBLIC_COPY.nameHint}</p>
            {nameError && <p id="contract-signer-name-error" role="alert" style={fieldError}>{nameError}</p>}

            <label htmlFor="contract-agree" style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, marginTop: 14, fontSize: '0.92rem', color: TEXT, cursor: 'pointer' }}>
              <input
                ref={agreeRef} id="contract-agree" type="checkbox" checked={agree} disabled={formDisabled}
                onChange={(e) => setAgree(e.target.checked)} aria-invalid={agreeError ? true : undefined}
                aria-describedby={agreeError ? 'contract-agree-error' : undefined}
                style={{ width: 24, height: 24, flexShrink: 0, accentColor: NAVY, cursor: 'pointer' }}
              />
              <span>{PUBLIC_COPY.agreeLabel}</span>
            </label>
            {agreeError && <p id="contract-agree-error" role="alert" style={fieldError}>{agreeError}</p>}

            {generalError && <p role="alert" style={{ margin: '12px 0 0', fontSize: '0.88rem', color: RED }}>{generalError}</p>}
            {locked === 'unknown' && (
              <div style={{ marginTop: 12 }}>
                <button type="button" style={outlineButton} onClick={reload}>{PUBLIC_COPY.reloadButton}</button>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
              <button type="submit" style={{ ...primaryButton, opacity: formDisabled ? 0.6 : 1 }} disabled={formDisabled}>{PUBLIC_COPY.reviewButton}</button>
              <button
                type="button" style={{ ...outlineButton, opacity: formDisabled ? 0.6 : 1 }} disabled={formDisabled}
                onClick={() => { contract.clearAnswerError(); setStep('confirm_decline') }}
              >
                {PUBLIC_COPY.declineButton}
              </button>
            </div>
          </form>
        </section>
      )}

      {canRespond && step === 'confirm_sign' && (
        <section className="contract-public-noprint" style={{ marginTop: 28, paddingTop: 22, borderTop: `1px solid ${BORDER}` }}>
          <h2 ref={confirmSignRef} tabIndex={-1} style={{ margin: '0 0 10px', fontSize: '1.05rem', fontWeight: 700, color: NAVY, outline: 'none' }}>{PUBLIC_COPY.confirmTitle}</h2>
          <p style={{ margin: '0 0 6px', fontSize: '0.95rem', color: TEXT, overflowWrap: 'anywhere' }}>{PUBLIC_COPY.confirmBody(normalisedName)}</p>
          <p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: MUTED }}>{PUBLIC_COPY.confirmFinal}</p>
          {generalError && <p role="alert" style={{ margin: '0 0 12px', fontSize: '0.88rem', color: RED }}>{generalError}</p>}
          {locked === 'unknown' && (
            <div style={{ marginBottom: 12 }}>
              <button type="button" style={outlineButton} onClick={reload}>{PUBLIC_COPY.reloadButton}</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={{ ...primaryButton, opacity: formDisabled ? 0.6 : 1 }} disabled={formDisabled} onClick={confirmSign}>
              {submitting ? PUBLIC_COPY.signing : PUBLIC_COPY.confirmButton}
            </button>
            <button type="button" style={outlineButton} disabled={submitting} onClick={goBack}>{PUBLIC_COPY.backButton}</button>
          </div>
        </section>
      )}

      {canRespond && step === 'confirm_decline' && (
        <section className="contract-public-noprint" style={{ marginTop: 28, paddingTop: 22, borderTop: `1px solid ${BORDER}` }}>
          <h2 ref={confirmDeclineRef} tabIndex={-1} style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 700, color: NAVY, outline: 'none' }}>{PUBLIC_COPY.declineTitle}</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <label htmlFor="contract-decline-reason" style={{ fontSize: '0.88rem', fontWeight: 600, color: TEXT }}>{PUBLIC_COPY.declineReasonLabel(senderName)}</label>
            <span id="contract-decline-count" style={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums', color: over > 0 ? RED : MUTED }}>
              {charCount(normaliseReason(reason))} / {CONTRACT_LIMITS.MESSAGE_MAX}
            </span>
          </div>
          <textarea
            id="contract-decline-reason" rows={5} value={reason} disabled={formDisabled}
            onChange={(e) => setReason(e.target.value)} aria-describedby="contract-decline-count"
            aria-invalid={over > 0 ? true : undefined}
            style={{ width: '100%', marginTop: 6, padding: '10px 12px', fontSize: '1rem', lineHeight: 1.5, fontFamily: FONT, color: TEXT, border: `1.5px solid ${over > 0 ? RED : 'rgba(0,0,0,.25)'}`, borderRadius: 10, resize: 'vertical', background: '#fff' }}
          />
          {over > 0 && <p role="alert" style={fieldError}>{PUBLIC_COPY.reasonTooLong(over)}</p>}
          {errorField === 'reason' && over <= 0 && <p role="alert" style={fieldError}>{answerError.text}</p>}
          {generalError && <p role="alert" style={{ margin: '10px 0 0', fontSize: '0.88rem', color: RED }}>{generalError}</p>}
          {locked === 'unknown' && (
            <div style={{ marginTop: 12 }}>
              <button type="button" style={outlineButton} onClick={reload}>{PUBLIC_COPY.reloadButton}</button>
            </div>
          )}
          <p style={{ margin: '12px 0 16px', fontSize: '0.88rem', color: MUTED }}>{PUBLIC_COPY.declineFinal}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={{ ...primaryButton, opacity: formDisabled || over > 0 ? 0.6 : 1 }} disabled={formDisabled || over > 0} onClick={confirmDecline}>
              {submitting ? PUBLIC_COPY.declining : PUBLIC_COPY.declineConfirm}
            </button>
            <button type="button" style={outlineButton} disabled={submitting} onClick={goBack}>{PUBLIC_COPY.backButton}</button>
          </div>
        </section>
      )}

      {state === 'expired' && (
        <section role="status" style={{ marginTop: 28, padding: '16px 18px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: '#92400e' }}>{PUBLIC_COPY.expiredTitle(formatDate(data.valid_until))}</h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#92400e', lineHeight: 1.55 }}>{PUBLIC_COPY.expiredBody(senderName)}</p>
        </section>
      )}

      {state === 'signed' && (
        <section role="status" style={{ marginTop: 28, padding: '18px 20px', background: '#f0fdf4', border: `1px solid ${BORDER}`, borderRadius: 10 }}>
          <h2 ref={resultRef} tabIndex={-1} style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 700, color: NAVY, outline: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={19} aria-hidden="true" style={{ color: '#15803d' }} />
            {PUBLIC_COPY.signedTitle}
          </h2>
          {data.client_signature && (
            <p style={{ margin: '0 0 2px', fontSize: '0.92rem', color: TEXT, overflowWrap: 'anywhere' }}>
              {PUBLIC_COPY.signedBody(data.client_signature.name, formatTimestampPkt(data.client_signature.signed_at))}
            </p>
          )}
          <p style={{ margin: 0, fontSize: '0.92rem', color: TEXT }}>{PUBLIC_COPY.signedRecorded}</p>
          <div className="contract-public-noprint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            {data.can_download_pdf && (
              <button type="button" style={{ ...primaryButton, display: 'inline-flex', alignItems: 'center', gap: 8, opacity: pdf.busy ? 0.6 : 1 }} disabled={pdf.busy} onClick={pdf.download}>
                <Download size={16} aria-hidden="true" /> {pdf.busy ? PUBLIC_COPY.downloading : PUBLIC_COPY.downloadSigned}
              </button>
            )}
          </div>
          {pdf.error && <p role="alert" className="contract-public-noprint" style={{ margin: '10px 0 0', fontSize: '0.88rem', color: RED }}>{pdf.error}</p>}
        </section>
      )}

      {state === 'declined' && (
        <section role="status" style={{ marginTop: 28, padding: '18px 20px', background: '#f8fafc', border: `1px solid ${BORDER}`, borderRadius: 10 }}>
          <h2 ref={resultRef} tabIndex={-1} style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 700, color: NAVY, outline: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
            <XCircle size={19} aria-hidden="true" style={{ color: MUTED }} />
            {PUBLIC_COPY.declinedTitle}
          </h2>
          <p style={{ margin: 0, fontSize: '0.92rem', color: TEXT }}>{PUBLIC_COPY.declinedBody}</p>
          {data.response_message && (
            <p style={{ margin: '12px 0 0', fontSize: '0.92rem', color: TEXT, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <strong>{PUBLIC_COPY.declinedReason}</strong> {data.response_message}
            </p>
          )}
        </section>
      )}
    </Page>
  )
}
