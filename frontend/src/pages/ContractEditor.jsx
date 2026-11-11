// src/pages/ContractEditor.jsx
//
// One contract, at /contracts/:id. A draft is edited in place with autosave (useContractAutosave.js: there is no Save button,
// for the reason useDraftAutosave.js gives); anything else renders as the sent page (ContractSentPage.jsx).
//
// Rules this page keeps that are easy to break:
//   * The server's reply to a save never overwrites what the person typed. The snapshot is what was SENT.
//   * An id that is not a UUID is a not-found page with NO request.
//   * Send, PDF and Duplicate act on what the SERVER holds, so each first flushes the autosave and then asks readiness():
//     only a fully saved draft goes on. Preview renders the local form and needs no flush.
//   * The Send dialog's checklist is the server's (GET .../send-check/); this page only shows advisory hints (the blank
//     count) of its own.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileX, Trash2 } from 'lucide-react'

import api from '@/lib/api'
import useFlashMessage from '@/hooks/useFlashMessage'
import useTitle from '@/hooks/useTitle'
import useAuthStore from '@/store/authStore'
import useContractActions from '@/hooks/useContractActions'
import useContractAutosave from '@/hooks/useContractAutosave'
import Card from '@/components/Card'
import ContractHeader from '@/components/ContractHeader'
import ContractPreviewModal from '@/components/ContractPreviewModal'
import ContractSectionsEditor from '@/components/ContractSectionsEditor'
import ContractSentPage from '@/components/ContractSentPage'
import FormSelect from '@/components/FormSelect'
import FosAlert from '@/components/FosAlert'
import ProposalBanners from '@/components/ProposalBanners'
import ProposalClientFields from '@/components/ProposalClientFields'
import ProposalColumns from '@/components/ProposalColumns'
import { DialogButtons, ProposalDialog, dialogText } from '@/components/ProposalDialog'
import { ProposalCounter, ProposalTextArea, ProposalTextField } from '@/components/ProposalFields'
import ProposalSaveIndicator from '@/components/ProposalSaveIndicator'
import SendContractDialog from '@/components/SendContractDialog'
import { CURRENCY_OPTIONS } from './clientHelpers'
import { OWNER_COPY } from './contractCopy'
import {
  CONTRACT_LIMITS, addDays, buildSavePayload, findPlaceholders, formFromDetail, isUuid, placeholderCount, templateById,
  validateForm,
} from './contractHelpers'
import { sentBanner } from './contractLifecycle'
import { todayInPlatformTimezone } from './invoiceHelpers'
import { charCount } from './proposalHelpers'

// ══════════════════════════════════════════════════════════════════
// Loader: owns fetching, and the not-found / error / reload states
// ══════════════════════════════════════════════════════════════════

export default function ContractEditor() {
  const { id } = useParams()
  // Keyed by id so moving between two contracts starts from clean state.
  return <ContractLoader key={id} id={id} />
}

