// src/components/ExpenseFormModal.jsx
//
// Add an expense (no props), edit one (`expense`) or add a copy of one (`copyFrom`), in a PaymentDialog (Prompt 15).
// A deliberate mirror of PaymentFormModal.
//
// Create sends all seven fields. Edit sends only the fields that changed and Save stays disabled until something has.
// The category is a required, explicit choice with NO default (decision X4): a silent default would file most expenses
// under the wrong category. Under the category select, visible text (never a tooltip) says that income tax has no
// category, and — only while "Platform and payment fees" is chosen — that a fee is a correct expense only when the income
// was recorded BEFORE the fee came off (otherwise it is counted twice).
//
// The server creates the expense FIRST and then reports `possible_duplicates` (same currency, exact amount and category
// within three days), so the duplicate warning is a second step of this same dialog, shown after saving: "Keep both", or
// "Delete the one I just added" — which deletes the NEW expense's id, never the older one's.
import { useEffect, useMemo, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'

import api from '@/lib/api'
import FormField from './FormField'
import FormSelect from './FormSelect'
import FosAlert from './FosAlert'
import { PaymentDialog, PaymentDialogButtons, paymentDialogText } from './PaymentDialog'
import { todayInPlatformTimezone } from '@/pages/invoiceHelpers'
import { formatIsoDate } from '@/pages/dashboardHelpers'
import { CURRENCY_FALLBACK_HINT, currencyChoices, errorMessage, formatExact } from '@/pages/paymentsHelpers'
import {
  CATEGORY_FORM_OPTIONS, CATEGORY_HINT, DEDUCTIBLE_HINT, DEDUCTIBLE_LABEL, FEES_CATEGORY, FEES_WARNING, FLASH, NOT_SURE_SAVED,
  categoryChoices, categoryLabel, changedFields, copiedFromLine, createBody, duplicateSentence, emptyForm, expenseFieldErrors,
  expenseRateNote, formFromCopy, formFromExpense, isGone, validateExpenseForm,
} from '@/pages/expensesHelpers'
import { NETWORK_MESSAGE } from '@/pages/paymentsHelpers'

function initialForm(expense, copyFrom, profileCurrency) {
  if (expense) return formFromExpense(expense)
  if (copyFrom) return formFromCopy(copyFrom, todayInPlatformTimezone())
  return emptyForm(profileCurrency, todayInPlatformTimezone())
}

export default function ExpenseFormModal({
  expense = null, copyFrom = null, profileCurrency = '', currencies, onCreated, onSaved, onChanged, onFinish, onClose,
}) {
  const editing = Boolean(expense)
  const [form, setForm] = useState(() => initialForm(expense, copyFrom, profileCurrency))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('form') // 'form' | 'duplicate'
  const [created, setCreated] = useState(null)
  const [duplicates, setDuplicates] = useState([])

  useEffect(() => { currencies.ensureLoaded() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const currencyOptions = useMemo(
    () => currencyChoices(currencies.codes, expense?.currency).map((code) => ({ value: code, label: code })),
    [currencies.codes, expense?.currency],
  )
  const categoryOptions = editing ? categoryChoices(expense.category) : CATEGORY_FORM_OPTIONS
  const changes = editing ? changedFields(form, expense) : null
  const dirty = editing ? Object.keys(changes).length > 0 : true
  const rateNote = editing ? expenseRateNote(expense.rate_basis) : null

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
    if (errors[field] || errors.general) setErrors((e) => { const next = { ...e }; delete next[field]; delete next.general; return next })
  }

  async function submit(event) {
    event?.preventDefault()
    if (busy || !dirty) return
    const problems = validateExpenseForm(form, todayInPlatformTimezone())
    if (Object.keys(problems).length > 0) { setErrors(problems); return }

    setBusy(true)
    setErrors({})
    try {
      if (editing) {
        const { data } = await api.put(`/expenses/${expense.id}/`, changes)
        onSaved(data)
        return
      }
      const { data } = await api.post('/expenses/', createBody(form))
      onCreated(data.expense)
      if ((data.possible_duplicates || []).length > 0) {
        setCreated(data.expense)
        setDuplicates(data.possible_duplicates)
        setStep('duplicate')
      } else {
        onFinish(FLASH.added)
      }
    } catch (error) {
      const result = expenseFieldErrors(error, editing ? 'Could not save your changes. Please try again.' : 'Could not add this expense. Please try again.')
      // A create that ended with no answer may still have been saved: never a plain "try again".
      if (!editing && !error.response && result.general === NETWORK_MESSAGE) {
        result.general = `${NETWORK_MESSAGE} ${NOT_SURE_SAVED}`
      }
      setErrors(result)
      if (editing && isGone(error)) onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function deleteTheNewOne() {
    setBusy(true)
    setErrors({})
    try {
      await api.delete(`/expenses/${created.id}/`) // the expense just added — never the older one it resembles
      onChanged()
      onFinish(FLASH.duplicateRemoved)
    } catch (error) {
      if (isGone(error)) {
        onChanged()
        onFinish(FLASH.alreadyRemoved)
        return
      }
      setErrors({ general: errorMessage(error, 'Could not remove it. Please try again.') })
    } finally {
      setBusy(false)
    }
  }

  if (step === 'duplicate') {
    return (
      <PaymentDialog title="Possible duplicate" busy={busy} onClose={() => onFinish(FLASH.added)} maxWidth={500}>
        <p style={paymentDialogText}>{duplicateSentence(created)}</p>
        {errors.general && <FosAlert type="error" style={{ marginBottom: 12 }}>{errors.general}</FosAlert>}
        <ul style={{ listStyle: 'none', margin: '0 0 4px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {duplicates.slice(0, 3).map((d) => (
            <li key={d.id} style={{ padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', color: 'var(--text-primary)', minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{formatExact(d.amount, d.currency)} · {formatIsoDate(d.expense_date)}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.74rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {categoryLabel(d.category)}{d.vendor ? ` · ${d.vendor}` : ''}
              </div>
            </li>
          ))}
        </ul>
        <PaymentDialogButtons
          busy={busy} onClose={() => onFinish(FLASH.added)} cancelLabel="Keep both"
          confirm={(
            <button type="button" className="fos-btn fos-btn-danger" onClick={deleteTheNewOne} disabled={busy}>
              {busy ? <span className="fos-spinner" /> : <Trash2 size={14} aria-hidden="true" />} Delete the one I just added
            </button>
          )}
        />
      </PaymentDialog>
    )
  }

  return (
    <PaymentDialog title={editing ? 'Edit expense' : 'Add expense'} busy={busy} onClose={onClose} initialFocus="input:not(:disabled)">
      <form onSubmit={submit} noValidate>
        {errors.general && <FosAlert type="error" style={{ marginBottom: 12 }}>{errors.general}</FosAlert>}
        {/* overflowWrap: the vendor in this line is free text and may be one very long word. */}
        {copyFrom && !editing && <FosAlert type="info" style={{ marginBottom: 12, overflowWrap: 'anywhere' }}>{copiedFromLine(copyFrom)}</FosAlert>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 10 }}>
            <FormField label="Amount" type="number" required value={form.amount} onChange={(e) => update('amount', e.target.value)} error={errors.amount} />
            <div>
              <FormSelect label="Currency" value={form.currency} onChange={(e) => update('currency', e.target.value)} options={currencyOptions} />
              {errors.currency && <p className="fos-error">{errors.currency}</p>}
            </div>
          </div>
          {currencies.failed && <p className="fos-hint" style={{ margin: '-6px 0 0' }}>{CURRENCY_FALLBACK_HINT}</p>}
          <FormField label="Date spent" type="date" required value={form.expense_date} onChange={(e) => update('expense_date', e.target.value)} error={errors.expense_date} />
          <div>
            <FormSelect label="Category" required value={form.category} onChange={(e) => update('category', e.target.value)} options={categoryOptions} />
            {errors.category && <p className="fos-error">{errors.category}</p>}
            {form.category === FEES_CATEGORY && <FosAlert type="warning" style={{ marginTop: 8 }}>{FEES_WARNING}</FosAlert>}
            <p className="fos-hint">{CATEGORY_HINT}</p>
          </div>
          <FormField label="Paid to" value={form.vendor} onChange={(e) => update('vendor', e.target.value)} error={errors.vendor} hint="Who you paid, optional" />
          <FormField label="What it was for" value={form.description} onChange={(e) => update('description', e.target.value)} error={errors.description} placeholder="Optional" />
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              <input
                type="checkbox" checked={form.is_deductible} onChange={(e) => update('is_deductible', e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
              />
              {DEDUCTIBLE_LABEL}
            </label>
            <p className="fos-hint" style={{ marginLeft: 28 }}>{DEDUCTIBLE_HINT}</p>
          </div>
        </div>
        {rateNote && (expense.rate_basis === 'estimated' || expense.rate_basis === 'none') && (
          <FosAlert type={expense.rate_basis === 'none' ? 'warning' : 'info'} style={{ marginTop: 14 }}>{rateNote}</FosAlert>
        )}
        <PaymentDialogButtons
          busy={busy} onClose={onClose}
          confirm={(
            <button type="submit" className="fos-btn fos-btn-accent" disabled={busy || !dirty}>
              {busy ? <span className="fos-spinner" /> : <Check size={14} aria-hidden="true" />} {editing ? 'Save changes' : 'Add expense'}
            </button>
          )}
        />
      </form>
    </PaymentDialog>
  )
}
