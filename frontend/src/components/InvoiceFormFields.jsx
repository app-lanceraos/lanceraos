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
import { ChevronDown, ChevronUp, Plus, Search, Trash2, X } from 'lucide-react'

import FormField from './FormField'
import FormSelect from './FormSelect'
import { CURRENCY_OPTIONS, formatMoney, RECURRING_INTERVAL_OPTIONS } from '@/pages/invoiceHelpers'

const BLANK_ITEM = { description: '', quantity: '1', unit_price: '' }

export function blankInvoiceForm() {
  return {
    clientMode: 'onetime',
    client: null,
    client_name: '', client_email: '', client_company: '', client_address: '', client_phone: '',
    is_one_time_client: true,
    currency: 'USD',
    tax_rate: '0', discount_amount: '0',
    due_date: '',
    notes: '', terms: '',
    reminders_enabled: true,
    late_fee_enabled: false, late_fee_rate: '2.00',
    is_recurring: false, recurring_interval_days: 30, recurring_auto_send: false,
    items: [{ ...BLANK_ITEM }],
  }
}

export function invoiceToForm(invoice) {
  return {
    clientMode: invoice.client ? 'existing' : 'onetime',
    client: invoice.client || null,
    client_name: invoice.client_name || '', client_email: invoice.client_email || '',
    client_company: invoice.client_company || '', client_address: invoice.client_address || '',
    client_phone: invoice.client_phone || '',
    is_one_time_client: invoice.is_one_time_client ?? !invoice.client,
    currency: invoice.currency || 'USD',
    tax_rate: String(invoice.tax_rate ?? '0'), discount_amount: String(invoice.discount_amount ?? '0'),
    due_date: invoice.due_date || '',
    notes: invoice.notes || '', terms: invoice.terms || '',
    reminders_enabled: invoice.reminders_enabled ?? true,
    late_fee_enabled: invoice.late_fee_enabled ?? false, late_fee_rate: String(invoice.late_fee_rate ?? '2.00'),
    is_recurring: invoice.is_recurring ?? false,
    recurring_interval_days: invoice.recurring_interval_days || 30,
    recurring_auto_send: invoice.recurring_auto_send ?? false,
    items: invoice.items?.length > 0
      ? invoice.items.map((it) => ({ description: it.description, quantity: String(it.quantity), unit_price: String(it.unit_price) }))
      : [{ ...BLANK_ITEM }],
  }
}

export function formToPayload(form) {
  return {
    client: form.clientMode === 'existing' ? form.client : null,
    client_name: form.client_name, client_email: form.client_email,
    client_company: form.client_company, client_address: form.client_address, client_phone: form.client_phone,
    currency: form.currency,
    tax_rate: parseFloat(form.tax_rate) || 0,
    discount_amount: parseFloat(form.discount_amount) || 0,
    due_date: form.due_date || null,
    notes: form.notes, terms: form.terms,
    reminders_enabled: form.reminders_enabled,
    late_fee_enabled: form.late_fee_enabled,
    late_fee_rate: parseFloat(form.late_fee_rate) || 0,
    is_recurring: form.is_recurring,
    recurring_interval_days: form.is_recurring ? Number(form.recurring_interval_days) : null,
    recurring_auto_send: form.recurring_auto_send,
    is_one_time_client: form.clientMode === 'onetime',
    items: form.items
      .filter((it) => it.description.trim())
      .map((it, i) => ({
        description: it.description,
        quantity: parseFloat(it.quantity) || 1,
        unit_price: parseFloat(it.unit_price) || 0,
        sort_order: i + 1,
      })),
  }
}

export function computeTotals(form) {
  const subtotal = form.items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0)
  const tax = subtotal * (parseFloat(form.tax_rate) || 0) / 100
  const discount = parseFloat(form.discount_amount) || 0
  const total = Math.max(0, subtotal + tax - discount)
  return { subtotal, tax, discount, total }
}

