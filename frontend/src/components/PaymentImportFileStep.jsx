// src/components/PaymentImportFileStep.jsx
//
// Step 1: where the money arrived and which file. A plain native file input (no drag and drop, no styling tricks); the
// source is REQUIRED here so the person always knows where the file came from (duplicates are only matched within one
// source). The button is the only thing that spends one of the 20 checks an hour.
import { useEffect, useRef } from 'react'
import { FileText } from 'lucide-react'

import FormSelect from './FormSelect'
import FosAlert from './FosAlert'
import { paymentDialogText } from './PaymentDialog'
import { PAYMENT_SOURCE_OPTIONS } from '@/pages/invoiceHelpers'
import { formatFileSize, validateFile } from '@/pages/paymentImportHelpers'

const SOURCE_OPTIONS = [{ value: '', label: 'Choose where…' }, ...PAYMENT_SOURCE_OPTIONS]

export default function PaymentImportFileStep({ state, actions }) {
  const { file, source, busy, error, fileProblem } = state
  const checking = busy === 'check'
  const canSubmit = Boolean(file && source) && !busy
  const inputRef = useRef(null)
  const changeRef = useRef(null)
  const checkRef = useRef(null)
  const hadFile = useRef(Boolean(file))

  // Choosing a file unmounts the file input (it is replaced by the file's name), which would drop keyboard focus to
  // <body>. Move it to the next useful control instead; clearing the file puts it back on the input.
  useEffect(() => {
    if (file && !hadFile.current) {
      const target = checkRef.current && !checkRef.current.disabled ? checkRef.current : changeRef.current
      target?.focus()
    } else if (!file && hadFile.current) {
      inputRef.current?.focus()
    }
    hadFile.current = Boolean(file)
  }, [file])

  function submit(event) {
    event.preventDefault()
    if (canSubmit) actions.check()
  }

  function onPick(event) {
    const picked = event.target.files?.[0] || null
    actions.chooseFile(picked)
    // A refused file must not stay in the native input: picking the same file again would not fire a change.
    if (picked && !validateFile(picked).ok) event.target.value = ''
  }

  return (
    <div>
      <p style={paymentDialogText}>
        Upload a CSV statement from Wise, Payoneer or your bank, or a spreadsheet saved as CSV. You will see every row before anything is added.
      </p>
      <form onSubmit={submit} noValidate>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <FormSelect label="Where did this money arrive?" required value={source} onChange={(e) => actions.setSource(e.target.value)} options={SOURCE_OPTIONS} />
            <p className="fos-hint">Duplicates are checked within one source, so choose where this file came from.</p>
          </div>

          <div>
            {file ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                <FileText size={18} aria-hidden="true" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{file.name}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{formatFileSize(file.size)}</div>
                </div>
                <button ref={changeRef} type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={() => actions.chooseFile(null)} disabled={Boolean(busy)}>
                  Choose a different file
                </button>
              </div>
            ) : (
              <input ref={inputRef} type="file" className="fos-input" accept=".csv,.txt,text/csv,text/plain" aria-label="CSV file" onChange={onPick} />
            )}
            {fileProblem && <p role="alert" className="fos-error">{fileProblem}</p>}
          </div>

          <details style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-primary)' }}>Where do I get this file?</summary>
            <p style={{ margin: '8px 0 0', lineHeight: 1.6 }}>
              In your Wise or Payoneer account, look for Statements or Export and download the CSV version. From a spreadsheet, choose Save as, then CSV. Files up to 2 MB and 2,000 rows work; split bigger statements by year.
            </p>
          </details>
        </div>

        {error && <FosAlert type="error" style={{ marginTop: 14 }}>{error}</FosAlert>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button ref={checkRef} type="submit" className="fos-btn fos-btn-accent" disabled={!canSubmit}>
            {checking ? <span className="fos-spinner" /> : null} {checking ? 'Checking…' : 'Check the file'}
          </button>
        </div>
      </form>
    </div>
  )
}
