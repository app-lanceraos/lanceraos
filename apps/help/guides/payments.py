# apps/help/guides/payments.py
"""Guides: payments (record, link to invoices, import from a file, exchange rates and converted amounts)."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'record-a-payment', 'Record a payment', 'payments',
        'Add money you have received to the Payments page, from Payoneer, Wise, a bank, JazzCash and more.',
        ['income', 'received money', 'payoneer', 'wise', 'jazzcash', 'easypaisa', 'bank transfer', 'add payment', 'earnings', 'ledger', 'upwork', 'fiverr', 'recieve', 'paymnt'],
        [
            p('Open Payments in the sidebar. This page is your list of money received. A payment you mark as paid on an invoice also appears here.'),
            steps(
                'Press "Add payment".',
                'Fill in the "Amount", the "Currency" and the "Date received".',
                'Choose the "Source": Payoneer, Wise, JazzCash, Easypaisa, Bank Transfer, Cash or Other.',
                'If you want, add who paid you in "Received from" and any "Notes".',
                'Save it. If LanceraOS finds a similar payment you already have, it shows "Possible duplicate" so you can check it.',
            ),
            p('The list can be searched and filtered by source, currency and whether a payment is linked to an invoice. Select a payment to see its details, edit it or delete it.'),
            note('Record the amount you actually received. A payment that is linked to an invoice locks its amount, currency, date and source. You can still change who it came from and the notes.'),
            link('Open Payments', '/payments'),
        ],
        related=['link-payments-to-invoices', 'import-payments-from-a-file', 'exchange-rates-and-converted-amounts', 'record-a-payment-on-an-invoice'],
        ui_labels=['Add payment', 'Amount', 'Currency', 'Date received', 'Source', 'Received from', 'Notes', 'Possible duplicate'],
        sources=['frontend/src/pages/Payments.jsx', 'frontend/src/components/PaymentFormModal.jsx', 'frontend/src/pages/paymentsHelpers.js', 'frontend/src/pages/invoiceHelpers.js'],
        checked_on=TODAY),
    guide(
        'link-payments-to-invoices', 'Link a payment to an invoice', 'payments',
        'Match a payment you recorded to the invoice it paid, or split it across several invoices.',
        ['match payment', 'allocate', 'unlink', 'not linked', 'partly linked', 'outstanding balance', 'reconcile', 'attach payment'],
        [
            p('Each payment shows whether it is "Not linked", "Partly linked" or "Linked". Linking tells LanceraOS which invoice the money paid, and the invoice\'s status and balance update by themselves.'),
            steps(
                'Open Payments and select the payment.',
                'Press "Link to invoice".',
                'Search for the invoice by number or client, and pick it. The best fit is marked "Exact match".',
                'Confirm the amount. One payment can be split across several invoices.',
            ),
            p('You can also start from the invoice: in "Add Payment", choose "Use a Payment I Already Recorded".'),
            p('To undo a link, open the payment and press "Unlink" beside the invoice. The payment stays in your list.'),
            note('A payment that was recorded directly on an invoice is removed with "Undo Payment" on that invoice, not with "Unlink".'),
        ],
        related=['record-a-payment', 'record-a-payment-on-an-invoice', 'invoice-statuses'],
        ui_labels=['Not linked', 'Partly linked', 'Linked', 'Link to invoice', 'Exact match', 'Add Payment', 'Use a Payment I Already Recorded', 'Unlink', 'Undo Payment'],
        sources=['frontend/src/components/PaymentDetailPanel.jsx', 'frontend/src/components/PaymentLinkModal.jsx', 'frontend/src/pages/paymentsHelpers.js', 'frontend/src/components/InvoiceDetailPanel.jsx'],
        checked_on=TODAY),
    guide(
        'import-payments-from-a-file', 'Import payments from a file', 'payments',
        'Bring many payments in at once from a Wise, Payoneer or bank statement saved as a CSV file.',
        ['csv', 'upload statement', 'bulk import', 'wise statement', 'payoneer statement', 'spreadsheet', 'import', 'undo import', 'duplicates', 'bank statement'],
        [
            p('On the Payments page, press "Import" and choose a CSV file. You see every row before anything is added, and nothing changes until you confirm.'),
            steps(
                'Choose your file and say where the money arrived, such as Wise or Payoneer. Duplicates are checked within one source.',
                'If LanceraOS cannot tell which column is which, check the columns: the date, the amount, the currency and who paid.',
                'Review every row. A row can be "Ready", "Check", "May already be there", "Already imported", "Not income" or "Can\'t read".',
                'Select the rows to add and press "Import".',
            ),
            p('Only money you received is imported. Currency conversions, top-ups, fees, refunds and money going out show as "Not income" and are never added. Rows already imported are never added twice.'),
            p('"Past imports" lists earlier imports. Press "Undo" to remove one. Payments from it that you have linked to an invoice are kept.'),
            link('Open Payments', '/payments'),
        ],
        related=['record-a-payment', 'link-payments-to-invoices', 'exchange-rates-and-converted-amounts'],
        ui_labels=['Import', 'Ready', 'Check', 'May already be there', 'Already imported', 'Not income', "Can't read", 'Past imports', 'Undo'],
        sources=['frontend/src/components/PaymentImportDialog.jsx', 'frontend/src/components/PaymentImportFileStep.jsx', 'frontend/src/components/PaymentImportReview.jsx', 'frontend/src/pages/paymentImportHelpers.js', 'apps/payments/importing/classify.py'],
        checked_on=TODAY),
    guide(
        'exchange-rates-and-converted-amounts', 'Exchange rates and converted amounts', 'payments',
        'How LanceraOS converts amounts to your currency, and what an estimated rate means.',
        ['pkr', 'rupee', 'usd', 'dollar', 'conversion', 'exchange rate', 'approximate', 'estimated rate', 'daily rate', 'currency'],
        [
            p('LanceraOS saves exchange rates once a day. A payment or an expense keeps the rate from around its own date, so past months do not change when rates move later.'),
            p('If no rate was saved near a date, the closest one available is used and the item is marked as estimated. Totals that include it are approximate, and the page tells you how many items are affected. If no rate exists at all for a currency, that item is left out of converted totals.'),
            p('The Dashboard has an "Exchange rates" card with the latest saved rates for the dollar, euro and pound against the rupee. It shows the date of the daily update and tells you when the rates are out of date.'),
            note('These rates are for your own records. They are not the rate your bank or Payoneer or Wise used on the day.'),
            link('Open the Dashboard', '/dashboard'),
        ],
        related=['record-a-payment', 'record-an-expense', 'your-dashboard', 'profit-and-loss'],
        ui_labels=['Exchange rates'],
        sources=['frontend/src/pages/paymentsHelpers.js', 'frontend/src/components/DashboardRatesCard.jsx', 'apps/payments/rates.py'],
        checked_on=TODAY),
)
