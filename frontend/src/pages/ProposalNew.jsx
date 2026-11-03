// src/pages/ProposalNew.jsx
//
// Create a proposal: paste the client's job post and generate a first draft
// with AI, or start from a blank page. One page with two actions (DECISIONS.md,
// D2) — the AI path is a single network call, so splitting one paste-and-click
// across wizard steps would add friction and nothing else.
//
// Two safety properties that matter more than the happy path:
//   * Nothing the person typed is ever lost. Every failure leaves every field
//     exactly as it was, with the action available again.
//   * A create call that ends WITHOUT an answer is never reported as a plain
//     failure (D5). The server saves the proposal after the model replies, so
//     a dropped connection can mean "created, but we didn't hear" — telling
//     the user to just try again would create a duplicate. The AI call gets a
//     75 s client timeout (the server's own ceiling is 60 s; the shared
//     Axios default of 15 s would give up on a perfectly healthy 30 s call),
//     and an ambiguous ending points at the proposals list instead.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, FilePlus2, Sparkles } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import Card from '@/components/Card'
import FormSelect from '@/components/FormSelect'
import FosAlert from '@/components/FosAlert'
import ProposalClientFields from '@/components/ProposalClientFields'
import { ProposalCounter, ProposalTextArea, ProposalTextField } from '@/components/ProposalFields'
import {
  AI_REQUEST_TIMEOUT_MS, LIMITS, TONE_OPTIONS, charCount, errorMessage, fieldErrorsFromResponse,
} from './proposalHelpers'

const UNTITLED = 'Untitled proposal'

// "No answer" cases where the proposal may or may not exist: the browser never
// got a response, or a gateway in front of the server answered for it.
const AMBIGUOUS_STATUSES = [408, 502, 504]
function isAmbiguousEnding(error, reason) {
  const status = error?.response?.status
  if (!error?.response) return true
  return AMBIGUOUS_STATUSES.includes(status) || (status >= 500 && !reason)
}

