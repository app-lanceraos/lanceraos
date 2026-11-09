// src/pages/IncomeStatement.jsx
//
// The Income Statement page (/income-certificate, Prompt 17): the person picks a period, a purpose and optionally who it is
// addressed to, sees exactly what will be printed, and downloads the PDF. It is the person's OWN declaration built from the
// payments they recorded; LanceraOS does not certify it (the intro says so). Every figure comes from the server
// (GET /payments/income-certificate/); the page never adds or converts money. Changing the purpose, the addressed-to text or
// a CNIC/NTN box changes the paper, not the figures, so none of them refetches the preview.
//
// The CNIC and NTN digits never reach this page: useStatementProfile keeps only two booleans (saved or not). The boxes are
// OFF by default and disabled when nothing is saved.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'

import useTitle from '@/hooks/useTitle'
import useTimedMessage from '@/hooks/useTimedMessage'
import useReportData from '@/hooks/useReportData'
import useReportDownload from '@/hooks/useReportDownload'
import useStatementProfile from '@/hooks/useStatementProfile'
import FosAlert from '@/components/FosAlert'
import StatementIdentityCard from '@/components/StatementIdentityCard'
import StatementOptions from '@/components/StatementOptions'
import StatementPreview from '@/components/StatementPreview'
import { todayInPlatformTimezone } from './invoiceHelpers'
import {
  DEFAULT_PURPOSE, STATEMENT_FLASH, STATEMENT_INTRO, addressedToProblem, fallbackFilename, initialPeriod, namesMissingIdNumber,
  pdfPath, periodProblem, previewPath, statementBlockReason, statementParams, statementPdfParams, statementState, statementSummaryLine,
} from './reportsHelpers'

export default function IncomeStatement() {
  useTitle('LanceraOS | Income Statement')

  const [today] = useState(() => todayInPlatformTimezone())
  const [period, setPeriod] = useState(() => initialPeriod('last_12_months', today))
  const [purpose, setPurpose] = useState(DEFAULT_PURPOSE)
  const [addressedTo, setAddressedTo] = useState('')
  const [includeCnic, setIncludeCnic] = useState(false)
  const [includeNtn, setIncludeNtn] = useState(false)
  const flash = useTimedMessage()

  const problem = periodProblem(period.start, period.end, today)
  const preview = useReportData({ path: previewPath('statement'), params: statementParams(period), enabled: !problem })
  const identity = useStatementProfile()
  const pdf = useReportDownload()
  const { data } = preview

  // A number removed in another tab while its box is ticked: the box is unticked, the PDF would be refused anyway.
  useEffect(() => {
    if (!identity.profile) return
    if (includeCnic && !identity.profile.hasCnic) setIncludeCnic(false)
    if (includeNtn && !identity.profile.hasNtn) setIncludeNtn(false)
  }, [identity.profile, includeCnic, includeNtn])

  const addressedProblem = addressedToProblem(addressedTo)
  const state = data ? statementState(data) : null
  const reason = statementBlockReason({
    problem, loading: preview.loading, loadFailed: Boolean(preview.error), state, addressedProblem, busy: pdf.busy,
  })

  async function handleDownload() {
    if (reason !== null || pdf.busy) return
    const result = await pdf.download({
      path: pdfPath('statement'),
      params: statementPdfParams({ start: period.start, end: period.end, purpose, addressedTo, includeCnic, includeNtn }),
      fallbackName: fallbackFilename('statement', period.start, period.end),
    })
    if (result.ok) flash.show('success', STATEMENT_FLASH)
    else if (namesMissingIdNumber(result.message)) identity.reload()
  }

  return (
    <>
      {flash.message && <FosAlert type={flash.message.type} onDismiss={flash.clear} style={{ marginBottom: 14 }}>{flash.message.text}</FosAlert>}
      {pdf.error && <FosAlert type="error" onDismiss={pdf.clearError} style={{ marginBottom: 14 }}>{pdf.error}</FosAlert>}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', marginBottom: 16, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        <Info size={16} aria-hidden="true" style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', minWidth: 0 }}>{STATEMENT_INTRO}</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <StatementOptions
          period={period} onPeriodChange={setPeriod} today={today}
          purpose={purpose} onPurposeChange={setPurpose}
          addressedTo={addressedTo} onAddressedToChange={setAddressedTo} addressedProblem={addressedProblem}
          includeCnic={includeCnic} includeNtn={includeNtn} onIncludeCnic={setIncludeCnic} onIncludeNtn={setIncludeNtn}
          profile={identity.profile} profileLoading={identity.loading} profileFailed={identity.failed}
          onDownload={handleDownload} busy={pdf.busy} blockReason={reason}
          summaryLine={state === 'ready' && data ? statementSummaryLine(data) : ''}
        />

        {!problem && <StatementPreview data={data} loading={preview.loading} error={preview.error} onReload={preview.reload} />}

        <StatementIdentityCard
          profile={identity.profile} loading={identity.loading} failed={identity.failed} onReload={identity.reload}
          includeCnic={includeCnic} includeNtn={includeNtn}
        />
      </div>

      <p style={{ margin: '16px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        Want to see what you kept after expenses?{' '}
        <Link to="/pnl" style={{ color: 'var(--accent)', fontWeight: 600 }}>Profit and Loss</Link>
      </p>
    </>
  )
}
