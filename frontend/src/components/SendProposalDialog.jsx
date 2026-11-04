// src/components/SendProposalDialog.jsx
//
// The Send dialog (DECISIONS.md part B, D1-D3). One dialog, these phases:
//   review      the pre-flight checklist, the method, the warnings
//   sending     the request is running; the dialog cannot be closed
//   verifying   the answer was lost; we CHECK whether it was sent (never retry)
//   unconfirmed the check window ended without finding it sent
// A success closes the dialog through onSent(): the page changes under it
// (the editor unmounts the moment the status is no longer draft), so the result
// is a banner on the page, never a screen in here.
//
// Why "ambiguous" never means "try again": the send endpoint holds the proposal's
// row lock while the email goes out and marks it sent only if the email
// succeeded, so a lost answer can mean sent, not sent, or still in progress.
// classifySendFailure() tells definite failures (our app answered) from the rest;
// the rest are resolved by GET /proposals/<id>/.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Mail, Link2 } from 'lucide-react'

import api from '@/lib/api'
import FosAlert from '@/components/FosAlert'
import { DialogButtons, ProposalDialog, dialogText } from '@/components/ProposalDialog'
import { todayInPlatformTimezone } from '@/pages/invoiceHelpers'
import {
  SEND_TIMEOUT_MS, VERIFY_INTERVAL_MS, VERIFY_WINDOW_MS, classifySendFailure, preflightSend,
} from '@/pages/proposalLifecycle'

const headingStyle = { margin: '0 0 8px', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }

/**
 * @param {object} props
 * @param {string} props.proposalId
 * @param {object} props.snapshot - what the server holds (autosave.getSnapshot()), after the flush
 * @param {object} [props.quality] - the current server-computed score
 * @param {boolean} props.aiGenerated
 * @param {string} props.userEmail - replies come here
 * @param {(data: object, info: {method: string, recovered: boolean}) => void} props.onSent
 * @param {() => void} props.onClose
 * @param {(field: string) => void} props.onFix
 * @param {(text?: string) => void} props.onNotDraft
 */
