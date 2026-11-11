# apps/help/guides/tax.py
"""Guides: the Tax page, the tax calculator and the tax summary PDF. They explain the screens and never state a rate or a rule."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'the-tax-page', 'The Tax page', 'tax',
        'An estimate of the tax your bank took on money from abroad, built from the payments you recorded.',
        ['fbr', 'ntn', 'pseb', 'tax estimate', 'withholding', 'bank deducted', 'tax year', 'export income', 'return', 'accountant'],
        [
            p('Open Tax in the sidebar. The page has three views in a row at the top: "Estimate", "Calculator" and "How this works". Pick a tax year with the "Tax year" buttons.'),
            p('The "Estimate" view is built from the payments you recorded in a currency other than PKR in that tax year. It shows the money received, the rate used, the estimated tax the banks took, a table "Month by month", the currencies received, the return date and a short checklist. The card "Rate used in this estimate" says why that rate was chosen. Your saved PSEB number sets the rate; the self-declared box alone does not.'),
            p('"What to do next" gives the checklist, and "What this estimate does not cover" lists what is left out. "How this works" shows each fact behind the numbers, how sure the page is about it and its sources.'),
            note('These figures are estimates built from the payments you recorded in LanceraOS. Your bank\'s own records show the tax it actually took. The page is not a tax return, a tax certificate or tax advice, so ask a tax advisor about your own situation.'),
            link('Open Tax', '/tax'),
        ],
        related=['the-tax-calculator', 'the-tax-summary-pdf', 'tax-and-pseb-details', 'record-a-payment'],
        ui_labels=['Estimate', 'Calculator', 'How this works', 'Tax year', 'Month by month', 'Rate used in this estimate', 'What to do next', 'What this estimate does not cover'],
        sources=['frontend/src/pages/Tax.jsx', 'frontend/src/pages/taxHelpers.js', 'frontend/src/components/TaxEstimate.jsx'],
        checked_on=TODAY),
    guide(
        'the-tax-calculator', 'The tax calculator', 'tax',
        'Type a taxable income and see the tax at the normal rates, band by band, as an estimate.',
        ['calculate tax', 'slab', 'income tax calculator', 'taxable income', 'bands', 'how much tax', 'normal rates', 'salaried'],
        [
            p('On the Tax page, open the "Calculator" view. It shows the tax at the normal rates for non-salaried individuals for the tax year you picked. It is an estimate.'),
            steps(
                'Open Tax and choose "Calculator".',
                'Pick the tax year.',
                'Type your income in "Taxable income (PKR)". Use digits only. Commas are fine.',
                'Press "Calculate tax". The result opens under "How it adds up", band by band.',
            ),
            note('This is not the tax your bank takes on money from abroad. That estimate is on the "Estimate" view. Nothing you type here is saved.'),
            link('Open the calculator', '/tax?view=calculator'),
        ],
        related=['the-tax-page', 'the-tax-summary-pdf', 'tax-and-pseb-details'],
        ui_labels=['Calculator', 'Estimate', 'Taxable income (PKR)', 'Calculate tax', 'How it adds up'],
        sources=['frontend/src/pages/Tax.jsx', 'frontend/src/pages/taxHelpers.js', 'frontend/src/components/TaxCalculator.jsx'],
        checked_on=TODAY),
    guide(
        'the-tax-summary-pdf', 'The tax summary document', 'tax',
        'Download a one-page PDF of your tax estimate to give to your accountant.',
        ['accountant', 'download', 'pdf', 'ntn on summary', 'tax summary', 'share estimate', 'print'],
        [
            p('On the Estimate view of the Tax page, the card "Tax summary for your accountant" lets you download a one-page PDF of the estimate for the tax year you picked.'),
            steps(
                'Open Tax and pick the tax year.',
                'Decide whether to tick "Show my NTN on the summary". It starts unticked. Only turn it on if the person you give it to asks for it, because it is then printed.',
                'Press "Download tax summary (PDF)".',
            ),
            note('The NTN box is available only once an NTN is saved in Settings under "Tax & PSEB". If you have no payments in that tax year, there is nothing to put in the summary.'),
            link('Open Tax', '/tax'),
        ],
        related=['the-tax-page', 'tax-and-pseb-details', 'income-statement'],
        ui_labels=['Tax summary for your accountant', 'Show my NTN on the summary', 'Download tax summary (PDF)', 'Tax & PSEB'],
        sources=['frontend/src/components/TaxDownloadCard.jsx', 'frontend/src/pages/taxHelpers.js'],
        checked_on=TODAY),
)
