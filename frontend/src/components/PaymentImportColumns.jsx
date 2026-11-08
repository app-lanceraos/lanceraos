// src/components/PaymentImportColumns.jsx
//
// Step 2: which column of the file is what. Shown only when the server could not tell (needs_mapping), or when the person
// asks for it from Review. The form starts from the server's partial mapping and is kept while the person edits; its
// result is NEVER committed directly — "Check these columns" sends it through one more preview first.
//
// Field errors (mirroring the server's rules) show under the field and the first one takes focus on a failed submit; a
// server-side refusal shows above the buttons.
import { useEffect, useRef, useState } from 'react'

import FosAlert from './FosAlert'
import { CURRENCY_FALLBACK_HINT } from '@/pages/paymentsHelpers'
import {
  AMOUNT_MODE_OPTIONS, DATE_FORMAT_OPTIONS, DECIMAL_OPTIONS, columnsPreview, mappingToDraft, reasonSentence,
} from '@/pages/paymentImportHelpers'
import { td, th, tableStyle, tableWrapperStyle, theadRowStyle } from './listTableStyles'

const REQUIRED_PLACEHOLDER = 'Choose a column'
const OPTIONAL_NONE = 'Not in this file'

function Field({ id, label, error, ambiguous, children }) {
  return (
    <div>
      <label htmlFor={id} className="fos-label">{label}</label>
      {children}
      {ambiguous && <p className="fos-hint">More than one column fits here.</p>}
      {error && <p className="fos-error">{error}</p>}
    </div>
  )
}

function ColumnSelect({ id, field, value, onChange, headers, placeholder, error }) {
  const stale = value && !headers.includes(value)
  return (
    <select
      id={id} data-field={field} data-error={error ? 'true' : undefined} aria-invalid={error ? 'true' : undefined}
      value={value} onChange={(e) => onChange(e.target.value)} className={`fos-input fos-select${error ? ' error' : ''}`}
    >
      <option value="">{placeholder}</option>
      {stale && <option value={value}>{value}</option>}
      {headers.map((header) => <option key={header} value={header}>{header}</option>)}
    </select>
  )
}

