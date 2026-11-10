// src/components/TaxCalculator.jsx
//
// The Calculator view: type a taxable income, press Calculate (or Enter), see the tax at the normal rates for non-salaried
// individuals. An explicit form, never live-as-you-type: one request per press. The browser checks the input first with the
// same rules as the server (parseIncomeInput), so the server's own sentences only appear for the one case the browser cannot
// know (the 2026 surcharge refusal) and are shown verbatim. `resetKey` is the selected tax year: changing it clears the result
// (a result for another year would mislead); typing a new income does not (the result names the income it was calculated for).
// This is a separate tool from the Estimate, and the page says so.
import { useEffect, useId, useState } from 'react'
import { Calculator } from 'lucide-react'
import { Link } from 'react-router-dom'

import DashboardCard from './DashboardCard'
import FosAlert from './FosAlert'
import TaxCalculatorResult from './TaxCalculatorResult'
import useTaxCalculator from '@/hooks/useTaxCalculator'
import {
  CALC_BUSY, CALC_BUTTON, CALC_HINT, CALC_INTRO_1, CALC_INTRO_2_LEAD, CALC_INTRO_2_LINK, CALC_INTRO_2_TAIL, CALC_LABEL, CALC_PLACEHOLDER,
  CALC_SUBTITLE, CALC_TITLE, parseIncomeInput,
} from '@/pages/taxHelpers'

export default function TaxCalculator({ taxYear, resetKey }) {
  const [raw, setRaw] = useState('')
  const [inputError, setInputError] = useState('')
  const { result, error, busy, calculate, clear } = useTaxCalculator()
  const inputId = useId()
  const noteId = `${inputId}-note`

  useEffect(() => { clear() }, [resetKey, clear])

  function handleSubmit(event) {
    event.preventDefault()
    if (busy) return
    const parsed = parseIncomeInput(raw)
    if (!parsed.ok) {
      setInputError(parsed.error)
      return
    }
    setInputError('')
    calculate(parsed.value, taxYear)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DashboardCard id="tax-calculator" title={CALC_TITLE} subtitle={CALC_SUBTITLE}>
        <p style={{ margin: '0 0 6px', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>{CALC_INTRO_1}</p>
        <p style={{ margin: '0 0 16px', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
          {CALC_INTRO_2_LEAD}<Link to="/tax" style={{ color: 'var(--accent)', fontWeight: 600 }}>{CALC_INTRO_2_LINK}</Link>{CALC_INTRO_2_TAIL}
        </p>
        <form onSubmit={handleSubmit} noValidate>
          <div style={{ maxWidth: 420, minWidth: 0 }}>
            <label htmlFor={inputId} className="fos-label">{CALC_LABEL}</label>
            <input
              id={inputId} type="text" inputMode="decimal" autoComplete="off" className={`fos-input${inputError ? ' error' : ''}`}
              value={raw} placeholder={CALC_PLACEHOLDER} aria-describedby={noteId} aria-invalid={inputError ? 'true' : undefined}
              onChange={(e) => { setRaw(e.target.value); setInputError('') }}
            />
            <div id={noteId} style={{ marginTop: 6 }}>
              {inputError
                ? <p className="fos-error" role="alert" style={{ margin: 0 }}>{inputError}</p>
                : <p className="fos-hint" style={{ margin: 0 }}>{CALC_HINT}</p>}
            </div>
          </div>
          <button type="submit" className="fos-btn fos-btn-accent" disabled={busy} aria-busy={busy ? 'true' : undefined} style={{ marginTop: 14 }}>
            {busy ? (<><span className="fos-spinner" /> {CALC_BUSY}</>) : (<><Calculator size={15} aria-hidden="true" /> {CALC_BUTTON}</>)}
          </button>
        </form>
        {error && <FosAlert type="error" style={{ marginTop: 14 }}>{error}</FosAlert>}
      </DashboardCard>

      <div aria-live="polite">
        {result && <TaxCalculatorResult result={result} />}
      </div>
    </div>
  )
}
