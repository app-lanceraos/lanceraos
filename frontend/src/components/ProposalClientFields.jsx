// src/components/ProposalClientFields.jsx
//
// The proposal's client: a live search over the user's saved clients (the same
// GET /clients/?search= endpoint and pick-fills-everything behaviour as the
// invoice form's ClientSearchField), or plain typed details for someone not
// in the CRM yet — a freelancer often pastes a job post before the client
// exists. The server snapshots a picked client's name / email / company into
// the proposal, so these three fields are always the real, editable values.
//
// Two shapes, one component, shared by the create page and the editor:
//   full      — name (doubles as the search box), email, company. Editing the
//               name or email DETACHES the saved client (`client: null`): the
//               proposal is now customised for this one send, not a mutation of
//               the CRM record. Company edits keep the link (the server keeps
//               inline edits when the same client is sent again).
//   pickOnly  — the create page. The AI endpoint accepts a saved-client id and
//               nothing else about the client, so typed-but-unsaved details
//               would be silently dropped; this mode therefore only lets you
//               pick (or clear) a saved client and says where to add the rest.
//
// `value`/`onChange` use the form's own field names; onChange receives a patch.
import { hoverProps } from '@/lib/hoverProps'
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

import api from '@/lib/api'
import { ProposalTextField } from './ProposalFields'

const SEARCH_DEBOUNCE_MS = 300

export default function ProposalClientFields({ value, onChange, errors = {}, disabled = false, pickOnly = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const timerRef = useRef(null)
  const requestIdRef = useRef(0)
  const rootRef = useRef(null)

  useEffect(() => () => {
    clearTimeout(timerRef.current)
    requestIdRef.current += 1
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const closeOnOutside = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const closeOnEscape = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function search(text) {
    clearTimeout(timerRef.current)
    const requestId = ++requestIdRef.current
    if (!text.trim()) { setResults([]); setSearching(false); return }
    setSearching(true)
    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/clients/', { params: { search: text.trim(), limit: 8 } })
        if (requestId !== requestIdRef.current) return
        setResults(data.results || [])
      } catch {
        if (requestId !== requestIdRef.current) return
        setResults([])
      } finally {
        if (requestId === requestIdRef.current) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
  }

  function handleNameChange(text) {
    setOpen(true)
    if (pickOnly) setQuery(text)
    else onChange({ client_name: text, client: null })
    search(text)
  }

  function pick(client) {
    setOpen(false)
    setQuery('')
    setResults([])
    onChange({ client: client.id, client_name: client.name || '', client_email: client.email || '', client_company: client.company || '' })
  }

  function clearPicked() {
    onChange({ client: null, client_name: '', client_email: '', client_company: '' })
  }

  const nameText = pickOnly ? query : value.client_name
  const dropdown = open && nameText.trim() && (searching || results.length > 0) && (
    <div
      aria-label="Matching clients"
      style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg-surface)', border: '1.5px solid var(--accent)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: 220, overflowY: 'auto', zIndex: 5 }}
    >
      {searching && <p style={{ margin: 0, padding: '10px 12px', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Searching…</p>}
      {!searching && results.map((client) => (
        <button
          type="button" key={client.id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => pick(client)}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
          {...hoverProps((e) => { e.currentTarget.style.background = 'var(--bg-surface-2)' }, (e) => { e.currentTarget.style.background = 'none' })}
        >
          <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{client.name}</span>
          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{client.email}{client.company ? ` · ${client.company}` : ''}</span>
        </button>
      ))}
    </div>
  )

  if (pickOnly) {
    if (value.client) {
      return (
        <div>
          <p className="fos-label">Client</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value.client_name}</span>
              {value.client_email && <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value.client_email}</span>}
            </span>
            <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: 6 }} onClick={clearPicked} disabled={disabled} aria-label="Remove client" data-tooltip="Remove client">
              <X size={15} />
            </button>
          </div>
          {errors.client && <p className="fos-error" role="alert">{errors.client}</p>}
        </div>
      )
    }
    return (
      <div ref={rootRef} style={{ position: 'relative' }}>
        <ProposalTextField
          label="Client (optional)" value={query} onChange={handleNameChange} disabled={disabled}
          placeholder="Search your saved clients" autoComplete="off"
          error={errors.client}
          hint="Not in your clients yet? Add their details on the next screen."
        />
        {dropdown}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div ref={rootRef} style={{ position: 'relative' }}>
          <ProposalTextField
            label="Client name" value={value.client_name} onChange={handleNameChange} disabled={disabled}
            autoComplete="off" error={errors.client_name || errors.client}
            hint={value.client ? 'Linked to a saved client — editing the name or email detaches it' : 'Type to search your saved clients'}
          />
          {dropdown}
        </div>
        <ProposalTextField
          label="Client email" type="email" value={value.client_email} disabled={disabled} error={errors.client_email}
          onChange={(text) => onChange({ client_email: text, client: null })}
          hint="Needed to send the proposal by email"
        />
      </div>
      <ProposalTextField
        label="Company" value={value.client_company} disabled={disabled} error={errors.client_company}
        onChange={(text) => onChange({ client_company: text })}
      />
    </div>
  )
}
