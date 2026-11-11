// src/pages/ContractNew.jsx
//
// Create a contract draft (Prompt 23, Part 6b): choose one of the five templates, optionally name the client, and
// optionally start from an ACCEPTED proposal (?proposal=<id>), whose fee, currency, payment terms and client fill the
// draft. The next screen is the editor.
//
// Safety properties:
//   * Nothing the person typed is ever lost: every failure leaves every field as it was, with the action available again.
//   * One create request: a ref lock makes a double click send one.
//   * Never navigates without an id: an ambiguous ending ("no answer") says the contract MAY have been created and points at
//     the list, rather than claiming a plain failure that invites a duplicate.
//   * A ?proposal= value that is not a UUID is ignored and never requested.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import Card from '@/components/Card'
import ContractTemplatePicker from '@/components/ContractTemplatePicker'
import FosAlert from '@/components/FosAlert'
import ProposalClientFields from '@/components/ProposalClientFields'
import { ProposalTextField } from '@/components/ProposalFields'
import { OWNER_COPY } from './contractCopy'
import {
  CONTRACT_LIMITS, errorMessage, fieldErrorsFromResponse, isUuid, templateById,
} from './contractHelpers'
import { charCount } from './proposalHelpers'

const EMPTY_CLIENT = { client: null, client_name: '', client_email: '', client_company: '' }

