// src/components/SendContractDialog.jsx
//
// The Send dialog (Prompt 23, Part 8b). One dialog, these phases:
//   review      the SERVER's checklist, the method, the warnings, and where the freelancer signs by typing their name
//   sending     the request is running; the dialog cannot be closed
//   verifying   the answer was lost; we CHECK whether it was sent (never retry)
//   unconfirmed the check window ended without finding it sent
// A success closes the dialog through onSent(): the page changes under it (the editor unmounts the moment the status is no
// longer draft), so the result is a banner on the page, never a screen in here.
//
// The signer name is NEVER prefilled, not even from the profile: typing it is the signature. The Send button stays off until
// the server says the draft is ready AND a plausible name is typed (the name check is advisory; the server decides).
//
// Why "ambiguous" never means "try again": the send endpoint holds the contract's row lock while the email goes out and
// marks it sent only if the email succeeded, so a lost answer can mean sent, not sent, or still in progress.
// classifySendFailure() separates definite failures (our app answered) from the rest; the rest are settled by reading the
// contract (GET /contracts/<id>/) and recognising the freelancer's own signature on it.
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Link2, Mail } from 'lucide-react'

import api from '@/lib/api'
import FosAlert from '@/components/FosAlert'
import { DialogButtons, ProposalDialog, dialogText } from '@/components/ProposalDialog'
import useContractSendCheck from '@/hooks/useContractSendCheck'
import { OWNER_COPY } from '@/pages/contractCopy'
import { checkSignerName } from '@/pages/contractHelpers'
import {
  SEND_TIMEOUT_MS, VERIFY_INTERVAL_MS, VERIFY_WINDOW_MS, classifySendFailure, verifySent,
} from '@/pages/contractLifecycle'

const headingStyle = { margin: '0 0 8px', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }

/**
 * @param {object} props
 * @param {string} props.contractId
 * @param {string} props.clientEmail - the saved client email (after the flush)
 * @param {string} props.userEmail - replies come here
 * @param {(data: object, info: {method: string, recovered: boolean}) => void} props.onSent
 * @param {() => void} props.onClose
 * @param {(target: string) => void} props.onFix - a checklist target: a field name or `section:<id>`
 * @param {(text?: string) => void} props.onNotDraft
 */