function SimpleSelect({ id, value, onChange, options }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="fos-input fos-select">
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

export default function PaymentImportColumns({ state, actions, currencies }) {
  const { plan, busy, error, columnErrors } = state
  const checking = busy === 'check'
  const headers = plan.headers || []
  const [draft, setDraft] = useState(() => mappingToDraft(plan.mapping, 'USD'))
  const formRef = useRef(null)
  const preview = columnsPreview(plan)
  const ambiguous = new Set(plan.ambiguous_roles || [])

  const set = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }))
  const errorOf = (key) => columnErrors?.[key]

  // A failed submit focuses the first field with a problem.
  useEffect(() => {
    if (!columnErrors || Object.keys(columnErrors).length === 0) return
    formRef.current?.querySelector('[data-error="true"]')?.focus()
  }, [columnErrors])

  function submit(event) {
    event.preventDefault()
    if (!busy) actions.applyMapping(draft)
  }

  const separate = draft.amountMode === 'separate'
  const fixedCodes = currencies.codes.includes(draft.fixedCurrency) || !draft.fixedCurrency ? currencies.codes : [...currencies.codes, draft.fixedCurrency]

  return (
    <form ref={formRef} onSubmit={submit} noValidate>
      {(plan.reasons || []).length > 0 && (
        <FosAlert type="info" style={{ marginBottom: 14 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {plan.reasons.map((code) => <span key={code}>{reasonSentence(code)}</span>)}
          </span>
        </FosAlert>
      )}

      {preview && (
        <div style={{ marginBottom: 16 }}>
          <div style={tableWrapperStyle}>
            <table style={tableStyle(preview.kind === 'raw' ? Math.max(420, headers.length * 120) : 420)}>
              <caption style={{ captionSide: 'top', textAlign: 'left', padding: '10px 12px 0', fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
                {preview.kind === 'raw' ? 'The first rows of your file' : 'How I read the first rows'}
              </caption>
              <thead>
                <tr style={theadRowStyle}>
                  {(preview.kind === 'raw' ? preview.headers : ['Date', 'Amount', 'Currency', 'Received from']).map((name, i) => (
                    <th key={`${name}-${i}`} style={th}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.kind === 'raw'
                  ? preview.rows.map((cells, r) => (
                    <tr key={r}>{cells.map((cell, c) => <td key={c} style={{ ...td, fontSize: '0.8rem', overflowWrap: 'anywhere' }}>{cell}</td>)}</tr>
                  ))
                  : preview.rows.map((row, r) => (
                    <tr key={r}>
                      <td style={td}>{row.date}</td><td style={td}>{row.amount}</td><td style={td}>{row.currency}</td><td style={td}>{row.counterparty}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="pay-import-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
        <Field id="pi-date" label="Date column" error={errorOf('date')} ambiguous={ambiguous.has('date')}>
          <ColumnSelect id="pi-date" field="date" value={draft.date} onChange={set('date')} headers={headers} placeholder={REQUIRED_PLACEHOLDER} error={errorOf('date')} />
        </Field>
        <Field id="pi-date-format" label="How is the date written?">
          <SimpleSelect id="pi-date-format" value={draft.dateFormat} onChange={set('dateFormat')} options={DATE_FORMAT_OPTIONS} />
        </Field>

        <Field id="pi-amount-mode" label="How are amounts laid out?">
          <SimpleSelect id="pi-amount-mode" value={draft.amountMode} onChange={set('amountMode')} options={AMOUNT_MODE_OPTIONS} />
        </Field>
        <Field id="pi-decimal" label="Number style">
          <SimpleSelect id="pi-decimal" value={draft.decimalSeparator} onChange={set('decimalSeparator')} options={DECIMAL_OPTIONS} />
        </Field>

        {separate ? (
          <>
            <Field id="pi-credit" label="Money in column" error={errorOf('credit')} ambiguous={ambiguous.has('credit')}>
              <ColumnSelect id="pi-credit" field="credit" value={draft.credit} onChange={set('credit')} headers={headers} placeholder={REQUIRED_PLACEHOLDER} error={errorOf('credit')} />
            </Field>
            <Field id="pi-debit" label="Money out column (optional)" error={errorOf('debit')} ambiguous={ambiguous.has('debit')}>
              <ColumnSelect id="pi-debit" field="debit" value={draft.debit} onChange={set('debit')} headers={headers} placeholder={OPTIONAL_NONE} error={errorOf('debit')} />
            </Field>
          </>
        ) : (
          <Field id="pi-amount" label="Amount column" error={errorOf('amount')} ambiguous={ambiguous.has('amount')}>
            <ColumnSelect id="pi-amount" field="amount" value={draft.amount} onChange={set('amount')} headers={headers} placeholder={REQUIRED_PLACEHOLDER} error={errorOf('amount')} />
          </Field>
        )}

        <fieldset style={{ border: 'none', margin: 0, padding: 0, minWidth: 0, gridColumn: '1 / -1' }}>
          <legend className="fos-label" style={{ padding: 0 }}>Currency</legend>
          <div role="radiogroup" aria-label="Currency" style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0 10px' }}>
            {[['column', 'Each row has a currency column'], ['fixed', 'All rows use one currency']].map(([value, label]) => (
              <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input type="radio" name="pi-currency-mode" value={value} checked={draft.currencyMode === value} onChange={() => set('currencyMode')(value)} />
                {label}
              </label>
            ))}
          </div>
          {draft.currencyMode === 'column' ? (
            <Field id="pi-currency" label="Currency column" error={errorOf('currency')} ambiguous={ambiguous.has('currency')}>
              <ColumnSelect id="pi-currency" field="currency" value={draft.currency} onChange={set('currency')} headers={headers} placeholder={REQUIRED_PLACEHOLDER} error={errorOf('currency')} />
            </Field>
          ) : (
            <Field id="pi-fixed" label="Currency for every row" error={errorOf('fixedCurrency')}>
              <select
                id="pi-fixed" data-field="fixedCurrency" data-error={errorOf('fixedCurrency') ? 'true' : undefined} value={draft.fixedCurrency}
                onChange={(e) => set('fixedCurrency')(e.target.value)} className={`fos-input fos-select${errorOf('fixedCurrency') ? ' error' : ''}`}
              >
                <option value="">Choose a currency</option>
                {fixedCodes.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
              {currencies.failed && <p className="fos-hint">{CURRENCY_FALLBACK_HINT}</p>}
            </Field>
          )}
        </fieldset>

        {[
          ['counterparty', 'pi-counterparty', 'Received from column (optional)'],
          ['description', 'pi-description', 'Description column (optional)'],
          ['notes', 'pi-notes', 'Notes column (optional)'],
          ['externalId', 'pi-external', 'Transaction ID column (optional)'],
          ['status', 'pi-status', 'Status column (optional)'],
        ].map(([key, id, label]) => (
          <Field key={key} id={id} label={label} error={errorOf(key)} ambiguous={ambiguous.has(key === 'externalId' ? 'external_id' : key)}>
            <ColumnSelect id={id} field={key} value={draft[key]} onChange={set(key)} headers={headers} placeholder={OPTIONAL_NONE} error={errorOf(key)} />
          </Field>
        ))}

        <details style={{ gridColumn: '1 / -1', fontSize: '0.84rem' }} open={Boolean(draft.headerRow) || Boolean(errorOf('headerRow'))}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-primary)' }}>My file has lines above the column names</summary>
          <div style={{ marginTop: 10, maxWidth: 260 }}>
            <Field id="pi-header-row" label="Line number of the column names" error={errorOf('headerRow')}>
              <input
                id="pi-header-row" type="text" inputMode="numeric" data-field="headerRow" data-error={errorOf('headerRow') ? 'true' : undefined}
                className={`fos-input${errorOf('headerRow') ? ' error' : ''}`} value={draft.headerRow} onChange={(e) => set('headerRow')(e.target.value)}
              />
            </Field>
          </div>
        </details>
      </div>

      {error && <FosAlert type="error" style={{ marginTop: 16 }}>{error}</FosAlert>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
        <button type="button" className="fos-btn fos-btn-ghost" onClick={actions.back} disabled={Boolean(busy)}>Back</button>
        <button type="submit" className="fos-btn fos-btn-accent" disabled={Boolean(busy)}>
          {checking ? <span className="fos-spinner" /> : null} {checking ? 'Checking…' : 'Check these columns'}
        </button>
      </div>
    </form>
  )
}
