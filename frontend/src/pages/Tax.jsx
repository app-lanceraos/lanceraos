// src/pages/Tax.jsx
//
// The Tax page (/tax, Prompt 21): one page, three views chosen with a row of real links and ?view= — Estimate (default),
// Calculator, How this works. Every sentence about tax and every number is the SERVER's (GET /tax/overview/, GET /tax/law/,
// POST /tax/calculator/); the page only formats and arranges them and never states a rate, band, date or rule of its own.
//
// All three views are mounted from the first render and the inactive ones carry the `hidden` attribute, so a number typed in the
// calculator and a loaded estimate survive switching views and nothing is requested twice. PITFALL: a wrapper with an inline
// `display` style overrides `hidden`, so the three wrappers below carry NO display style.
//
// The tax year is page state shared by the Estimate and the Calculator. It starts null: the first overview request has NO
// tax_year, the server chooses the current tax year and the page learns it from the response (adopting it never causes a second
// request, because request parameters come ONLY from selectedYear). The year pills come from GET /tax/law/; if the law fails the
// Estimate and the Calculator still work (one year, no pills). A reload goes back to the current tax year.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import useReportData from '@/hooks/useReportData'
import useTitle from '@/hooks/useTitle'
import TaxCalculator from '@/components/TaxCalculator'
import TaxEstimate from '@/components/TaxEstimate'
import TaxSources from '@/components/TaxSources'
import TaxViewNav from '@/components/TaxViewNav'
import TaxYearPicker from '@/components/TaxYearPicker'
import {
  TAX_LOAD_FALLBACK, activeYear, calculatorYear, lawIsUsable, lawLoadError, overviewIsUsable, overviewParams, taxLoadError,
  viewFromParam, yearOptions, LAW_LOAD_FALLBACK,
} from './taxHelpers'

export default function Tax() {
  useTitle('LanceraOS | Tax')
  const [searchParams] = useSearchParams()
  const view = viewFromParam(searchParams.get('view'))
  const [selectedYear, setSelectedYear] = useState(null)

  const overview = useReportData({ path: '/tax/overview/', params: overviewParams(selectedYear), errorMessage: taxLoadError })
  const law = useReportData({ path: '/tax/law/', params: {}, errorMessage: lawLoadError })

  const data = overviewIsUsable(overview.data) ? overview.data : null
  const overviewFailure = overview.error || (overview.data && !data ? TAX_LOAD_FALLBACK : '')
  const lawData = lawIsUsable(law.data) ? law.data : null
  const lawFailure = law.error || (law.data && !lawData ? LAW_LOAD_FALLBACK : '')

  return (
    <div aria-busy={overview.loading}>
      <TaxViewNav active={view} />

      {view !== 'sources' && (
        <TaxYearPicker years={yearOptions(lawData)} value={activeYear(selectedYear, data)} onChange={setSelectedYear} />
      )}

      <div hidden={view !== 'estimate'}>
        <TaxEstimate data={data} loading={overview.loading} error={overviewFailure} onReload={overview.reload} />
      </div>
      <div hidden={view !== 'calculator'}>
        <TaxCalculator taxYear={calculatorYear(selectedYear, data)} resetKey={selectedYear} />
      </div>
      <div hidden={view !== 'sources'}>
        <TaxSources law={lawData} loading={law.loading} error={lawFailure} onReload={law.reload} />
      </div>
    </div>
  )
}
