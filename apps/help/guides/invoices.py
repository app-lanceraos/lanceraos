# apps/help/guides/invoices.py
"""Guides: invoices (create, statuses, send, reminders, payments on an invoice, recurring, templates, messages, analytics)."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'create-an-invoice', 'Create an invoice', 'invoices',
        'Build an invoice in three stages: the client and dates, the line items, and the options.',
        ['new invoice', 'make invoice', 'bill', 'billing', 'line items', 'draft', 'tax rate', 'discount', 'due date', 'finalise', 'preset', 'first invoice'],
        [
            p('Open Invoices in the sidebar and press "New Invoice". The form has three stages: "Client & Dates", "Line Items" and "Options". Your work is saved as a draft while you go, and the page shows "Draft saved".'),
            steps(
                'In "Client & Dates", search for your client, or type a new one and tick "Save this as a new client". Choose an "Issue Date" and a "Due Date". The due date must come after the issue date.',
                'In "Line Items", press "Add Line Item" and fill in the description, quantity and unit price. Choose the "Currency" and, if they apply, a "Tax Rate (%)" and a "Discount". The subtotal and total update as you type.',
                'In "Options", add "Notes for Client" and "Payment Terms". You can also switch on a late fee or make the invoice recurring.',
                'Press "Preview PDF" to see it, then "Finalise" when it is right.',
            ),
            note('Finalising gives the invoice its number and freezes its PDF. A draft has no number yet and you can still change it. After that you can no longer edit the invoice.'),
            note('"Start from Preset" on the Invoices page fills a new invoice from one you saved earlier.'),
            link('Open Invoices', '/invoices'),
        ],
        related=['send-an-invoice', 'invoice-statuses', 'recurring-invoices', 'duplicate-and-delete-invoices'],
        ui_labels=['New Invoice', 'Client & Dates', 'Line Items', 'Options', 'Draft saved', 'Save this as a new client', 'Issue Date', 'Due Date',
                   'Add Line Item', 'Currency', 'Tax Rate (%)', 'Discount', 'Notes for Client', 'Payment Terms', 'Preview PDF', 'Finalise',
                   'Start from Preset'],
        sources=['frontend/src/components/NewInvoiceWizard.jsx', 'frontend/src/components/InvoiceFormFields.jsx', 'frontend/src/pages/Invoices.jsx'],
        checked_on=TODAY),
    guide(
        'invoice-statuses', 'What each invoice status means', 'invoices',
        'Every status an invoice can show, what moves it forward, and why Overdue is a warning and not a status.',
        ['draft', 'finalised', 'viewed', 'partially paid', 'paid', 'cancelled', 'refunded', 'bad debt', 'overdue', 'badge', 'filter by status'],
        [
            p('"Draft" means you are still working on it. "Finalised" means it has a number and a fixed PDF but has not been sent. "Sent" means it has gone to the client, and "Viewed" means the client opened it. "Partially Paid" and "Paid" follow as you record payments.'),
            p('Three statuses end the story of an invoice. "Cancelled" is for an invoice you no longer want. "Refunded" is for money you gave back. "Bad Debt" is for money you do not expect to receive. Payments no longer change an invoice in these states.'),
            p('"Overdue" is a red badge shown on top of a status when the due date has passed and the invoice is not settled. It is not a status of its own, so the real status underneath stays visible. You can filter the Invoices list by status, or by "Overdue".'),
            note('A view only counts when the client opens the invoice. When you open your own invoice link while signed in, it does not turn the invoice into Viewed.'),
        ],
        related=['create-an-invoice', 'send-an-invoice', 'record-a-payment-on-an-invoice', 'client-reliability-score'],
        ui_labels=['Draft', 'Finalised', 'Sent', 'Viewed', 'Partially Paid', 'Paid', 'Cancelled', 'Refunded', 'Bad Debt', 'Overdue'],
        sources=['frontend/src/pages/invoiceHelpers.js', 'frontend/src/components/InvoiceDetailPanel.jsx'], checked_on=TODAY),
    guide(
        'send-an-invoice', 'Send an invoice', 'invoices',
        'Email a finalised invoice to your client from LanceraOS, or record that you sent it yourself.',
        ['email invoice', 'deliver', 'mark as sent', 'whatsapp', 'resend', 'invoice link', 'copy link', 'client email', 'pdf attached'],
        [
            p('Open a finalised invoice from the Invoices list. Press "Send" and confirm in the "Send Invoice" box. LanceraOS emails your client with the invoice PDF attached. The email goes from your own address if you set up "Custom Email" in Settings, otherwise from the LanceraOS address. You are copied on it.'),
            p('You can do both steps at once: on the last stage of the invoice form, "Finalise & Send" finalises the invoice and emails it in one go.'),
            p('If you sent the invoice yourself, for example by WhatsApp, press "Mark as Sent". That only records that you sent it. Nothing is emailed.'),
            p('"Copy Invoice Link" in the More menu copies the page your client opens. "Resend Invoice" in the same menu sends it again.'),
            note('The invoice PDF is fixed when you finalise. Changing your profile or business details afterwards does not change an invoice that is already finalised.'),
            link('Open Invoices', '/invoices'),
        ],
        related=['payment-reminders-and-formal-notice', 'send-emails-from-your-own-address', 'the-client-portal', 'invoice-statuses'],
        ui_labels=['Send', 'Send Invoice', 'Finalise & Send', 'Mark as Sent', 'Copy Invoice Link', 'Resend Invoice', 'Custom Email'],
        sources=['frontend/src/components/InvoiceDetailPanel.jsx', 'frontend/src/components/NewInvoiceWizard.jsx'], checked_on=TODAY),
    guide(
        'payment-reminders-and-formal-notice', 'Payment reminders and formal notice', 'invoices',
        'Switch automatic reminders on, send a reminder yourself, and send a formal notice for a severely overdue invoice.',
        ['reminder', 'overdue', 'late payment', 'chase client', 'escalation', 'formal notice', 'dunning', 'follow up', 'unpaid invoice'],
        [
            p('When reminders are on, LanceraOS emails the client as an unpaid invoice stays overdue, with firmer wording each time. They go out for invoices you sent through LanceraOS. If an invoice shows "Reminders are off", press "Turn on" to start them.'),
            p('On an overdue invoice you can also press "Send Reminder" yourself, which sends the next reminder in the schedule straight away.'),
            p('When an invoice is severely overdue and has gone through the full reminder schedule, a banner says so. You can press "Dismiss" to hide it, or "Send Formal Notice" to send a firmer, manual email. "Formal Notice" is also in the More menu.'),
            note('A formal notice is never sent automatically. You can switch the action off in Settings under "Business" with the box "Allow sending Formal Notice emails". The box turns the button off and does not change the invoice.'),
        ],
        related=['send-an-invoice', 'business-details-and-payment-methods', 'invoice-statuses', 'notification-settings'],
        ui_labels=['Reminders are off', 'Turn on', 'Send Reminder', 'Dismiss', 'Send Formal Notice', 'Formal Notice', 'Business', 'Allow sending Formal Notice emails'],
        sources=['frontend/src/components/InvoiceDetailPanel.jsx', 'apps/invoices/tasks.py'], checked_on=TODAY),
    guide(
        'record-a-payment-on-an-invoice', 'Record a payment on an invoice', 'invoices',
        'Mark an invoice paid in full, add a part payment, undo the last payment or record a refund.',
        ['partial payment', 'half paid', 'mark paid', 'paid in full', 'undo payment', 'refund', 'balance', 'outstanding', 'client paid'],
        [
            p('Open the invoice and press "Add Payment". The box offers three ways. "Mark Fully Paid" fills in the whole outstanding balance. "Add a Partial Amount" lets you type an amount, a source, a date and notes. "Use a Payment I Already Recorded" links a payment you already put on the Payments page.'),
            p('The invoice moves to "Partially Paid" or "Paid" by itself as payments add up to the total. The payment date cannot be before the invoice\'s issue date or later than today.'),
            p('From the More menu, "Undo Payment" removes the most recent payment, and "Refund" records money you gave back on an invoice that was paid or part paid.'),
            note('A client can also report a payment from their portal. Those reports wait in the "Claims" tab for you to confirm or reject.'),
        ],
        related=['invoice-messages-and-payment-claims', 'link-payments-to-invoices', 'record-a-payment', 'invoice-statuses'],
        ui_labels=['Add Payment', 'Mark Fully Paid', 'Add a Partial Amount', 'Use a Payment I Already Recorded', 'Partially Paid', 'Paid', 'Undo Payment', 'Refund', 'Claims'],
        sources=['frontend/src/components/InvoiceDetailPanel.jsx', 'frontend/src/pages/invoiceHelpers.js'], checked_on=TODAY),
    guide(
        'recurring-invoices', 'Recurring invoices', 'invoices',
        'Make an invoice repeat on a schedule, send each copy automatically or review it first, and pause the series.',
        ['repeat invoice', 'monthly invoice', 'retainer', 'weekly', 'quarterly', 'annual', 'auto send', 'schedule', 'series', 'automatic', 'automatically'],
        [
            p('In the "Options" stage of a new invoice, switch on "Recurring invoice" and choose an "Interval": "Weekly", "Bi-weekly", "Monthly", "Quarterly" or "Annually". A scheduled task creates the next invoice for you once a day when it is due.'),
            p('On the invoice, a line shows "Recurring" with the next date. Press "Pause" to stop new copies and "Resume" to continue. "Edit Series" changes how often it repeats and whether copies are sent automatically.'),
            p('With automatic sending off, each new copy is left as a draft for you to review first. With it on, each copy is finalised and sent.'),
            note('If creating a copy keeps failing, the series pauses and you are told. Invoices coming up in the next days are listed on the Dashboard under "Upcoming recurring invoices".'),
        ],
        related=['create-an-invoice', 'send-an-invoice', 'your-dashboard', 'notification-settings'],
        ui_labels=['Options', 'Recurring invoice', 'Interval', 'Weekly', 'Bi-weekly', 'Monthly', 'Quarterly', 'Annually', 'Recurring', 'Pause', 'Resume', 'Edit Series', 'Upcoming recurring invoices'],
        sources=['frontend/src/components/InvoiceFormFields.jsx', 'frontend/src/components/InvoiceDetailPanel.jsx', 'frontend/src/pages/invoiceHelpers.js', 'apps/invoices/tasks.py'],
        checked_on=TODAY),
    guide(
        'invoice-templates-and-design', 'Invoice templates and design', 'invoices',
        'Pick the look of your invoices from the Template Gallery and choose whether the LanceraOS footer line shows.',
        ['template', 'gallery', 'layout', 'theme', 'design', 'logo', 'branding', 'generated by', 'footer', 'colour'],
        [
            p('Open the "Template Gallery" from the Invoices page. Each card shows a ready-made invoice layout. Press "Use this template" on one and it becomes the template for your new invoices. The active one is marked "Active", and a line at the top names it.'),
            p('A switch above the templates controls whether "Generated by LanceraOS" appears in the invoice footer. It shows On or Off.'),
            note('A template is a fixed layout you pick, not a design tool. Changing your choice later affects new invoices only, and a finalised invoice keeps the look and details it was finalised with.'),
            link('Open the Template Gallery', '/invoices/templates'),
        ],
        related=['create-an-invoice', 'send-an-invoice', 'first-steps'],
        ui_labels=['Template Gallery', 'Use this template', 'Active', 'Generated by LanceraOS'],
        sources=['frontend/src/pages/TemplateGallery.jsx', 'frontend/src/pages/Invoices.jsx'], checked_on=TODAY),
    guide(
        'invoice-messages-and-payment-claims', 'Messages and payment claims', 'invoices',
        'Talk to a client about an invoice, and confirm or reject a payment they say they made.',
        ['comments', 'chat', 'client message', 'thread', 'claims', 'confirm payment', 'reject payment', 'reported payment', 'portal'],
        [
            p('An invoice has a "Comments" tab. It is a conversation between you and your client about that invoice. The client writes from their portal and you reply here. Messages cannot be edited or deleted.'),
            p('The "Claims" tab lists payments your client says they made. Each claim is "Pending", "Confirmed" or "Rejected". Press "Confirm" to record the payment on the invoice, in the same way as adding one yourself. Press "Reject" and give a "Reason", which the client can read.'),
            note('Whether you are notified about a new message or claim depends on your switches in Settings under "Notifications".'),
        ],
        related=['the-client-portal', 'record-a-payment-on-an-invoice', 'notification-settings'],
        ui_labels=['Comments', 'Claims', 'Pending', 'Confirmed', 'Rejected', 'Confirm', 'Reject', 'Reason', 'Notifications'],
        sources=['frontend/src/components/InvoiceDetailPanel.jsx', 'frontend/src/components/CommentThread.jsx'], checked_on=TODAY),
    guide(
        'invoice-analytics', 'Invoice analytics', 'invoices',
        'See how much you invoiced and collected, which clients bring the most, and totals by currency.',
        ['analytics', 'charts', 'revenue', 'top clients', 'collected', 'trend', 'kpi', 'outstanding', 'insights', 'reports'],
        [
            p('Open Invoices and press "Analytics". The page shows "Invoiced vs Collected" over time, "Top Clients" and a "Currency Breakdown". Use "Back to Invoices" to return.'),
            p('The cards at the top of the Invoices list show "Outstanding", "Collected" and "Overdue". Outstanding is money on invoices that are sent, viewed or part paid. Collected is money received in the chosen period. A selector lets you change the period and the currency.'),
            link('Open Invoice analytics', '/invoices/analytics'),
        ],
        related=['your-dashboard', 'profit-and-loss', 'invoice-statuses'],
        ui_labels=['Analytics', 'Invoiced vs Collected', 'Top Clients', 'Currency Breakdown', 'Back to Invoices', 'Outstanding', 'Collected', 'Overdue'],
        sources=['frontend/src/pages/InvoiceAnalytics.jsx', 'frontend/src/components/InvoiceKPIStrip.jsx', 'frontend/src/pages/Invoices.jsx'], checked_on=TODAY),
    guide(
        'duplicate-and-delete-invoices', 'Duplicate, save as preset and delete', 'invoices',
        'Copy an invoice, save one as a preset to reuse, and delete drafts you no longer need.',
        ['copy invoice', 'clone', 'template', 'preset', 'remove invoice', 'bulk delete', 'cancel invoice', 'reuse'],
        [
            p('In an invoice\'s More menu, "Duplicate" makes a new draft copy and "Save as Preset" keeps the invoice\'s details so you can start from it later. On the Invoices page, "Start from Preset" lists your presets.'),
            p('"Delete" appears only for invoices that are still a draft or finalised. To delete several at once, tick their boxes in the list and use "Delete" in the bar that appears. A box shows only on invoices that can be deleted.'),
            note('An invoice that has been sent cannot be deleted. If you no longer want it, use "Cancel" from the More menu so the record stays.'),
        ],
        related=['create-an-invoice', 'invoice-statuses', 'recurring-invoices'],
        ui_labels=['Duplicate', 'Save as Preset', 'Start from Preset', 'Delete', 'Cancel'],
        sources=['frontend/src/components/InvoiceDetailPanel.jsx', 'frontend/src/pages/Invoices.jsx', 'frontend/src/pages/invoiceHelpers.js'], checked_on=TODAY),
)
