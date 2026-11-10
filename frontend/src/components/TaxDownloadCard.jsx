// src/components/TaxDownloadCard.jsx
//
// "Tax summary for your accountant": the one-page PDF of the estimate. The NTN is printed only when the box is ticked AND one
// is saved (the box is OFF by default and disabled otherwise, exactly the IdBox pattern of the Income Statement page). The
// button is never silently disabled: a visible reason sits under it. The PDF is a BLOB request (useReportDownload), so a
// refused download shows the server's sentence instead of a raw JSON page. If the server says no NTN is saved, the page is told
// to reload the overview so the box state is right again.
import { useEffect, useState } from 'react'
import { FileDown, Info } from 'lucide-react'
import { Link } from 'react-router-dom'

import DashboardCard from './DashboardCard'
import FosAlert from './FosAlert'
import useReportDownload from '@/hooks/useReportDownload'
import useTimedMessage from '@/hooks/useTimedMessage'
import { namesMissingIdNumber } from '@/pages/reportsHelpers'
import {
  DOWNLOAD_BUSY, DOWNLOAD_BUTTON, DOWNLOAD_FLASH, DOWNLOAD_SUBTITLE, DOWNLOAD_TITLE, NTN_HINT, NTN_LABEL, NTN_LOADING_HINT,
  ntnBoxState, summaryBlockReason, summaryFilename, summaryParams,
} from '@/pages/taxHelpers'

export default function TaxDownloadCard({ data, loading, loadFailed, onNtnMissing }) {
  const [includeNtn, setIncludeNtn] = useState(false)
  const pdf = useReportDownload()
  const flash = useTimedMessage()

  const state = ntnBoxState({ loading: loading && !data, hasNtn: Boolean(data?.has_ntn) })
  const unavailable = state !== 'ready'
  const hasNtn = Boolean(data?.has_ntn)

  // The box unticks itself when the NTN is no longer saved (it is never left ticked on a disabled control).
  useEffect(() => {
    if (!hasNtn) setIncludeNtn(false)
  }, [hasNtn])

  const reason = summaryBlockReason({ loading, loadFailed, data, busy: pdf.busy })
  const blocked = reason !== null

  async function handleDownload() {
    if (blocked || pdf.busy || !data) return
    const result = await pdf.download({
      path: '/tax/summary/pdf/', params: summaryParams(data, includeNtn && hasNtn), fallbackName: summaryFilename(data),
    })
    if (result.ok) flash.show('success', DOWNLOAD_FLASH)
    else if (namesMissingIdNumber(result.message)) onNtnMissing?.()
  }

  let hint = NTN_HINT
  if (state === 'loading') hint = NTN_LOADING_HINT
  else if (state === 'unavailable') {
    hint = (
      <>No NTN saved. Add it in <Link to="/settings?tab=tax" style={{ color: 'var(--accent)', fontWeight: 600 }}>Settings, then Tax &amp; PSEB</Link>.</>
    )
  }

  return (
    <DashboardCard id="tax-summary" title={DOWNLOAD_TITLE} subtitle={DOWNLOAD_SUBTITLE}>
      {flash.message && <FosAlert type={flash.message.type} onDismiss={flash.clear} style={{ marginBottom: 12 }}>{flash.message.text}</FosAlert>}
      {pdf.error && <FosAlert type="error" onDismiss={pdf.clearError} style={{ marginBottom: 12 }}>{pdf.error}</FosAlert>}

      <div style={{ marginBottom: 14, minWidth: 0 }}>
        <label
          htmlFor="tax-ntn"
          style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.86rem', color: unavailable ? 'var(--text-tertiary)' : 'var(--text-primary)', cursor: unavailable ? 'not-allowed' : 'pointer' }}
        >
          <input
            id="tax-ntn" type="checkbox" checked={includeNtn && !unavailable} disabled={unavailable} onChange={(e) => setIncludeNtn(e.target.checked)}
            aria-describedby="tax-ntn-hint" style={{ width: 16, height: 16, accentColor: 'var(--accent)', flexShrink: 0 }}
          />
          {NTN_LABEL}
        </label>
        <p id="tax-ntn-hint" className="fos-hint" style={{ margin: '4px 0 0 26px' }}>{hint}</p>
      </div>

      <button type="button" className="fos-btn fos-btn-accent" disabled={blocked || pdf.busy} aria-busy={pdf.busy ? 'true' : undefined} onClick={handleDownload}>
        {pdf.busy ? (<><span className="fos-spinner" /> {DOWNLOAD_BUSY}</>) : (<><FileDown size={15} aria-hidden="true" /> {DOWNLOAD_BUTTON}</>)}
      </button>
      {blocked && !pdf.busy && (
        <p role="status" style={{ margin: '10px 0 0', display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          <Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{reason}</span>
        </p>
      )}
    </DashboardCard>
  )
}