export default function ProposalNew() {
  useTitle('LanceraOS | New Proposal')
  const navigate = useNavigate()

  const [jobDescription, setJobDescription] = useState('')
  const [tone, setTone] = useState('professional')
  const [myExperience, setMyExperience] = useState('')
  const [title, setTitle] = useState('')
  const [client, setClient] = useState({ client: null, client_name: '', client_email: '', client_company: '' })

  const [busy, setBusy] = useState(null) // null | 'ai' | 'blank'
  const [elapsed, setElapsed] = useState(0)
  const [alert, setAlert] = useState(null) // { type, text, ambiguous? }
  const [fieldErrors, setFieldErrors] = useState({})

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Elapsed-seconds counter while the model works.
  useEffect(() => {
    if (busy !== 'ai') return undefined
    const startedAt = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => { clearInterval(timer); setElapsed(0) }
  }, [busy])

  // Leaving mid-generation would abandon a call that is about to be paid for
  // and saved; ask first.
  useEffect(() => {
    if (!busy) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const jobLength = charCount(jobDescription.trim())
  const jobTooShort = jobLength < LIMITS.jobDescriptionMinForAi
  const jobTooLong = charCount(jobDescription) > LIMITS.jobDescription
  const experienceTooLong = charCount(myExperience) > LIMITS.myExperience
  const titleTooLong = charCount(title) > LIMITS.title
  const canGenerate = !jobTooShort && !jobTooLong && !experienceTooLong && !titleTooLong && !busy
  const canStartBlank = !jobTooLong && !experienceTooLong && !titleTooLong && !busy

  function handleFailure(error, fallback) {
    if (!mountedRef.current) return
    const { message, status, reason } = errorMessage(error, fallback)
    if (isAmbiguousEnding(error, reason)) {
      setAlert({ type: 'warning', ambiguous: true, text: "We couldn't confirm whether your proposal was created. Check your proposals list before trying again." })
      return
    }
    if (status === 400) {
      const fields = fieldErrorsFromResponse(error.response.data)
      setFieldErrors(fields)
      setAlert(Object.keys(fields).length ? null : { type: 'error', text: message })
      return
    }
    setAlert({ type: 'error', text: message })
  }

  async function run(kind, request, fallback) {
    setBusy(kind)
    setAlert(null)
    setFieldErrors({})
    try {
      const { data } = await request()
      if (!mountedRef.current) return
      navigate(`/proposals/${data.id}`, { replace: true })
    } catch (error) {
      handleFailure(error, fallback)
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  function optionalText(value) {
    return value.trim() ? value : undefined
  }

  const generate = () => run('ai', () => {
    const body = { job_description: jobDescription, tone, my_experience: myExperience }
    if (title.trim()) body.title = title.trim()
    if (client.client) body.client = client.client
    return api.post('/proposals/generate-ai/', body, { timeout: AI_REQUEST_TIMEOUT_MS })
  }, "We couldn't generate your proposal. Please try again.")

  const startBlank = () => run('blank', () => {
    const body = { title: title.trim() || UNTITLED, tone }
    const job = optionalText(jobDescription)
    const experience = optionalText(myExperience)
    if (job) body.job_description = job
    if (experience) body.my_experience = experience
    if (client.client) body.client = client.client
    return api.post('/proposals/', body)
  }, "We couldn't create your proposal. Please try again.")

  const disabled = busy !== null

  return (
    <div style={{ maxWidth: 760 }}>
      <Link to="/proposals" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: '0.82rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
        <ArrowLeft size={14} /> Proposals
      </Link>

      {alert && (
        <FosAlert type={alert.type} onDismiss={disabled ? undefined : () => setAlert(null)} style={{ marginBottom: 16 }}>
          {alert.text}
          {alert.ambiguous && (
            <> <Link to="/proposals" style={{ color: 'inherit', fontWeight: 700 }}>Go to my proposals</Link></>
          )}
        </FosAlert>
      )}

      <Card title="Write a proposal" subtitle="Paste the job post and get a first draft you can edit, or start from a blank page.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ProposalTextArea
            label="Job post" rows={9} value={jobDescription} onChange={setJobDescription} disabled={disabled}
            placeholder="Paste the client's job description here"
            error={fieldErrors.job_description || (jobTooLong ? `The job post can be at most ${LIMITS.jobDescription.toLocaleString('en')} characters.` : undefined)}
            hint={jobLength > 0 && jobTooShort ? `At least ${LIMITS.jobDescriptionMinForAi} characters are needed to generate with AI.` : undefined}
            counter={<ProposalCounter count={charCount(jobDescription)} max={LIMITS.jobDescription} min={LIMITS.jobDescriptionMinForAi} />}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <FormSelect label="Tone" value={tone} onChange={(e) => setTone(e.target.value)} options={TONE_OPTIONS} disabled={disabled} />
            <ProposalTextField
              label="Title (optional)" value={title} onChange={setTitle} disabled={disabled}
              error={fieldErrors.title || (titleTooLong ? `The title can be at most ${LIMITS.title} characters.` : undefined)}
              hint="Leave blank and the AI suggests one (a blank proposal is called “Untitled proposal”)"
            />
          </div>

          <ProposalTextArea
            label="Your experience (optional)" rows={4} value={myExperience} onChange={setMyExperience} disabled={disabled}
            placeholder="e.g. 5 years building React dashboards; shipped 3 data-heavy apps for fintech clients"
            error={fieldErrors.my_experience || (experienceTooLong ? `Your experience can be at most ${LIMITS.myExperience.toLocaleString('en')} characters.` : undefined)}
            hint="Only write what is true — the AI is told not to invent anything beyond this."
            counter={<ProposalCounter count={charCount(myExperience)} max={LIMITS.myExperience} />}
          />

          <ProposalClientFields
            pickOnly value={client} errors={{ client: fieldErrors.client }} disabled={disabled}
            onChange={(patch) => setClient((current) => ({ ...current, ...patch }))}
          />
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="fos-btn fos-btn-accent" onClick={generate} disabled={!canGenerate}>
          {busy === 'ai' ? <span className="fos-spinner" aria-hidden="true" /> : <Sparkles size={15} />}
          {busy === 'ai' ? `Generating… ${elapsed}s` : 'Generate with AI'}
        </button>
        <button type="button" className="fos-btn fos-btn-ghost" onClick={startBlank} disabled={!canStartBlank}>
          {busy === 'blank' ? <span className="fos-spinner" aria-hidden="true" /> : <FilePlus2 size={15} />}
          Start from a blank proposal
        </button>
      </div>

      {busy === 'ai' ? (
        <p role="status" style={{ margin: '12px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          This usually takes 10–40 seconds. Please keep this page open.
        </p>
      ) : (
        <p style={{ margin: '12px 0 0', fontSize: '0.76rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          The AI sees only the job post, your experience notes, and your name, business name and profession.
        </p>
      )}
    </div>
  )
}
