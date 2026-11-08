// src/components/PaymentFormModal.jsx
//
// Add a payment (no `payment` prop) or edit one (Prompt 11, Part 3), in a PaymentDialog.
//
// Create sends all five fields. Edit sends only the fields that changed — and only "Received from" / notes when the
// payment is linked to an invoice: the server refuses to change amount, currency, date or source then, so those four
// fields are disabled with a visible sentence saying why and what to do (never a tooltip alone).
//
// The server creates the payment FIRST and then reports `possible_duplicates` (same currency and amount within three
// days), so the duplicate warning is a second step of this same dialog, shown after saving: "Keep both", or "Delete the
// one I just added" — which deletes the NEW payment's id, never the older one's.
import { useEffect, useMemo, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'

import api from '@/lib/api'
import FormField from './FormField'
import FormSelect from './FormSelect'
import FosAlert from './FosAlert'
import { PaymentDialog, PaymentDialogButtons, paymentDialogText } from './PaymentDialog'
import { PAYMENT_SOURCE_OPTIONS, todayInPlatformTimezone } from '@/pages/invoiceHelpers'
import { formatIsoDate } from '@/pages/dashboardHelpers'
import {
  CURRENCY_FALLBACK_HINT, LOCKED_SENTENCE, NETWORK_MESSAGE, currencyChoices, duplicateSentence, errorMessage, fieldErrors,
  isLocked, originPhrase, parseAmountInput, sourceLabel, toCents, validatePaymentForm, formatExact,
} from '@/pages/paymentsHelpers'

function initialForm(payment, profileCurrency) {
  if (payment) {
    return {
      amount: payment.amount, currency: payment.currency, payment_date: payment.payment_date, source: payment.source,
      counterparty: payment.counterparty || '', notes: payment.notes || '',
    }
  }
  return { amount: '', currency: profileCurrency || 'USD', payment_date: todayInPlatformTimezone(), source: 'other', counterparty: '', notes: '' }
}

// Only what differs from the saved payment, in the shape the API takes.
function changedFields(form, payment, locked) {
  const changes = {}
  if (!locked) {
    if (toCents(form.amount) !== toCents(payment.amount)) changes.amount = parseAmountInput(form.amount).value ?? form.amount
    if (form.currency !== payment.currency) changes.currency = form.currency
    if (form.payment_date !== payment.payment_date) changes.payment_date = form.payment_date
    if (form.source !== payment.source) changes.source = form.source
  }
  if (form.counterparty.trim() !== (payment.counterparty || '')) changes.counterparty = form.counterparty.trim()
  if (form.notes.trim() !== (payment.notes || '')) changes.notes = form.notes.trim()
  return changes
}

export default function PaymentFormModal({
  payment = null, profileCurrency = '', currencies, onCreated, onSaved, onChanged, onFinish, onViewPayment, onClose,
}) {
  const editing = Boolean(payment)
  const locked = editing && isLocked(payment)
  const [form, setForm] = useState(() => initialForm(payment, profileCurrency))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('form') // 'form' | 'duplicate'
  const [created, setCreated] = useState(null)
  const [duplicates, setDuplicates] = useState([])

  useEffect(() => { currencies.ensureLoaded() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const currencyOptions = useMemo(
    () => currencyChoices(currencies.codes, payment?.currency).map((code) => ({ value: code, label: code })),
    [currencies.codes, payment?.currency],
  )
  const changes = editing ? changedFields(form, payment, locked) : null
  const dirty = editing ? Object.keys(changes).length > 0 : true

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
    if (errors[field] || errors.general) setErrors((e) => { const next = { ...e }; delete next[field]; delete next.general; return next })
  }

  async function submit(event) {
    event?.preventDefault()
    if (busy || !dirty) return
    let problems = validatePaymentForm(form, todayInPlatformTimezone())
    if (locked) problems = Object.fromEntries(Object.entries(problems).filter(([key]) => key === 'counterparty' || key === 'notes'))
    if (Object.keys(problems).length > 0) { setErrors(problems); return }

    setBusy(true)
    setErrors({})
    try {
      if (editing) {
        const { data } = await api.put(`/payments/${payment.id}/`, changes)
        onSaved(data)
        return
      }
      const body = {
        amount: parseAmountInput(form.amount).value, currency: form.currency, payment_date: form.payment_date,
        source: form.source, counterparty: form.counterparty.trim(), notes: form.notes.trim(),
      }
      const { data } = await api.post('/payments/', body)
      onCreated(data.payment)
      if ((data.possible_duplicates || []).length > 0) {
        setCreated(data.payment)
        setDuplicates(data.possible_duplicates)
        setStep('duplicate')
      } else {
        onFinish('Payment added.')
      }
    } catch (error) {
      const result = fieldErrors(error, editing ? 'Could not save your changes. Please try again.' : 'Could not add this payment. Please try again.')
      // A create that ended with no answer may still have been saved: never a plain "try again".
      if (!editing && !error.response && result.general === NETWORK_MESSAGE) {
        result.general = `${NETWORK_MESSAGE} If you are not sure it was saved, check the list before adding it again.`
      }
      setErrors(result)
    } finally {
      setBusy(false)
    }
  }

  async function deleteTheNewOne() {
    setBusy(true)
    setErrors({})
    try {
      await api.delete(`/payments/${created.id}/`) // the payment just added — never the older one it resembles
      onChanged()
      onFinish('Removed the duplicate.')
    } catch (error) {
      setErrors({ general: errorMessage(error, 'Could not remove it. Please try again.') })
    } finally {
      setBusy(false)
    }
  }

  if (step === 'duplicate') {
    return (
      <PaymentDialog title="Possible duplicate" busy={busy} onClose={() => onFinish('Payment added.')} maxWidth={500}>
        <p style={paymentDialogText}>{duplicateSentence(created)}</p>
        {errors.general && <FosAlert type="error" style={{ marginBottom: 12 }}>{errors.general}</FosAlert>}
        <ul style={{ listStyle: 'none', margin: '0 0 4px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {duplicates.slice(0, 3).map((d) => (
            <li key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ minWidth: 0, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                <div style={{ fontWeight: 600 }}>{formatExact(d.amount, d.currency)} · {formatIsoDate(d.payment_date)}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.74rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {sourceLabel(d.source)}{d.counterparty ? ` · ${d.counterparty}` : ''} · {originPhrase(d.origin)}
                </div>
              </div>
              <button type="button" className="fos-btn fos-btn-ghost" style={{ flexShrink: 0, fontSize: '0.78rem', padding: '5px 10px' }} disabled={busy} onClick={() => onViewPayment(d.id)}>View</button>
            </li>
          ))}
        </ul>
        <PaymentDialogButtons
          busy={busy} onClose={() => onFinish('Payment added.')} cancelLabel="Keep both"
          confirm={(
            <button type="button" className="fos-btn fos-btn-danger" onClick={deleteTheNewOne} disabled={busy}>
              {busy ? <span className="fos-spinner" /> : <Trash2 size={14} />} Delete the one I just added
            </button>
          )}
        />
      </PaymentDialog>
    )
  }

  return (
    <PaymentDialog title={editing ? 'Edit payment' : 'Add payment'} busy={busy} onClose={onClose} initialFocus="input:not(:disabled)">
      <form onSubmit={submit} noValidate>
        {errors.general && <FosAlert type="error" style={{ marginBottom: 12 }}>{errors.general}</FosAlert>}
        {locked && <FosAlert type="info" style={{ marginBottom: 12 }}>{LOCKED_SENTENCE}</FosAlert>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 10 }}>
            <FormField label="Amount" type="number" required value={form.amount} onChange={(e) => update('amount', e.target.value)} error={errors.amount} disabled={locked} />
            <div>
              <FormSelect label="Currency" value={form.currency} onChange={(e) => update('currency', e.target.value)} options={currencyOptions} disabled={locked} />
              {errors.currency && <p className="fos-error">{errors.currency}</p>}
            </div>
          </div>
          {currencies.failed && <p className="fos-hint" style={{ margin: '-6px 0 0' }}>{CURRENCY_FALLBACK_HINT}</p>}
          <FormField label="Date received" type="date" required value={form.payment_date} onChange={(e) => update('payment_date', e.target.value)} error={errors.payment_date} disabled={locked} />
          <div>
            <FormSelect label="Source" value={form.source} onChange={(e) => update('source', e.target.value)} options={PAYMENT_SOURCE_OPTIONS} disabled={locked} />
            {errors.source && <p className="fos-error">{errors.source}</p>}
          </div>
          <FormField label="Received from" value={form.counterparty} onChange={(e) => update('counterparty', e.target.value)} error={errors.counterparty} hint="Who paid you, optional" />
          <FormField label="Notes" value={form.notes} onChange={(e) => update('notes', e.target.value)} error={errors.notes} placeholder="Optional" />
        </div>
        <PaymentDialogButtons
          busy={busy} onClose={onClose}
          confirm={(
            <button type="submit" className="fos-btn fos-btn-accent" disabled={busy || !dirty}>
              {busy ? <span className="fos-spinner" /> : <Check size={14} />} {editing ? 'Save changes' : 'Add payment'}
            </button>
          )}
        />
      </form>
    </PaymentDialog>
  )
}