function ContractLoader({ id }) {
  useTitle('LanceraOS | Contract')
  const validId = isUuid(id)
  const [view, setView] = useState({ status: validId ? 'loading' : 'notfound', detail: null })
  const [version, setVersion] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  const [notice, setNotice] = useState(null) // { type, text } | null
  const [flash, dismissFlash] = useFlashMessage()

  // Every change of `reloadToken` (a retry, or the server saying this is no longer a draft) fetches again; a response that
  // arrives after the effect was cleaned up is dropped. A value that is not a UUID is never put into a request path.
  useEffect(() => {
    if (!validId) return undefined
    let stale = false
    api.get(`/contracts/${id}/`)
      .then(({ data }) => {
        if (stale) return
        setView({ status: 'ready', detail: data })
        setVersion((v) => v + 1) // a new version remounts the page from the fresh detail
      })
      .catch((error) => {
        if (stale) return
        setView({ status: error.response?.status === 404 ? 'notfound' : 'error', detail: null })
      })
    return () => { stale = true }
  }, [id, validId, reloadToken])

  const retry = useCallback(() => {
    setView({ status: 'loading', detail: null })
    setReloadToken((t) => t + 1)
  }, [])

  // The server said this is no longer a draft (sent from another window, or a draft-only action was refused): reload what it
  // actually is and say why.
  const handleNotDraft = useCallback((text) => {
    setNotice({ type: 'info', text: typeof text === 'string' ? text : OWNER_COPY.notDraftAnymore })
    setReloadToken((t) => t + 1)
  }, [])
  // A fresh detail the page already holds (just sent, just withdrawn): show it without another request, remount the right
  // view and say what happened.
  const applyDetail = useCallback((data, nextNotice) => {
    setView({ status: 'ready', detail: data })
    setVersion((v) => v + 1)
    setNotice(nextNotice || null)
  }, [])
  // A quiet refresh of a waiting contract: new data, same page (no remount, no banner change).
  const changeDetail = useCallback((data) => setView({ status: 'ready', detail: data }), [])
  const handleNotFound = useCallback(() => setView({ status: 'notfound', detail: null }), [])

  if (view.status === 'loading') return <EditorSkeleton />

  if (view.status === 'notfound') {
    return (
      <div style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        <FileX size={28} aria-hidden="true" style={{ color: 'var(--text-tertiary)', marginBottom: 10 }} />
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{OWNER_COPY.notFound}</p>
        <Link to="/contracts" className="fos-btn fos-btn-ghost" style={{ marginTop: 16 }}>
          <ArrowLeft size={14} aria-hidden="true" /> {OWNER_COPY.backToList}
        </Link>
      </div>
    )
  }

  if (view.status === 'error') {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>{OWNER_COPY.loadFailed}</FosAlert>
        <br />
        <button className="fos-btn fos-btn-ghost" onClick={retry}>Retry</button>
      </div>
    )
  }

  const banners = { flash, onDismissFlash: dismissFlash, notice, onDismissNotice: () => setNotice(null) }
  return view.detail.is_editable
    ? <DraftEditor key={version} detail={view.detail} banners={banners} onNotDraft={handleNotDraft} onNotFound={handleNotFound} onApplyDetail={applyDetail} />
    : <ContractSentPage key={version} detail={view.detail} banners={banners} onNotDraft={handleNotDraft} onApplyDetail={applyDetail} onDetailChange={changeDetail} onReload={retry} />
}