export default function ContractNew() {
  useTitle('LanceraOS | New Contract')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const proposalParam = searchParams.get('proposal')

  const [templates, setTemplates] = useState(null) // null while loading
  const [templatesError, setTemplatesError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [templateKey, setTemplateKey] = useState('')
  const [title, setTitle] = useState('')
  const [client, setClient] = useState(EMPTY_CLIENT)
  const [proposal, setProposal] = useState(null) // { id, title } once found and accepted
  const [proposalProblem, setProposalProblem] = useState(null)
  const [busy, setBusy] = useState(false)
  const [alert, setAlert] = useState(null) // { type, text, ambiguous? }
  const [fieldErrors, setFieldErrors] = useState({})

  const mountedRef = useRef(true)
  const submitRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let live = true
    setTemplatesError(false)
    api.get('/contracts/templates/')
      .then(({ data }) => { if (live) setTemplates(data.templates || []) })
      .catch(() => { if (live) { setTemplates([]); setTemplatesError(true) } })
    return () => { live = false }
  }, [reloadKey])

  // An accepted proposal fills the draft. A value that is not a UUID is ignored; a proposal that is missing or not accepted
  // is reported and left out, and the form carries on without it.
  useEffect(() => {
    if (!isUuid(proposalParam)) return undefined
    let live = true
    api.get(`/proposals/${proposalParam}/`)
      .then(({ data }) => {
        if (!live) return
        if (data.status === 'accepted') setProposal({ id: data.id, title: data.title })
        else setProposalProblem(OWNER_COPY.proposalNotAccepted)
      })
      .catch(() => { if (live) setProposalProblem(OWNER_COPY.proposalMissing) })
    return () => { live = false }
  }, [proposalParam])

  const template = templateById(templates, templateKey)
  const titleTooLong = charCount(title) > CONTRACT_LIMITS.TITLE_MAX
  const canCreate = Boolean(templateKey) && !titleTooLong && !busy

  function handleFailure(error) {
    if (!mountedRef.current) return
    const { message, status, reason } = errorMessage(error, OWNER_COPY.createFailed)
    if (status === 409 && reason === 'proposal_not_accepted') {
      setProposal(null)
      setProposalProblem(message)
      return
    }
    if (status === 400) {
      const fields = fieldErrorsFromResponse(error.response.data)
      setFieldErrors(fields)
      setAlert(Object.keys(fields).length ? null : { type: 'error', text: message })
      return
    }
    if (!error?.response || status >= 500) {
      setAlert({ type: 'error', text: OWNER_COPY.createFailed })
      return
    }
    setAlert({ type: 'error', text: message })
  }

  async function create() {
    if (submitRef.current || !canCreate) return
    submitRef.current = true
    setBusy(true)
    setAlert(null)
    setFieldErrors({})
    const body = { template_key: templateKey }
    if (title.trim()) body.title = title.trim()
    if (client.client) {
      body.client = client.client
    } else {
      if (client.client_name.trim()) body.client_name = client.client_name.trim()
      if (client.client_email.trim()) body.client_email = client.client_email.trim()
      if (client.client_company.trim()) body.client_company = client.client_company.trim()
    }
    if (proposal) body.proposal = proposal.id
    try {
      const { data } = await api.post('/contracts/', body)
      if (!mountedRef.current) return
      navigate(`/contracts/${data.id}`, { replace: true, state: { notices: data.notices || [] } })
    } catch (error) {
      handleFailure(error)
    } finally {
      submitRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <Link to="/contracts" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: '0.82rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
        <ArrowLeft size={14} aria-hidden="true" /> {OWNER_COPY.backToList}
      </Link>

      {alert && (
        <FosAlert type={alert.type} onDismiss={busy ? undefined : () => setAlert(null)} style={{ marginBottom: 16 }}>
          {alert.text}
        </FosAlert>
      )}
      {proposalProblem && (
        <FosAlert type="warning" onDismiss={() => setProposalProblem(null)} style={{ marginBottom: 16 }}>{proposalProblem}</FosAlert>
      )}
      {proposal && (
        <FosAlert type="info" style={{ marginBottom: 16 }}>
          <strong>{OWNER_COPY.fromProposal(proposal.title)}</strong>
          <br />
          {OWNER_COPY.fromProposalCopied}
        </FosAlert>
      )}

      <Card title={OWNER_COPY.newTitle} subtitle={OWNER_COPY.newIntro}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {templates === null && (
            <div aria-busy="true" role="status" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading templates…</span>
              {[1, 2, 3].map((i) => <div key={i} style={{ height: 150, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-lg)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />)}
            </div>
          )}
          {templatesError && (
            <div>
              <FosAlert type="error" style={{ marginBottom: 12 }}>{OWNER_COPY.templatesLoadFailed}</FosAlert>
              <button type="button" className="fos-btn fos-btn-ghost" onClick={() => { setTemplates(null); setReloadKey((k) => k + 1) }}>Retry</button>
            </div>
          )}
          {templates !== null && templates.length > 0 && (
            <ContractTemplatePicker
              templates={templates} value={templateKey} onChange={setTemplateKey} disabled={busy}
              error={fieldErrors.template_key}
            />
          )}

          <ProposalTextField
            id="contract-field-title" label={OWNER_COPY.titleOptionalLabel} value={title} onChange={setTitle} disabled={busy}
            placeholder={OWNER_COPY.titlePlaceholder(template?.label || 'Web Development')}
            error={fieldErrors.title || (titleTooLong ? `The title can be at most ${CONTRACT_LIMITS.TITLE_MAX} characters.` : undefined)}
          />

          <ProposalClientFields
            value={client} disabled={busy}
            errors={{ client: fieldErrors.client, client_name: fieldErrors.client_name, client_email: fieldErrors.client_email, client_company: fieldErrors.client_company }}
            onChange={(patch) => setClient((current) => ({ ...current, ...patch }))}
            emailFieldId="contract-field-client-email" emailHint={OWNER_COPY.clientEmailHint}
          />
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="fos-btn fos-btn-accent" onClick={create} disabled={!canCreate}>
          {busy && <span className="fos-spinner" aria-hidden="true" />}
          {busy ? OWNER_COPY.creating : OWNER_COPY.createButton}
        </button>
        {!templateKey && templates !== null && templates.length > 0 && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>{OWNER_COPY.chooseTemplate}</span>
        )}
      </div>

      <p style={{ margin: '14px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>{OWNER_COPY.disclaimer}</p>
    </div>
  )
}