export default function SendProposalDialog({ proposalId, snapshot, quality, aiGenerated, userEmail, onSent, onClose, onFix, onNotDraft }) {
  const savedEmail = String(snapshot.client_email ?? '').trim()
  const [method, setMethod] = useState(savedEmail ? 'email' : 'link')
  const [phase, setPhase] = useState('review') // review | sending | verifying | unconfirmed
  const [problem, setProblem] = useState(null) // { text, locked } | null
  const [elapsed, setElapsed] = useState(0)
  const [checkFailed, setCheckFailed] = useState(false)

  const inFlight = useRef(false)
  const checkRef = useRef({ controller: null, timer: null, token: 0 })
  const onSentRef = useRef(onSent)
  onSentRef.current = onSent
  const methodRef = useRef(method)
  methodRef.current = method

  const preflight = useMemo(
    () => preflightSend({ snapshot, method, today: todayInPlatformTimezone(), quality, aiGenerated }),
    [snapshot, method, quality, aiGenerated],
  )

  const waiting = phase === 'sending' || phase === 'verifying'

  // Leaving the page mid-send would lose the answer.
  useEffect(() => {
    if (!waiting) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [waiting])

  useEffect(() => {
    if (phase !== 'sending') return undefined
    const startedAt = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [phase])

  function stopChecks() {
    const state = checkRef.current
    state.token += 1
    clearTimeout(state.timer)
    state.timer = null
    state.controller?.abort()
    state.controller = null
  }
  useEffect(() => stopChecks, [])

  // Checks at once, then every VERIFY_INTERVAL_MS, for one window. The first
  // answer whose status is not 'draft' means it was sent.
  function startChecks() {
    stopChecks()
    const state = checkRef.current
    const token = state.token
    const controller = new AbortController()
    state.controller = controller
    setPhase('verifying')
    setCheckFailed(false)

    const attempt = async (n) => {
      let sent = null
      let failed = false
      try {
        const { data } = await api.get(`/proposals/${proposalId}/`, { signal: controller.signal })
        if (data.status !== 'draft') sent = data
      } catch {
        failed = true
      }
      if (token !== state.token) return
      if (sent) {
        onSentRef.current(sent, { method: methodRef.current, recovered: true })
        return
      }
      setCheckFailed(failed)
      if ((n + 1) * VERIFY_INTERVAL_MS > VERIFY_WINDOW_MS) {
        setPhase('unconfirmed')
        return
      }
      state.timer = setTimeout(() => attempt(n + 1), VERIFY_INTERVAL_MS)
    }
    attempt(0)
  }

  async function send() {
    if (inFlight.current || !preflight.canSend) return
    inFlight.current = true
    setProblem(null)
    setElapsed(0)
    setPhase('sending')
    try {
      const { data } = await api.post(`/proposals/${proposalId}/send/`, { method, confirm: true }, { timeout: SEND_TIMEOUT_MS })
      onSent(data, { method, recovered: false })
    } catch (error) {
      const failure = classifySendFailure(error)
      if (failure.kind === 'ambiguous') {
        // The request may have been processed. Check; never resend.
        startChecks()
        return
      }
      if (failure.status === 409 && failure.reason === 'not_draft') {
        onNotDraft('This proposal was already sent from another tab or device. Here is its current state.')
        return
      }
      inFlight.current = false
      setProblem({ text: failure.message, locked: failure.status === 429 })
      setPhase('review')
    }
  }

  const title = phase === 'verifying' ? 'Checking whether it was sent…'
    : phase === 'unconfirmed' ? "We couldn't confirm that it was sent" : 'Send this proposal'

  return (
    <ProposalDialog title={title} busy={waiting} onClose={onClose} maxWidth={520}>
      {phase === 'review' && (
        <>
          <p style={dialogText}>Check these before you send. Once it is sent you can&apos;t edit it. You can withdraw it, or copy it into a new draft.</p>

          <fieldset style={{ border: 'none', margin: '0 0 18px', padding: 0 }}>
            <legend style={headingStyle}>How do you want to send it?</legend>
            <MethodOption
              value="email" checked={method === 'email'} onChange={setMethod} Icon={Mail}
              label={savedEmail ? `Email it to ${savedEmail}` : 'Email it to your client'}
              help={`We email your client a link to the proposal. Their replies come to ${userEmail}.`}
            />
            <MethodOption
              value="link" checked={method === 'link'} onChange={setMethod} Icon={Link2}
              label="Just create the link"
              help="Nothing is emailed. You copy the link and send it yourself, in a chat, on the job platform or from your own email."
            />
          </fieldset>

          <h4 style={headingStyle}>Before sending</h4>
          <ul style={{ listStyle: 'none', margin: '0 0 16px', padding: 0 }}>
            {preflight.checks.map((check) => (
              <li key={check.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', fontSize: '0.84rem', color: check.ok ? 'var(--text-secondary)' : 'var(--status-red-text)' }}>
                {check.ok ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 2, color: 'var(--status-green-text)' }} /> : <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />}
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{check.message}</span>
                {!check.ok && check.blocking && (
                  <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: '2px 10px', flexShrink: 0 }} onClick={() => onFix(check.field)}>Fix</button>
                )}
              </li>
            ))}
          </ul>

          {preflight.warnings.length > 0 && (
            <>
              <h4 style={headingStyle}>Worth a look</h4>
              <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {preflight.warnings.map((warning) => <li key={warning.id}>{warning.message}</li>)}
              </ul>
            </>
          )}

          {problem && <FosAlert type="error" style={{ marginBottom: 16 }}>{problem.text}</FosAlert>}

          <DialogButtons
            busy={false} onClose={onClose}
            confirm={(
              <button type="button" className="fos-btn fos-btn-accent" onClick={send} disabled={!preflight.canSend || problem?.locked}>
                {problem ? 'Try again' : method === 'email' ? 'Send proposal' : 'Create link'}
              </button>
            )}
          />
        </>
      )}

      {phase === 'sending' && (
        <div role="status" style={{ textAlign: 'center', padding: '12px 0 4px' }}>
          <span className="fos-spinner" aria-hidden="true" />
          <p style={{ margin: '12px 0 4px', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>Sending… {elapsed}s</p>
          <p style={{ ...dialogText, margin: 0 }}>Please keep this page open. Sending by email can take up to 30 seconds.</p>
        </div>
      )}

      {phase === 'verifying' && (
        <div role="status">
          <p style={dialogText}>We lost the connection before getting an answer. We are checking now, so please don&apos;t send it again.</p>
          {checkFailed && <p style={{ ...dialogText, color: 'var(--status-amber-text)' }}>We couldn&apos;t reach the server to check.</p>}
          <div style={{ textAlign: 'center' }}><span className="fos-spinner" aria-hidden="true" /></div>
        </div>
      )}

      {phase === 'unconfirmed' && (
        <>
          <div role="status">
            <p style={dialogText}>As far as we can tell it was not. If your client says they received an email, don&apos;t send again.</p>
            {checkFailed && <p style={{ ...dialogText, color: 'var(--status-amber-text)' }}>We couldn&apos;t reach the server to check.</p>}
          </div>
          <DialogButtons
            busy={false} onClose={onClose} cancelLabel="Close"
            confirm={<button type="button" className="fos-btn fos-btn-accent" onClick={startChecks}>Check again</button>}
          />
        </>
      )}
    </ProposalDialog>
  )
}

function MethodOption({ value, checked, onChange, Icon, label, help }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', marginBottom: 8, border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
      <input type="radio" name="send-method" value={value} checked={checked} onChange={() => onChange(value)} style={{ marginTop: 3 }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
          <Icon size={14} aria-hidden="true" /> {label}
        </span>
        <span style={{ display: 'block', marginTop: 2, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{help}</span>
      </span>
    </label>
  )
}
