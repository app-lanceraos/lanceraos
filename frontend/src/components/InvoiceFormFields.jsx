// src/components/InvoiceFormFields.jsx
//
// Shared client-picker + line-items + options form used by both Invoices.jsx
// (create) and InvoiceDetailPanel.jsx (edit a draft). Extracted as a
// components/ file for the same reason Card.jsx was (DESIGN.md Section 12's
// amendment): the client combobox, reorderable line-item rows, and live
// totals calc are identical in both places, and duplicating them would
// itself violate STANDARDS.md's single-source-of-truth rule. Not a generic
// Modal/Table/Badge — a genuine single-purpose structural extraction.
//
// Does not touch the network itself — the parent owns submit/cancel and
// passes `form`/`setForm` down, matching how EditClientModal/
// CreateClientModal take `form`/`onChange` from Clients.jsx rather than
// managing their own state.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'

import api from '@/lib/api'
import FormField from './FormField'
import FormSelect from './FormSelect'
import FosAlert from './FosAlert'
import {
  CURRENCY_OPTIONS, formatMoney, RECURRING_INTERVAL_OPTIONS, computeTotals,
} from '@/pages/invoiceHelpers'

const BLANK_ITEM = { description: '', quantity: '1', unit_price: '' }

// `stage` is optional — omitted (InvoiceDetailPanel's existing usage,
// editing an already-created draft) renders every section at once,
// unchanged from before this prop existed. NewInvoiceWizard.jsx passes
// 1/2/3 to render only that stage's fields, per this pass's revised stage
// boundaries (currency/tax/discount moved OUT of stage 3 and into stage 2,
// alongside line items, so the running total is visible while it's still
// being built — see computeTotals below; this superseded an earlier pass
// that grouped them with notes/terms in stage 3 instead):
//   1: client (search-driven — see ClientSearchField below) + due date
//   2: line items + currency/tax/discount + a live running total
//   3: notes/terms + reminders/late-fee/recurring options
function showStage(stage, n) {
  return !stage || stage === n
}