export default function InvoiceFormFields({ form, setForm, errors = {}, clients = [] }) {
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  function selectExistingClient(client) {
    setForm((f) => ({
      ...f,
      clientMode: 'existing',
      client: client.id,
      client_name: client.name, client_email: client.email,
      client_company: client.company || '', client_address: client.address || '',
      client_phone: client.phone || '',
      currency: client.default_currency || f.currency,
    }))
  }

  function clearClient() {
    setForm((f) => ({
      ...f, clientMode: 'onetime', client: null,
      client_name: '', client_email: '', client_company: '', client_address: '', client_phone: '',
    }))
  }

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
      {/* ── Client ── */}
      <div>
        <p className="fos-label" style={{ marginBottom: 8 }}>Client</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, clientMode: 'existing' }))}
            className="fos-btn"
            style={{
              flex: 1, padding: '7px 12px', fontSize: '0.78rem',
              background: form.clientMode === 'existing' ? 'var(--accent-glow)' : 'var(--bg-surface-2)',
              color: form.clientMode === 'existing' ? 'var(--accent)' : 'var(--text-secondary)',
              border: `1.5px solid ${form.clientMode === 'existing' ? 'var(--accent)' : 'var(--border-subtle)'}`,
              fontWeight: form.clientMode === 'existing' ? 700 : 500,
            }}
          >
            Existing Client
          </button>
          <button
            type="button"
            onClick={clearClient}
            className="fos-btn"
            style={{
              flex: 1, padding: '7px 12px', fontSize: '0.78rem',
              background: form.clientMode === 'onetime' ? 'var(--accent-glow)' : 'var(--bg-surface-2)',
              color: form.clientMode === 'onetime' ? 'var(--accent)' : 'var(--text-secondary)',
              border: `1.5px solid ${form.clientMode === 'onetime' ? 'var(--accent)' : 'var(--border-subtle)'}`,
              fontWeight: form.clientMode === 'onetime' ? 700 : 500,
            }}
          >
            One-Time Client
          </button>
        </div>

        {form.clientMode === 'existing' && (
          <ClientCombobox
            clients={clients}
            selectedName={form.client_name}
            onSelect={selectExistingClient}
            onClear={clearClient}
          />
        )}

        {(form.clientMode === 'onetime' || form.client_name) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: form.clientMode === 'existing' ? 10 : 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <FormField
                label="Client Name" required disabled={form.clientMode === 'existing'}
                value={form.client_name} onChange={(e) => set('client_name', e.target.value)} error={errors.client_name}
              />
              <FormField
                label="Client Email" type="email" required disabled={form.clientMode === 'existing'}
                value={form.client_email} onChange={(e) => set('client_email', e.target.value)} error={errors.client_email}
              />
            </div>
            {form.clientMode === 'onetime' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <FormField label="Company" value={form.client_company} onChange={(e) => set('client_company', e.target.value)} />
                <FormField label="Phone" value={form.client_phone} onChange={(e) => set('client_phone', e.target.value)} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Financials ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <FormSelect label="Currency" value={form.currency} onChange={(e) => set('currency', e.target.value)} options={CURRENCY_OPTIONS} />
        <FormField label="Due Date" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
        <FormField label="Tax Rate (%)" type="number" value={form.tax_rate} onChange={(e) => set('tax_rate', e.target.value)} />
        <FormField label={`Discount (${form.currency})`} type="number" value={form.discount_amount} onChange={(e) => set('discount_amount', e.target.value)} />
      </div>

      {/* ── Line items ── */}
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

      {/* ── Totals preview — client-side display only; the server's own
          recalculate_totals() is authoritative on save ── */}
      <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Row label="Subtotal" value={formatMoney(totals.subtotal, form.currency)} />
        {totals.tax > 0 && <Row label={`Tax (${form.tax_rate}%)`} value={formatMoney(totals.tax, form.currency)} />}
        {totals.discount > 0 && <Row label="Discount" value={`−${formatMoney(totals.discount, form.currency)}`} muted />}
        <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 4, paddingTop: 6 }}>
          <Row label="Total" value={formatMoney(totals.total, form.currency)} bold />
        </div>
      </div>

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

// ── ClientCombobox — search-as-you-type over already-fetched active clients ──
function ClientCombobox({ clients, selectedName, onSelect, onClear }) {
  const [query, setQuery] = useState(selectedName || '')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => { setQuery(selectedName || '') }, [selectedName])
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const results = query.trim()
    ? clients.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase())
        || c.email.toLowerCase().includes(query.toLowerCase())
        || (c.company || '').toLowerCase().includes(query.toLowerCase()))
    : clients

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
        <input
          className="fos-input" style={{ paddingLeft: 32 }}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search your clients…"
        />
        {selectedName && (
          <button type="button" onClick={() => { setQuery(''); onClear(); setOpen(false) }} aria-label="Clear client" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}>
            <X size={14} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg-surface)', border: '1.5px solid var(--accent)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: 220, overflowY: 'auto', zIndex: 5 }}>
          {results.map((c) => (
            <button
              type="button" key={c.id}
              onMouseDown={() => { onSelect(c); setOpen(false) }}
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
      {open && query.trim() && results.length === 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '10px 12px', zIndex: 5 }}>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>No matching clients. Switch to "One-Time Client" to type details directly.</p>
        </div>
      )}
    </div>
  )
}