export default function SendContractDialog({ contractId, clientEmail, userEmail, onSent, onClose, onFix, onNotDraft }) {
  const savedEmail = String(clientEmail ?? '').trim()
  const [method, setMethod] = useState(savedEmail ? 'email' : 'link')
  const [signerName, setSignerName] = useState('') // never prefilled
  const [nameTouched, setNameTouched] = useState(false)
  const [phase, setPhase] = useState('review') // review | sending | verifying | unconfirmed
  const [problem, setProblem] = useState(null) // { text, locked } | null
  const [nameProblem, setNameProblem] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [checkFailed, setCheckFailed] = useState(false)
  const [rechecking, setRechecking] = useState(false)

  const inFlight = useRef(false)
  const checkRef = useRef({ controller: null, timer: null, token: 0 })
  const onSentRef = useRef(onSent)
  onSentRef.current = onSent
  const methodRef = useRef(method)
  methodRef.current = method
  const nameRef = useRef(signerName)
  nameRef.current = signerName

  const sendCheck = useContractSendCheck(contractId, method)
  const nameCheck = checkSignerName(signerName)
  const waiting = phase === 'sending' || phase === 'verifying'
  const canSend = sendCheck.ready && nameCheck.ok && !problem?.locked && !waiting

  // A contract that stopped being a draft while the dialog was open: the page reloads into its real state.
  useEffect(() => {
    if (sendCheck.notDraft) onNotDraft(OWNER_COPY.alreadySentElsewhere)
    // Once per verdict.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendCheck.notDraft])

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

  // Checks at once, then every VERIFY_INTERVAL_MS, for one window. The first answer showing the contract sent with OUR
  // signature on it means it was sent; an answer showing it is still a draft, after the window, hands the dialog back.
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
      let sentByOther = false
      let failed = false
      try {
        const { data } = await api.get(`/contracts/${contractId}/`, { signal: controller.signal })
        if (data.status !== 'draft') {
          if (verifySent(data, { signerName: nameRef.current })) sent = data
          else sentByOther = true
        }
      } catch {
        failed = true
      }
      if (token !== state.token) return
      if (sent) {
        onSentRef.current(sent, { method: methodRef.current, recovered: true })
        return
      }
      if (sentByOther) {
        onNotDraft(OWNER_COPY.alreadySentElsewhere)
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

  // From "unconfirmed": ONE read. Only a draft that is still a draft hands the dialog back (then, and only then, can the
  // person send again); a contract found sent is a success; one sent under another name is the page's to explain.
  async function checkOnce() {
    if (rechecking) return
    stopChecks()
    setRechecking(true)
    setCheckFailed(false)
    try {
      const { data } = await api.get(`/contracts/${contractId}/`)
      if (data.status === 'draft') {
        inFlight.current = false
        setProblem(null)
        setPhase('review')
        sendCheck.refresh()
      } else if (verifySent(data, { signerName: nameRef.current })) {
        onSentRef.current(data, { method: methodRef.current, recovered: true })
      } else {
        onNotDraft(OWNER_COPY.alreadySentElsewhere)
      }
    } catch {
      setCheckFailed(true)
    } finally {
      setRechecking(false)
    }
  }

  async function send() {
    if (inFlight.current || !canSend) return
    inFlight.current = true
    setProblem(null)
    setNameProblem(null)
    setElapsed(0)
    setPhase('sending')
    try {
      const { data } = await api.post(
        `/contracts/${contractId}/send/`, { method, confirm: true, signer_name: signerName }, { timeout: SEND_TIMEOUT_MS },
      )
      onSent(data, { method, recovered: false })
    } catch (error) {
      const failure = classifySendFailure(error)
      if (failure.kind === 'ambiguous') {
        // The request may have been processed. Check; never resend.
        startChecks()
        return
      }
      inFlight.current = false
      if (failure.reason === 'not_draft') {
        onNotDraft(OWNER_COPY.alreadySentElsewhere)
        return
      }
      if (failure.reason === 'name') setNameProblem(failure.message)
      else setProblem({ text: failure.message, locked: failure.reason === 'too_many' })
      if (failure.reason === 'send_problem') sendCheck.refresh()
      setPhase('review')
    }
  }

  const title = phase === 'verifying' ? OWNER_COPY.verifying
    : phase === 'unconfirmed' ? OWNER_COPY.unconfirmedTitle : OWNER_COPY.sendTitle

  return (
    <ProposalDialog title={title} busy={waiting} onClose={onClose} maxWidth={540}>
      {phase === 'review' && (
        <>
          <p style={dialogText}>{OWNER_COPY.sendIntro}</p>

          <fieldset style={{ border: 'none', margin: '0 0 18px', padding: 0 }}>
            <legend style={headingStyle}>{OWNER_COPY.methodLegend}</legend>
            <MethodOption
              value="email" checked={method === 'email'} onChange={setMethod} Icon={Mail} disabled={!savedEmail}
              label={savedEmail ? OWNER_COPY.methodEmail(savedEmail) : OWNER_COPY.methodEmailNoAddress}
              help={savedEmail ? OWNER_COPY.methodEmailHelp(userEmail) : ''}
            />
            <MethodOption
              value="link" checked={method === 'link'} onChange={setMethod} Icon={Link2}
              label={OWNER_COPY.methodLink} help={OWNER_COPY.methodLinkHelp}
            />
          </fieldset>

          <h4 style={headingStyle}>{OWNER_COPY.checklistTitle}</h4>
          <div style={{ margin: '0 0 16px', minHeight: 24 }}>
            {sendCheck.loading && <p role="status" style={{ ...dialogText, margin: 0 }}>{OWNER_COPY.checking}</p>}
            {sendCheck.error && (
              <div role="alert">
                <p style={{ ...dialogText, margin: '0 0 8px', color: 'var(--status-red-text)' }}>{OWNER_COPY.checkFailed}</p>
                <button type="button" className="fos-btn fos-btn-ghost" onClick={sendCheck.refresh}>{OWNER_COPY.checkAgain}</button>
              </div>
            )}
            {!sendCheck.loading && !sendCheck.error && (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {sendCheck.checks.map((check) => (
                  <li key={check.id} data-check={check.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', fontSize: '0.84rem', color: check.ok ? 'var(--text-secondary)' : 'var(--status-red-text)' }}>
                    {check.ok
                      ? <CheckCircle2 size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--status-green-text)' }} />
                      : <AlertTriangle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />}
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{check.message}</span>
                    {!check.ok && (
                      <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: '2px 10px', flexShrink: 0 }} onClick={() => onFix(check.target)} aria-label={`${OWNER_COPY.goToField}: ${check.message}`}>
                        {OWNER_COPY.goToField}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {sendCheck.warnings.length > 0 && (
            <>
              <h4 style={headingStyle}>{OWNER_COPY.warningsTitle}</h4>
              <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: '0.82rem', color: 'var(--status-amber-text)', lineHeight: 1.6 }}>
                {sendCheck.warnings.map((warning) => <li key={warning.id}>{warning.message}</li>)}
              </ul>
            </>
          )}

          <p style={{ ...dialogText, fontSize: '0.78rem', margin: '0 0 16px' }}>{OWNER_COPY.disclaimer}</p>

          <fieldset style={{ border: 'none', margin: '0 0 16px', padding: 0 }}>
            <legend style={headingStyle}>{OWNER_COPY.signSection}</legend>
            <label htmlFor="contract-send-signer-name" className="fos-label">{OWNER_COPY.signNameLabel}</label>
            <input
              id="contract-send-signer-name" type="text" className={`fos-input${nameTouched && !nameCheck.ok ? ' error' : ''}`}
              value={signerName} onChange={(e) => { setSignerName(e.target.value); setNameProblem(null) }}
              onBlur={() => setNameTouched(true)} autoComplete="off" spellCheck={false}
              aria-invalid={(nameTouched && !nameCheck.ok) || nameProblem ? true : undefined}
              aria-describedby="contract-send-signer-hint contract-send-signer-error"
            />
            <p id="contract-send-signer-hint" className="fos-hint">{OWNER_COPY.signNameHint}</p>
            <p id="contract-send-signer-error" className="fos-error" role="alert" style={{ minHeight: 0 }}>
              {nameProblem || (nameTouched && !nameCheck.ok ? nameCheck.message : '')}
            </p>
            <p className="fos-hint">{OWNER_COPY.signRecorded}</p>
          </fieldset>

          {problem && <FosAlert type="error" style={{ marginBottom: 16 }}>{problem.text}</FosAlert>}

          <DialogButtons
            busy={false} onClose={onClose} cancelLabel={OWNER_COPY.cancelButton}
            confirm={(
              <button type="button" className="fos-btn fos-btn-accent" onClick={send} disabled={!canSend}>
                {method === 'email' ? OWNER_COPY.sendAndSign : OWNER_COPY.linkAndSign}
              </button>
            )}
          />
        </>
      )}

      {phase === 'sending' && (
        <div role="status" style={{ textAlign: 'center', padding: '12px 0 4px' }}>
          <span className="fos-spinner" aria-hidden="true" />
          <p style={{ margin: '12px 0 4px', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>{OWNER_COPY.sending} {elapsed}s</p>
          <p style={{ ...dialogText, margin: 0 }}>Please keep this page open. Sending by email can take up to 30 seconds.</p>
        </div>
      )}

      {phase === 'verifying' && (
        <div role="status">
          <p style={dialogText}>{OWNER_COPY.verifyingBody}</p>
          {checkFailed && <p style={{ ...dialogText, color: 'var(--status-amber-text)' }}>{OWNER_COPY.checkUnreachable}</p>}
          <div style={{ textAlign: 'center' }}><span className="fos-spinner" aria-hidden="true" /></div>
        </div>
      )}

      {phase === 'unconfirmed' && (
        <>
          <div role="status">
            <p style={dialogText}>{OWNER_COPY.unconfirmedBody}</p>
            {checkFailed && <p style={{ ...dialogText, color: 'var(--status-amber-text)' }}>{OWNER_COPY.checkUnreachable}</p>}
          </div>
          <DialogButtons
            busy={false} onClose={onClose} cancelLabel={OWNER_COPY.closeButton}
            confirm={(
              <button type="button" className="fos-btn fos-btn-accent" onClick={checkOnce} disabled={rechecking}>
                {rechecking ? OWNER_COPY.checking : OWNER_COPY.checkAgain}
              </button>
            )}
          />
        </>
      )}
    </ProposalDialog>
  )
}

function MethodOption({ value, checked, onChange, Icon, label, help, disabled = false }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', marginBottom: 8, minHeight: 44, border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-md)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <input type="radio" name="contract-send-method" value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} style={{ marginTop: 3 }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
          <Icon size={14} aria-hidden="true" /> {label}
        </span>
        {help && <span style={{ display: 'block', marginTop: 2, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{help}</span>}
      </span>
    </label>
  )
}
