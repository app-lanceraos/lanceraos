// src/components/StatementOptions.jsx
//
// "Set up your statement": period, purpose, who it is addressed to, whether to print the CNIC and NTN (both OFF by default,
// disabled when nothing is saved), and the Download button with, beside it, a one-line summary of what will be downloaded.
// Controlled: IncomeStatement.jsx owns every value. Changing the purpose or the addressed-to text never refetches the
// preview (it only changes the paper, not the figures).
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { FileDown, Info } from 'lucide-react'

import PeriodSelector from './PeriodSelector'
import FormSelect from './FormSelect'
import { ADDRESSED_TO_MAX, PURPOSE_OPTIONS, addressedToCount } from '@/pages/reportsHelpers'

const ID_HINT = 'Only turn this on if the office asks for it. It is printed on the paper you hand over.'
const ID_LOADING = 'Loading your details…'
const ID_FAILED = "We couldn't check whether this is saved. Reload your details below."

export default function StatementOptions({
  period, onPeriodChange, today, purpose, onPurposeChange, addressedTo, onAddressedToChange, addressedProblem,
  includeCnic, includeNtn, onIncludeCnic, onIncludeNtn, profile, profileLoading, profileFailed,
  onDownload, busy, blockReason, summaryLine,
}) {
  const addressedId = useId()
  const addressedNote = `${addressedId}-note`
  const disabled = Boolean(blockReason) || busy

  return (
    <section aria-labelledby="stm-options-title" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', minWidth: 0 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 id="stm-options-title" style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: 'var(--text-primary)' }}>Set up your statement</h2>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <PeriodSelector value={period} onChange={onPeriodChange} today={today} />

        <div style={{ maxWidth: 420, minWidth: 0 }}>
          <FormSelect label="Purpose" value={purpose} onChange={(e) => onPurposeChange(e.target.value)} options={PURPOSE_OPTIONS} />
        </div>

        <div style={{ maxWidth: 420, minWidth: 0 }}>
          <label htmlFor={addressedId} className="fos-label">Addressed to (optional)</label>
          <input
            id={addressedId} type="text" className={`fos-input${addressedProblem ? ' error' : ''}`} value={addressedTo}
            onChange={(e) => onAddressedToChange(e.target.value)} aria-describedby={addressedNote} aria-invalid={addressedProblem ? 'true' : undefined}
            autoComplete="off"
          />
          <div id={addressedNote} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 6, alignItems: 'flex-start' }}>
            {addressedProblem
              ? <p className="fos-error" role="alert" style={{ margin: 0 }}>{addressedProblem}</p>
              : <p className="fos-hint" style={{ margin: 0 }}>Printed as To: followed by this text. If you leave it empty, the statement says To whom it may concern.</p>}
            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{addressedToCount(addressedTo)}/{ADDRESSED_TO_MAX}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <IdBox
            id="stm-cnic" label="Show my CNIC on the statement" noun="CNIC" checked={includeCnic} onChange={onIncludeCnic}
            saved={Boolean(profile?.hasCnic)} loading={profileLoading} failed={profileFailed}
          />
          <IdBox
            id="stm-ntn" label="Show my NTN on the statement" noun="NTN" checked={includeNtn} onChange={onIncludeNtn}
            saved={Boolean(profile?.hasNtn)} loading={profileLoading} failed={profileFailed}
          />
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="fos-btn fos-btn-accent" disabled={disabled} aria-busy={busy ? 'true' : undefined} onClick={onDownload}>
            {busy ? (<><span className="fos-spinner" /> Preparing PDF…</>) : (<><FileDown size={15} aria-hidden="true" /> Download statement (PDF)</>)}
          </button>
          {summaryLine && !blockReason && !busy && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', minWidth: 0, overflowWrap: 'anywhere' }}>{summaryLine}</span>
          )}
        </div>
        {blockReason && !busy && (
          <p role="status" style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            <Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{blockReason}</span>
          </p>
        )}
      </div>
    </section>
  )
}

function IdBox({ id, label, noun, checked, onChange, saved, loading, failed }) {
  const unavailable = loading || failed || !saved
  let hint = ID_HINT
  if (loading) hint = ID_LOADING
  else if (failed) hint = ID_FAILED
  else if (!saved) {
    hint = (
      <>No {noun} saved. Add it in <Link to="/settings?tab=tax" style={{ color: 'var(--accent)', fontWeight: 600 }}>Settings, then Tax &amp; PSEB</Link>.</>
    )
  }
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.86rem', color: unavailable ? 'var(--text-tertiary)' : 'var(--text-primary)', cursor: unavailable ? 'not-allowed' : 'pointer' }}>
        <input
          id={id} type="checkbox" checked={checked && !unavailable} disabled={unavailable} onChange={(e) => onChange(e.target.checked)}
          aria-describedby={`${id}-hint`} style={{ width: 16, height: 16, accentColor: 'var(--accent)', flexShrink: 0 }}
        />
        {label}
      </label>
      <p id={`${id}-hint`} className="fos-hint" style={{ margin: '4px 0 0 26px' }}>{hint}</p>
    </div>
  )
}
