# apps/help/guides/reports.py
"""Guides: reports and scores (profit and loss, the income statement, the health score)."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'profit-and-loss', 'Profit and loss', 'reports',
        'See the money you received, the money you spent and what you kept, for any period you choose.',
        ['p&l', 'profit', 'loss', 'net profit', 'income vs expenses', 'margin', 'earnings report', 'month by month', 'pnl'],
        [
            p('Open P&L in the sidebar. Choose a "Period", such as this month, last year, a tax year or custom dates, and choose the currency in "Show amounts in". The page shows "Income received", "Expenses" and "Net profit", then "Month by month", "Income by source" and "Expenses by category".'),
            p('The report counts the money you recorded as received and the money you recorded as spent, on the date of each. Invoices that have not been paid are not income. Amounts in other currencies are converted at the exchange rate saved for the date of each payment or expense.'),
            p('Press "Download PDF" to save the report. If you have recorded no expenses, net profit equals income, and the page says so.'),
            note('The report does not calculate tax. "Marked deductible" is your own note and LanceraOS only adds it up.'),
            link('Open Profit and Loss', '/pnl'),
        ],
        related=['record-a-payment', 'record-an-expense', 'income-statement', 'exchange-rates-and-converted-amounts'],
        ui_labels=['Period', 'Show amounts in', 'Income received', 'Expenses', 'Net profit', 'Month by month', 'Income by source', 'Expenses by category', 'Download PDF', 'Marked deductible'],
        sources=['frontend/src/pages/ProfitAndLoss.jsx', 'frontend/src/pages/reportsHelpers.js', 'frontend/src/components/PnlKpiStrip.jsx'],
        checked_on=TODAY),
    guide(
        'income-statement', 'Your income statement', 'reports',
        'Make a printable statement of the payments you received, to give to a bank, a visa office or PSEB.',
        ['income certificate', 'proof of income', 'bank statement', 'visa', 'loan', 'pseb', 'salary letter', 'income letter', 'cnic on statement'],
        [
            p('Open Income Statement in the sidebar. It builds a statement from the payments you recorded in LanceraOS. You print it, sign it and hand it in. It is your own declaration, and LanceraOS does not check or certify it. The office you give it to may decide not to accept it.'),
            steps(
                'Choose the period.',
                'Under "Set up your statement", choose a "Purpose": general reference, a bank or loan, a visa or PSEB.',
                'Optionally fill in "Addressed to (optional)". If you leave it empty, the statement says To whom it may concern.',
                'Decide whether to tick "Show my CNIC on the statement" and "Show my NTN on the statement". Both start unticked.',
                'Check the preview, then press "Download statement (PDF)".',
            ),
            p('The preview, "What the statement will show", lists the months, the sources and the currencies. The card "Details printed on the statement" shows your name and contact details. To change them, update your Profile or Settings.'),
            note('Your CNIC and NTN must be saved in Settings under "Tax & PSEB" before you can tick them.'),
            link('Open Income Statement', '/income-certificate'),
        ],
        related=['tax-and-pseb-details', 'profit-and-loss', 'record-a-payment'],
        ui_labels=['Set up your statement', 'Purpose', 'Addressed to (optional)', 'Show my CNIC on the statement', 'Show my NTN on the statement',
                   'Download statement (PDF)', 'What the statement will show', 'Details printed on the statement', 'Tax & PSEB'],
        sources=['frontend/src/pages/IncomeStatement.jsx', 'frontend/src/components/StatementOptions.jsx', 'frontend/src/components/StatementIdentityCard.jsx', 'frontend/src/components/StatementPreview.jsx', 'frontend/src/pages/reportsHelpers.js'],
        checked_on=TODAY),
    guide(
        'health-score', 'Your health score', 'reports',
        'A score out of one hundred for how your freelance business looks, worked out from your own records.',
        ['financial health', 'score', 'grade', 'radar', 'where to start', 'improve score', 'income consistency', 'profit margin', 'client diversity', 'growth'],
        [
            p('Open Health Score in the sidebar. The page shows "Your health score" with a grade word, a chart of five areas, a list called "Where to start" and one card for each area. The five areas are income consistency, profit margin, tax compliance, income growth and client diversity.'),
            p('Choose how far back to look with "Months to look at". Only full months are counted, so a half-finished month never drags the score down.'),
            p('"Where to start" lists the steps that would raise your score the most, ranked for you. Each area card explains what was measured and what is needed, and "How this is scored" opens the details.'),
            p('If an area has too little data, it is marked "Not scored". It is drawn at the centre of the chart, which does not mean zero. If too little can be measured at all, the page says "No score yet".'),
            note('The score is worked out by software from the records you keep, not by AI. It is a guide and not advice, and you cannot compare it with another person\'s.'),
            link('Open Health Score', '/health'),
        ],
        related=['your-dashboard', 'record-a-payment', 'record-an-expense', 'tax-and-pseb-details'],
        ui_labels=['Your health score', 'Where to start', 'Months to look at', 'How this is scored', 'Not scored', 'No score yet'],
        sources=['frontend/src/pages/HealthScore.jsx', 'frontend/src/pages/healthHelpers.js', 'apps/health/copy.py'],
        checked_on=TODAY),
)