function EditorSkeleton() {
  const block = { background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-lg)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }
  return (
    <div aria-hidden="true">
      <div style={{ ...block, height: 44, marginBottom: 16, maxWidth: 520 }} />
      <ProposalColumns
        main={<><div style={{ ...block, height: 150, marginBottom: 16 }} /><div style={{ ...block, height: 280, marginBottom: 16 }} /></>}
        aside={<div style={{ ...block, height: 260 }} />}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// The draft editor
// ══════════════════════════════════════════════════════════════════

const FIELD_IDS = {
  title: 'contract-field-title',
  client_email: 'contract-field-client-email',
  fee_amount: 'contract-field-fee',
  valid_until: 'contract-field-valid-until',
}

function DraftEditor({ detail, banners, onNotDraft, onNotFound, onApplyDetail }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [initial] = useState(() => {
    const form = formFromDetail(detail)
    return { form, snapshot: buildSavePayload(form) }
  })
  const [form, setForm] = useState(initial.form)
  const [dialog, setDialog] = useState(null) // null | 'delete' | 'send' | 'preview'
  const [preparing, setPreparing] = useState(false)
  const [focusTarget, setFocusTarget] = useState(null)
  const [jumpTo, setJumpTo] = useState(null) // { key, token }
  const [notices, setNotices] = useState(() => (Array.isArray(location.state?.notices) ? location.state.notices : []))
  const [templates, setTemplates] = useState(null)
  const openerRef = useRef(null)
  const formRef = useRef(form)
  formRef.current = form
  const userEmail = useAuthStore((s) => s.user?.email)

  const patchForm = useCallback((patch) => setForm((current) => ({ ...current, ...patch })), [])

  // The notices from create are shown once: take them out of history state so a reload does not bring them back.
  useEffect(() => {
    if (location.state?.notices) navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null })
    // Once, on mount: the notices are already held in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The template's label for the aside (read-only). A failure only means no label.
  useEffect(() => {
    let live = true
    api.get('/contracts/templates/')
      .then(({ data }) => { if (live) setTemplates(data) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  const autosave = useContractAutosave({
    contractId: detail.id, form, initialSnapshot: initial.snapshot, enabled: true,
    onSaved: undefined, onNotDraft: () => onNotDraft(OWNER_COPY.notDraftAnymore), onNotFound,
  })

  // Everything the person sees must be saved before an action that reads the SERVER's copy (flushNow() alone says true even
  // for a field held back as invalid). Resolves true (go ahead), false (not everything is saved) or null (the page is
  // already reloading: stay silent).
  const saveGate = useCallback(async () => {
    await autosave.flushNow()
    if (autosave.isStopped()) return null
    return autosave.readiness().ready
  }, [autosave])

  const actions = useContractActions({
    detail, onNotDraft: () => onNotDraft(OWNER_COPY.notDraftAnymore), beforeDuplicate: saveGate,
    pauseSaving: autosave.pause, resumeSaving: autosave.resume,
  })

  // ── Send ──
  // The Send button is disabled while this prepares, and a browser drops focus to <body> when the focused button is
  // disabled, so the opener is remembered here for the dialog's focus restore.
  async function startSend() {
    openerRef.current = document.activeElement
    actions.clear()
    setPreparing(true)
    try {
      await autosave.flushNow()
      if (autosave.isStopped()) return // the page is already reloading
      const state = autosave.readiness()
      const { errors } = validateForm(formRef.current, autosave.getSnapshot())
      if (!state.ready || Object.keys(errors).length) {
        if (state.withheld.length || Object.keys(errors).length) {
          actions.show('error', OWNER_COPY.fieldsHaveProblems)
          setTimeout(() => document.querySelector('[aria-invalid="true"]')?.scrollIntoView?.({ block: 'center' }), 0)
        } else {
          actions.show('error', OWNER_COPY.saveFailedNothingSent)
        }
        return
      }
      autosave.pause()
      setDialog('send')
    } finally {
      setPreparing(false)
    }
  }

  async function startPdf() {
    actions.clear()
    const ready = await saveGate()
    if (ready === null) return
    if (!ready) { actions.show('error', OWNER_COPY.waitForSave); return }
    actions.downloadPdf()
  }

  const closeSend = () => { setDialog(null); autosave.resume(); setFocusTarget(openerRef.current) }

  // A checklist target: a field name, `sections`, or `section:<id>`.
  const fixTarget = (target) => {
    setDialog(null)
    autosave.resume()
    if (typeof target === 'string' && target.startsWith('section:')) {
      const section = formRef.current.sections.find((s) => s.id === target.slice('section:'.length))
      if (section) setJumpTo({ key: section.key, token: Date.now() })
      return
    }
    setFocusTarget(target === 'client_name' ? 'client-name' : target === 'sections' ? 'sections' : FIELD_IDS[target] || null)
  }
  const handleSent = (data, { method, recovered }) => {
    // Nothing resumes autosave: a paused hook does not fire its final save on unmount, and a save on a sent contract is a
    // guaranteed refusal.
    onApplyDetail(data, { type: 'success', text: sentBanner(data, method, recovered) })
  }

  // Runs after the dialog (and its focus restore) has unmounted.
  useEffect(() => {
    if (!focusTarget) return
    let element = null
    if (typeof focusTarget !== 'string') element = focusTarget
    else if (focusTarget === 'client-name') element = document.querySelector('#contract-client-card input')
    else if (focusTarget === 'sections') element = document.querySelector('#contract-sections-card button')
    else element = document.getElementById(focusTarget)
    if (element && element !== document.body && document.contains(element)) {
      element.focus()
      if (typeof focusTarget === 'string') element.scrollIntoView?.({ block: 'center' })
    }
    setFocusTarget(null)
  }, [focusTarget])

  function handleAction(key) {
    if (key === 'send') startSend()
    else if (key === 'duplicate') actions.duplicate()
    else if (key === 'delete') setDialog('delete')
    else if (key === 'preview') setDialog('preview')
    else if (key === 'pdf') startPdf()
  }

  // On failure the dialog closes, so the error shown on the page is not hidden behind its overlay.
  const confirmDelete = async () => {
    if (!(await actions.remove())) setDialog(null)
  }

  // ── Derived display values ──
  const busy = actions.busy !== null || dialog === 'send'
  const errors = autosave.validation
  const serverErrors = autosave.serverErrors
  const fieldError = (key) => errors[key] || serverErrors[key]
  const blankTotal = useMemo(() => placeholderCount(form.sections), [form.sections])
  const sectionsWithBlanks = useMemo(
    () => form.sections
      .map((section, index) => ({ section, index, count: findPlaceholders(section.title).length + findPlaceholders(section.text).length }))
      .filter((entry) => entry.count > 0),
    [form.sections],
  )
  const currencyOptions = CURRENCY_OPTIONS.some((o) => o.value === form.currency)
    ? CURRENCY_OPTIONS
    : [...CURRENCY_OPTIONS, { value: form.currency, label: form.currency }]
  const template = templates ? templateById(templates.templates, detail.template_key) : null

  const main = (
    <>
      <div id="contract-client-card">
        <Card title={OWNER_COPY.detailsTitle}>
          <ProposalClientFields
            value={form} onChange={patchForm} disabled={busy}
            errors={{
              client: serverErrors.client, client_name: fieldError('client_name'),
              client_email: fieldError('client_email'), client_company: fieldError('client_company'),
            }}
            emailFieldId={FIELD_IDS.client_email} emailHint={OWNER_COPY.clientEmailHint}
          />
        </Card>
      </div>

      <div id="contract-sections-card">
        <Card title={OWNER_COPY.sectionsTitle}>
          <ContractSectionsEditor
            sections={form.sections} onChange={(sections) => patchForm({ sections })} disabled={busy}
            errors={errors.sections} serverError={serverErrors.sections} jumpTo={jumpTo}
          />
        </Card>
      </div>

      <Card title={OWNER_COPY.keyTermsTitle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <ProposalTextField
              id={FIELD_IDS.fee_amount} label={OWNER_COPY.feeLabel} inputMode="decimal" value={form.fee_amount} disabled={busy}
              onChange={(text) => patchForm({ fee_amount: text })} error={fieldError('fee_amount')} hint={OWNER_COPY.feeHint}
            />
            <FormSelect label={OWNER_COPY.currencyLabel} value={form.currency} options={currencyOptions} disabled={busy} onChange={(e) => patchForm({ currency: e.target.value })} />
          </div>
          <ProposalTextArea
            label={OWNER_COPY.paymentTermsLabel} rows={3} value={form.payment_terms} disabled={busy}
            onChange={(text) => patchForm({ payment_terms: text })}
            placeholder="e.g. 50% upfront, 50% on delivery. Payable within 14 days."
            error={fieldError('payment_terms')}
            counter={<ProposalCounter count={charCount(form.payment_terms)} max={CONTRACT_LIMITS.PAYMENT_TERMS_MAX} />}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <ProposalTextField
              label={OWNER_COPY.startLabel} type="date" value={form.start_date} disabled={busy}
              onChange={(text) => patchForm({ start_date: text })} error={fieldError('start_date')}
            />
            <ProposalTextField
              label={OWNER_COPY.endLabel} type="date" value={form.end_date} disabled={busy}
              onChange={(text) => patchForm({ end_date: text })} error={fieldError('end_date')}
            />
          </div>
          <div>
            <div style={{ maxWidth: 240 }}>
              <ProposalTextField
                id={FIELD_IDS.valid_until} label={OWNER_COPY.signByLabel} type="date" value={form.valid_until} disabled={busy}
                min={todayInPlatformTimezone()} onChange={(text) => patchForm({ valid_until: text })}
                error={fieldError('valid_until')} hint={OWNER_COPY.signByHint}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {OWNER_COPY.quickPicks.map((pick) => (
                <button
                  key={pick.days} type="button" className="fos-btn fos-btn-ghost" style={{ minHeight: 36, fontSize: '0.78rem' }}
                  disabled={busy} onClick={() => patchForm({ valid_until: addDays(todayInPlatformTimezone(), pick.days) })}
                >
                  {pick.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </>
  )

  const aside = (
    <>
      <Card title={OWNER_COPY.blanksTitle}>
        <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{OWNER_COPY.blanksExplain}</p>
        <p role="status" style={{ margin: '0 0 8px', fontSize: '0.85rem', fontWeight: 700, color: blankTotal ? 'var(--status-amber-text)' : 'var(--status-green-text)' }}>
          {blankTotal ? OWNER_COPY.blanksCount(blankTotal) : OWNER_COPY.blanksNone}
        </p>
        {sectionsWithBlanks.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sectionsWithBlanks.map(({ section, index, count }) => (
              <li key={section.key}>
                <button
                  type="button" className="fos-btn fos-btn-ghost"
                  style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', minHeight: 40, fontSize: '0.8rem' }}
                  onClick={() => setJumpTo({ key: section.key, token: Date.now() })}
                >
                  {index + 1}. {section.title.trim() || OWNER_COPY.untitledSection} ({count})
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={OWNER_COPY.howSigningWorksTitle}>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {OWNER_COPY.howSigningWorks.map((line) => <li key={line} style={{ marginBottom: 4 }}>{line}</li>)}
        </ul>
      </Card>

      <p style={{ margin: '0 0 16px', fontSize: '0.78rem', color: 'var(--status-amber-text)', lineHeight: 1.55 }}>{OWNER_COPY.disclaimer}</p>

      <Card title={OWNER_COPY.templateTitle}>
        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{template?.label || detail.template_key}</p>
        <p style={{ margin: '2px 0 0', fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{OWNER_COPY.templateVersion(detail.template_version)}</p>
      </Card>
    </>
  )

  return (
    <div style={{ maxWidth: 1180 }}>
      {notices.map((text, index) => (
        <FosAlert key={text} type="info" onDismiss={() => setNotices((list) => list.filter((_, i) => i !== index))} style={{ marginBottom: 16 }}>{text}</FosAlert>
      ))}
      <ProposalBanners {...banners} message={actions.message} onDismissMessage={actions.clear} />
      {actions.pdfError && <FosAlert type="error" onDismiss={actions.clearPdfError} style={{ marginBottom: 16 }}>{actions.pdfError}</FosAlert>}

      <ContractHeader
        detail={detail} disabled={busy} preparing={preparing} pdfBusy={actions.pdfBusy} onAction={handleAction}
        titleField={(
          <ProposalTextField
            id={FIELD_IDS.title} label={OWNER_COPY.titleLabel} value={form.title} disabled={busy} required
            onChange={(text) => patchForm({ title: text })} error={fieldError('title')}
            style={{ fontSize: '1.05rem', fontWeight: 700 }}
          />
        )}
        saveIndicator={(
          <ProposalSaveIndicator
            status={autosave.status} retrying={autosave.retrying} rateLimited={autosave.rateLimited}
            withheld={autosave.withheld} dirty={autosave.dirty} onRetry={autosave.retry}
          />
        )}
      />

      <ProposalColumns main={main} aside={aside} />

      {dialog === 'send' && (
        <SendContractDialog
          contractId={detail.id} clientEmail={autosave.getSnapshot().client_email} userEmail={userEmail}
          onSent={handleSent} onClose={closeSend} onFix={fixTarget} onNotDraft={onNotDraft}
        />
      )}

      {dialog === 'preview' && <ContractPreviewModal kind="form" source={form} detail={detail} onClose={() => setDialog(null)} />}

      {dialog === 'delete' && (
        <ProposalDialog title={OWNER_COPY.deleteTitle} busy={actions.busy === 'delete'} onClose={() => setDialog(null)}>
          <p style={dialogText}>{OWNER_COPY.deleteBody}</p>
          <DialogButtons
            busy={actions.busy === 'delete'} onClose={() => setDialog(null)} cancelLabel={OWNER_COPY.cancelButton}
            confirm={(
              <button type="button" className="fos-btn fos-btn-danger" onClick={confirmDelete} disabled={actions.busy === 'delete'}>
                {actions.busy === 'delete' ? <span className="fos-spinner" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                {actions.busy === 'delete' ? OWNER_COPY.deleting : OWNER_COPY.deleteButton}
              </button>
            )}
          />
        </ProposalDialog>
      )}
    </div>
  )
}
