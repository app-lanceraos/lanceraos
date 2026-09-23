// src/pages/portal/PortalMyDetails.jsx
//
// /portal/details — Client Portal Redesign, Phase 4. Read-only view of
// the client's own contact details plus a request-change flow — genuinely
// Client-scoped (per Phase 1b's own report), not invoice-scoped, so it
// mirrors PortalPayments.jsx's own fetch-its-own-endpoint/loading-error-
// session pattern rather than reading from PortalShell's Overview context
// (usePortalOverview.js) — that context has no Client-detail fields in
// its own response shape at all.
//
// Real, current shapes, confirmed directly against
// apps/clients/views_portal.py (portal_my_details/portal_my_details_
// request_change) and apps/clients/serializers.py
// (PortalClientDetailSerializer/ClientDetailsChangeRequestSerializer),
// not assumed from any prior summary:
//   GET  /api/clients/portal/details/
//     -> { name, email, company, phone, address, country }
//        (read-only allowlist — never ClientSerializer/ClientListSerializer,
//        which carry the freelancer's own private notes/flags/scoring/
//        portal_token; company/phone/address/country can be blank,
//        name/email cannot — Client.company/phone/address/country all
//        have blank=True, name/email don't)
//   POST /api/clients/portal/details/request-change/
//     <- { proposed_name?, proposed_email?, proposed_company?,
//          proposed_phone?, proposed_address?, proposed_country?,
//          message? } — every field optional, but the backend rejects an
//        entirely empty submission (its own `validate()`: "Provide at
//        least one proposed change or a message"), enforced here too so a
//        client isn't round-tripped to the server just to learn that.
//        NEVER writes to the Client row — this view's own real backend
//        docstring is explicit that it only emits ClientDetailsChangeRequested
//        for the freelancer to review and apply themselves via their own
//        PUT /api/clients/<pk>/, so this page's own copy says exactly
//        that, never implying an immediate change.
//     -> 201 { message: 'Your request has been sent.' }
//     -> 429 { error: 'Too many requests. Please try again later.' } —
//        the exact same shape every other portal write endpoint's rate
//        limit already returns (ClaimModal's own `e.response?.data?.error`
//        fallback pattern handles this with zero special-casing, since
//        the backend already writes a real, specific message).
import { useEffect, useState } from 'react'
import { IdCard, Send } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import {
  BODY_TEXT, DIVIDER, ERROR, MUTED_TEXT, NAVY,
  disabledStyle, publicBtnGhost, publicBtnPrimary, publicInputStyle, publicLabelStyle,
} from './portalShared'
import { cardStyle, sectionTitleStyle } from './PortalBalances'
import PortalRequestLinkForm from './PortalRequestLinkForm'
import { Skeleton } from './PortalShell'

// name/email are the 2 fields Client never leaves blank (model fields
// with no blank=True) — every other field renders 'Not provided' rather
// than a blank gap that could read as a loading glitch, per this task's
// own explicit instruction.
const DETAIL_ROWS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'country', label: 'Country' },
]

// Mirrors ClientDetailsChangeRequestSerializer.PROPOSED_FIELDS exactly —
// the `proposed_` prefix + which of DETAIL_ROWS's own keys map to it.
// `article` is just for the empty-field placeholder's own grammar
// ("Add an address", not "Add a address").
const PROPOSED_FIELDS = [
  { key: 'name', proposedKey: 'proposed_name', label: 'Name', article: 'a' },
  { key: 'email', proposedKey: 'proposed_email', label: 'Email', article: 'an' },
  { key: 'company', proposedKey: 'proposed_company', label: 'Company', article: 'a' },
  { key: 'phone', proposedKey: 'proposed_phone', label: 'Phone', article: 'a' },
  { key: 'address', proposedKey: 'proposed_address', label: 'Address', article: 'an' },
  { key: 'country', proposedKey: 'proposed_country', label: 'Country', article: 'a' },
]

const EMPTY_PROPOSED = { name: '', email: '', company: '', phone: '', address: '', country: '' }

function DetailRow({ label, value, isLast }) {
  const hasValue = (value || '').trim().length > 0
  return (
    <div style={{ padding: '10px 0', borderBottom: isLast ? 'none' : `1px solid ${DIVIDER}` }}>
      <p style={{ margin: '0 0 2px', fontSize: '0.7rem', fontWeight: 600, color: MUTED_TEXT, letterSpacing: '0.03em' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: '0.88rem', color: hasValue ? NAVY : MUTED_TEXT, fontStyle: hasValue ? 'normal' : 'italic' }}>
        {hasValue ? value : 'Not provided'}
      </p>
    </div>
  )
}

