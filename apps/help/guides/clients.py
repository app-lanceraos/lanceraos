# apps/help/guides/clients.py
"""Guides: clients (records, reliability score, statements, the client portal)."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'add-and-manage-clients', 'Add and manage clients', 'clients',
        'Keep a record for each client, then add tags and private notes, flag a client or archive one.',
        ['customer', 'buyer', 'employer', 'contact', 'crm', 'tags', 'notes', 'flag client', 'archive', 'restore', 'search client'],
        [
            p('Open Clients in the sidebar. Press "Add Client" and fill in the client: "Full Name", "Email", "Company", "Phone", "Address", "Country", "Default Currency" and "Payment Terms". The list has a search box for name, email or company, and filters such as "Active", "Flagged", "Archived", "Has Overdue" and "New This Month". You can sort by "Name A → Z", "Recently Added", "Highest Value" or "Most Overdue".'),
            p('Select a client to open their panel. It has tabs for "Invoices", "Analytics", "Notes" and "Requests". In the panel you can press "Edit", add tags, press "Flag" to mark a client with a reason, or "Archive" to hide a client you no longer work with. "Restore" brings an archived client back.'),
            note('Notes are private. Only you can see them, and they are never shown to the client.'),
            link('Open Clients', '/clients'),
        ],
        related=['client-reliability-score', 'client-statement', 'the-client-portal', 'create-an-invoice'],
        ui_labels=['Add Client', 'Full Name', 'Email', 'Company', 'Phone', 'Address', 'Country', 'Default Currency', 'Payment Terms',
                   'Active', 'Flagged', 'Archived', 'Has Overdue', 'New This Month', 'Name A → Z', 'Recently Added', 'Highest Value',
                   'Most Overdue', 'Invoices', 'Analytics', 'Notes', 'Requests', 'Edit', 'Flag', 'Archive', 'Restore'],
        sources=['frontend/src/pages/Clients.jsx', 'frontend/src/components/ClientDetailPanel.jsx'], checked_on=TODAY),
    guide(
        'client-reliability-score', 'The client reliability score', 'clients',
        'A badge that tells you how reliably a client has paid, based on the invoices already settled.',
        ['reliable', 'unreliable', 'mixed', 'score', 'pays late', 'bad debt', 'payment history', 'trust', 'good payer'],
        [
            p('Each client shows a reliability badge: "Reliable", "Mixed", "Unreliable", or "No data yet". You see it in the Clients list and in the client panel, where "Payment Outcome Breakdown" counts the invoices paid on time, paid up to a month late, paid more than a month late, and written off as bad debt.'),
            p('The badge reads only invoices that have ended in a payment or a bad debt. Invoices that are still open, cancelled or refunded do not count. A client with none of those yet shows "No data yet", and the score fills in once an invoice is paid or written off.'),
            p('A single on-time payment reads as "Reliable". A single invoice paid more than a month late, or written off as bad debt, reads as "Unreliable". The "Mixed" badge covers a client who is only mildly late on average.'),
            note('The score is a guide from your own records. It is not a credit check.'),
        ],
        related=['add-and-manage-clients', 'invoice-statuses', 'payment-reminders-and-formal-notice'],
        ui_labels=['Reliable', 'Mixed', 'Unreliable', 'No data yet', 'Payment Outcome Breakdown'],
        sources=['frontend/src/pages/clientHelpers.js', 'frontend/src/components/ClientDetailPanel.jsx', 'apps/clients/scoring.py'],
        checked_on=TODAY),
    guide(
        'client-statement', 'Create a client statement', 'clients',
        'Download a PDF statement of account for one client over the dates you choose.',
        ['statement of account', 'account statement', 'client pdf', 'balance', 'outstanding', 'date range', 'download'],
        [
            p('A statement lists a client\'s invoices for a period with what was invoiced, what was paid and what is still outstanding, plus a running balance and totals.'),
            steps(
                'Open Clients and select the client.',
                'Press "Statement" in the client panel.',
                'In "Generate Statement", choose a "Start Date" and an "End Date". The dates start as the past year up to today.',
                'Press "Download PDF".',
            ),
            note('The start date must be on or before the end date. The statement is made fresh each time you download it.'),
            link('Open Clients', '/clients'),
        ],
        related=['add-and-manage-clients', 'invoice-statuses', 'exchange-rates-and-converted-amounts'],
        ui_labels=['Statement', 'Generate Statement', 'Start Date', 'End Date', 'Download PDF'],
        sources=['frontend/src/components/ClientDetailPanel.jsx', 'apps/invoices/templates/invoices/statement.html'],
        checked_on=TODAY),
    guide(
        'the-client-portal', 'What your client sees in the portal', 'clients',
        'The private page where a client can view invoices, message you, report a payment and ask for a change.',
        ['portal', 'client login', 'client view', 'magic link', 'secure link', 'client messages', 'report payment', 'acknowledge', 'my details'],
        [
            p('A saved client gets a private link to their own portal, and the first invoice you send to them through LanceraOS also emails it. The portal has no password. If the link is lost or the session ends, the client enters their email and gets a fresh link.'),
            p('The portal has four pages. "Overview" shows what needs the client\'s attention and recent invoices. "Invoices" lists every invoice that has been delivered, with buttons to acknowledge an invoice, report a payment and send you a message. "Payments" shows payment history and the payment claims they have made. "My Details" shows what you have on file and lets them request a change.'),
            p('A change request does not change anything by itself. It reaches you as a notification, and you review it in the "Requests" tab of the client panel.'),
            note('A client sees only invoices that were delivered to them. Drafts and finalised-but-unsent invoices are not shown.'),
            link('Open Clients', '/clients'),
        ],
        related=['invoice-messages-and-payment-claims', 'send-an-invoice', 'add-and-manage-clients'],
        ui_labels=['Overview', 'Invoices', 'Payments', 'My Details', 'Requests'],
        sources=['frontend/src/pages/portal/PortalShell.jsx', 'frontend/src/pages/portal/ClientPortal.jsx', 'frontend/src/pages/portal/PortalMyDetails.jsx', 'frontend/src/pages/portal/PortalPayments.jsx'],
        checked_on=TODAY),
)