export default function InvoiceFormFields({
  form, setForm, errors = {}, stage, allowSaveAsNewClient = false, duplicateClientError, onDismissDuplicateClientError,
}) {
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  function setItem(i, key, value) {
    setForm((f) => {
      const items = [...f.items]
      items[i] = { ...items[i], [key]: value }
      return { ...f, items }
    })
  }
  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { ...BLANK_ITEM }] }))
  }
  function removeItem(i) {
    setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))
  }
  function moveItem(i, dir) {
    setForm((f) => {
      const items = [...f.items]
      const j = i + dir
      if (j < 0 || j >= items.length) return f
      ;[items[i], items[j]] = [items[j], items[i]]
      return { ...f, items }
    })
  }

  const totals = computeTotals(form)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Client (stage 1) — a single search-driven field replaces the old
          Existing/One-Time button toggle (see this component's own DECISIONS.md
          entry): typing searches apps.clients' real list live; picking a result
          fills every field below directly, no separate mode switch. Typed text
          that matches nothing is just one-time-client data as typed — Company/
          Phone stay plain, always-visible fields either way. ── */}
      {showStage(stage, 1) && (
      <div>
        <p className="fos-label" style={{ marginBottom: 8 }}>Client</p>
        <ClientSearchField form={form} setForm={setForm} errors={errors} />

        {allowSaveAsNewClient && !form.client && form.client_name.trim() && form.client_email.trim() && (
          <div style={{ marginTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox" checked={form.save_as_new_client}
                onChange={(e) => set('save_as_new_client', e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
              />
              Save this as a new client
            </label>
            {duplicateClientError && (
              <FosAlert type="error" onDismiss={onDismissDuplicateClientError} style={{ marginTop: 8 }}>{duplicateClientError}</FosAlert>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
          <FormField label="Company" value={form.client_company} onChange={(e) => set('client_company', e.target.value)} />
          <FormField label="Phone" value={form.client_phone} onChange={(e) => set('client_phone', e.target.value)} />
        </div>

        {/* Due date is part of stage 1 — the stage the creation threshold
            gets crossed on; currency/tax/discount live in stage 2 below,
            with the line items they total. */}
        <div style={{ marginTop: 10, maxWidth: 220 }}>
          <FormField label="Due Date" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
        </div>
      </div>
      )}

      {/* ── Line items + currency/tax/discount + live running total (stage 2) ── */}
      {showStage(stage, 2) && (
      <>
      <div>
        <p className="fos-label" style={{ marginBottom: 8 }}>Line Items{errors.items && <span className="fos-error" style={{ display: 'inline', marginLeft: 8 }}>{errors.items}</span>}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.items.map((item, i) => (
            <div key={i} style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Item {i + 1}</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} className="fos-btn fos-btn-ghost" style={{ padding: 4, opacity: i === 0 ? 0.3 : 1 }} aria-label="Move up">
                    <ChevronUp size={13} />
                  </button>
                  <button type="button" onClick={() => moveItem(i, 1)} disabled={i === form.items.length - 1} className="fos-btn fos-btn-ghost" style={{ padding: 4, opacity: i === form.items.length - 1 ? 0.3 : 1 }} aria-label="Move down">
                    <ChevronDown size={13} />
                  </button>
                  <button type="button" onClick={() => removeItem(i)} disabled={form.items.length === 1} className="fos-btn fos-btn-ghost" style={{ padding: 4, color: 'var(--status-red-text)', opacity: form.items.length === 1 ? 0.3 : 1 }} aria-label="Remove item">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <FormField
                  label="Description" required value={item.description}
                  onChange={(e) => setItem(i, 'description', e.target.value)} error={errors[`item_${i}_description`]}
                  placeholder="Service or product"
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <FormField label="Quantity" type="number" value={item.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} />
                  <FormField label={`Unit Price (${form.currency})`} type="number" value={item.unit_price} onChange={(e) => setItem(i, 'unit_price', e.target.value)} />
                </div>
              </div>
              {item.quantity && item.unit_price && (
                <p style={{ margin: '6px 0 0', fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent)', textAlign: 'right' }}>
                  {formatMoney((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0), form.currency)}
                </p>
              )}
            </div>
          ))}
        </div>
        <button
          type="button" onClick={addItem}
          style={{ width: '100%', marginTop: 8, background: 'none', border: '1.5px dashed var(--border-default)', borderRadius: 'var(--radius-md)', padding: 10, cursor: 'pointer', color: 'var(--accent)', fontSize: '0.82rem', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Plus size={14} /> Add Line Item
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <FormSelect label="Currency" value={form.currency} onChange={(e) => set('currency', e.target.value)} options={CURRENCY_OPTIONS} />
        <FormField label="Tax Rate (%)" type="number" value={form.tax_rate} onChange={(e) => set('tax_rate', e.target.value)} />
        <FormField label={`Discount (${form.currency})`} type="number" value={form.discount_amount} onChange={(e) => set('discount_amount', e.target.value)} />
      </div>

      {/* ── Running total — client-side display only, updates live as items/
          tax/discount change; the server's own recalculate_totals() is
          authoritative on save ── */}
      <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Row label="Subtotal" value={formatMoney(totals.subtotal, form.currency)} />
        {totals.tax > 0 && <Row label={`Tax (${form.tax_rate}%)`} value={formatMoney(totals.tax, form.currency)} />}
        {totals.discount > 0 && <Row label="Discount" value={`−${formatMoney(totals.discount, form.currency)}`} muted />}
        <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 4, paddingTop: 6 }}>
          <Row label="Total" value={formatMoney(totals.total, form.currency)} bold />
        </div>
      </div>
      </>
      )}

      {/* ── Notes/terms + reminders/late-fee/recurring options (stage 3) ── */}
      {showStage(stage, 3) && (
      <>
      {/* ── Notes / terms ── */}
      <div>
        <label className="fos-label">Notes for Client</label>
        <textarea className="fos-input" style={{ minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
      </div>
      <div>
        <label className="fos-label">Payment Terms</label>
        <textarea className="fos-input" style={{ minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} value={form.terms} onChange={(e) => set('terms', e.target.value)} placeholder="e.g. Payment due within 30 days." />
      </div>

      {/* ── Options ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <OptionToggle
          label="Reminders enabled" hint="Gates the escalating reminder schedule once this invoice is sent."
          checked={form.reminders_enabled} onChange={(v) => set('reminders_enabled', v)}
        />
        <OptionToggle
          label="Late fee" hint="Percentage per month, applied once the due date passes."
          checked={form.late_fee_enabled} onChange={(v) => set('late_fee_enabled', v)}
        />
        {form.late_fee_enabled && (
          <FormField label="Late Fee Rate (% per month)" type="number" value={form.late_fee_rate} onChange={(e) => set('late_fee_rate', e.target.value)} />
        )}
        <OptionToggle
          label="Recurring invoice" hint="Generates a new copy on the chosen interval (generation itself is not built yet)."
          checked={form.is_recurring} onChange={(v) => set('is_recurring', v)}
        />
        {form.is_recurring && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FormSelect label="Interval" value={form.recurring_interval_days} onChange={(e) => set('recurring_interval_days', Number(e.target.value))} options={RECURRING_INTERVAL_OPTIONS} />
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.recurring_auto_send} onChange={(e) => set('recurring_auto_send', e.target.checked)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                Auto-send copies
              </label>
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  )
}

function Row({ label, value, bold, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: bold ? '0.95rem' : '0.8rem', fontWeight: bold ? 700 : 400, color: muted ? 'var(--status-red-text)' : 'var(--text-primary)' }}>
      <span style={{ color: bold ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function OptionToggle({ label, hint, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0 }} />
      <div>
        <p style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{label}</p>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', margin: '2px 0 0' }}>{hint}</p>
      </div>
    </label>
  )
}

// ── ClientSearchField — Name doubles as a live, debounced, real-backend
// search (GET /clients/?search=..., the exact endpoint/pattern Clients.jsx
// itself searches with); Email sits alongside as a plain field. Picking a
// result fills every client field on the form directly and links `client`.
// Manually editing Name or Email after a pick detaches the link (`client`
// back to null) — the invoice is now customized for this one send, not a
// mutation of the saved record. Replaces the old client-array-prop-filtering
// ClientCombobox (no real backend search, and coupled to a two-button
// Existing/One-Time mode this pass removed) — see DECISIONS.md.
function ClientSearchField({ form, setForm, errors }) {
  const [query, setQuery] = useState(form.client_name || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef(null)
  const ref = useRef(null)

  // Re-syncs the visible text only when `client` itself changes (a pick or
  // a clear) — not on every keystroke, which would fight the input's own
  // value while the user is actively typing.
  useEffect(() => { setQuery(form.client_name || '') }, [form.client]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleNameChange(value) {
    setQuery(value)
    setOpen(true)
    setForm((f) => ({ ...f, client_name: value, client: null }))
    clearTimeout(searchTimer.current)
    if (!value.trim()) { setResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const { data } = await api.get('/clients/', { params: { search: value.trim(), limit: 8 } })
        setResults(data.results || [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  function selectResult(c) {
    setForm((f) => ({
      ...f, client: c.id, save_as_new_client: false,
      client_name: c.name, client_email: c.email,
      client_company: c.company || '', client_address: c.address || '',
      client_phone: c.phone || '',
      currency: c.default_currency || f.currency,
    }))
    setQuery(c.name)
    setOpen(false)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      <div ref={ref} style={{ position: 'relative' }}>
        <FormField
          label="Client Name" required value={query}
          onChange={(e) => handleNameChange(e.target.value)}
          onFocus={() => setOpen(true)}
          error={errors.client_name}
          hint={form.client ? 'Linked to a saved client — editing detaches it' : undefined}
        />
        {open && query.trim() && (searching || results.length > 0) && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg-surface)', border: '1.5px solid var(--accent)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: 220, overflowY: 'auto', zIndex: 5 }}>
            {searching && <p style={{ margin: 0, padding: '10px 12px', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Searching…</p>}
            {!searching && results.map((c) => (
              <button
                type="button" key={c.id}
                onMouseDown={() => selectResult(c)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-2)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
              >
                <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</p>
                <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{c.email}{c.company ? ` · ${c.company}` : ''}</p>
              </button>
            ))}
          </div>
        )}
      </div>
      <FormField
        label="Client Email" type="email" required
        value={form.client_email}
        onChange={(e) => setForm((f) => ({ ...f, client_email: e.target.value, client: null }))}
        error={errors.client_email}
      />
    </div>
  )
}