export default function PortalMyDetails() {
  useTitle('My Details — LanceraOS')
  // 'loading' | 'ready' | 'needs_link' | 'error'
  const [state, setState] = useState('loading')
  const [details, setDetails] = useState(null)
  // 'view' | 'form' | 'success'
  const [mode, setMode] = useState('view')
  const [proposed, setProposed] = useState(EMPTY_PROPOSED)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  function load() {
    setState((prev) => (prev === 'ready' ? prev : 'loading'))
    api.get('/clients/portal/details/')
      .then(({ data }) => { setDetails(data); setState('ready') })
      .catch((e) => setState(e.response?.status === 401 ? 'needs_link' : 'error'))
  }

  useEffect(() => { load() }, [])

  function resetForm() {
    setProposed(EMPTY_PROPOSED)
    setMessage('')
    setFormError('')
  }

  function openForm() {
    resetForm()
    setMode('form')
  }

  async function submit() {
    const hasProposedField = Object.values(proposed).some((v) => v.trim().length > 0)
    const hasMessage = message.trim().length > 0
    if (!hasProposedField && !hasMessage) {
      setFormError('Enter at least one new value, or a message.')
      return
    }
    setFormError('')
    setBusy(true)
    try {
      const payload = { message: message.trim() }
      for (const { key, proposedKey } of PROPOSED_FIELDS) {
        payload[proposedKey] = proposed[key].trim()
      }
      await api.post('/clients/portal/details/request-change/', payload)
      setMode('success')
    } catch (e) {
      setFormError(e.response?.data?.error || 'Could not send your request — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return <Skeleton />

  // A stray 401 here (session expired between the shell's own Overview
  // fetch and this page's own fetch) — same rare-race reasoning as
  // ClientPortal.jsx's/PortalPayments.jsx's own needsLink fallback.
  if (state === 'needs_link') {
    return (
      <div>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700, color: NAVY }}>Your session has ended</h1>
        <p style={{ margin: 0, fontSize: '0.85rem', color: MUTED_TEXT }}>Enter your email and we'll send you a fresh link.</p>
        <PortalRequestLinkForm />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div>
        <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: ERROR }}>Something went wrong loading your details.</p>
        <button onClick={load} style={publicBtnPrimary}>Try again</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: NAVY }}>My Details</h1>
      </div>

      {mode === 'success' && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: '28px 20px' }}>
          <Send size={22} style={{ color: MUTED_TEXT, marginBottom: 10 }} />
          <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: NAVY }}>Your request has been sent.</p>
          <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: MUTED_TEXT, lineHeight: 1.6 }}>
            Nothing on your record has changed yet — they'll review what you sent and update your
            details themselves if they'd like to accept it.
          </p>
          <button onClick={() => setMode('view')} style={{ ...publicBtnGhost, marginTop: 16 }}>
            Back to My Details
          </button>
        </div>
      )}

      {mode === 'view' && (
        <>
          <section>
            <h2 style={sectionTitleStyle}>Your Details</h2>
            <div style={cardStyle}>
              {DETAIL_ROWS.map((row, i) => (
                <DetailRow key={row.key} label={row.label} value={details[row.key]} isLast={i === DETAIL_ROWS.length - 1} />
              ))}
            </div>
          </section>

          <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <IdCard size={18} style={{ color: MUTED_TEXT, flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: '0.82rem', color: BODY_TEXT, flex: '1 1 200px' }}>
              Something out of date? Let them know and they'll review it — nothing changes automatically.
            </p>
            <button onClick={openForm} style={publicBtnPrimary}>Request a Change</button>
          </div>
        </>
      )}

      {mode === 'form' && (
        <section>
          <h2 style={sectionTitleStyle}>Request a Change</h2>
          <div style={cardStyle}>
            <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: MUTED_TEXT, lineHeight: 1.6 }}>
              Fill in a new value for anything that's changed, add a note, or both. This sends a
              proposal only — they review it and update your details themselves; nothing on your
              own record changes automatically.
            </p>

            {formError && (
              <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: ERROR }}>{formError}</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
              {PROPOSED_FIELDS.map(({ key, label, article }) => (
                <div key={key}>
                  <label style={publicLabelStyle}>New {label.toLowerCase()}</label>
                  <input
                    type={key === 'email' ? 'email' : 'text'}
                    value={proposed[key]}
                    onChange={(e) => setProposed((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={details[key] || `Add ${article} ${label.toLowerCase()}`}
                    style={publicInputStyle}
                  />
                </div>
              ))}
              <div>
                <label style={publicLabelStyle}>Message (optional)</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Anything else they should know"
                  rows={3}
                  style={{ ...publicInputStyle, resize: 'vertical', fontFamily: "'DM Sans', sans-serif" }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setMode('view')} style={publicBtnGhost}>Cancel</button>
              <button onClick={submit} disabled={busy} style={disabledStyle(publicBtnPrimary, busy)}>
                {busy ? <span className="fos-spinner" /> : <Send size={14} />} Send Request
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
