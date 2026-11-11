# apps/help/guides/settings.py
"""Guides: Settings (business details, tax and PSEB details, notifications, email sending)."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'business-details-and-payment-methods', 'Business details and payment methods', 'settings',
        'Set your address, invoicing defaults and the ways clients can pay you.',
        ['business address', 'bank details', 'jazzcash', 'easypaisa', 'payoneer', 'default currency', 'payment terms', 'invoice defaults', 'formal notice switch'],
        [
            p('Open Settings and choose "Business". It has three cards. "Business Address" holds your address lines, city and country. "Invoicing Defaults" holds your default currency, default payment terms, language and the timezone used to display times. "Payment Methods" holds your bank name and account number, your JazzCash and Easypaisa numbers and your Payoneer email.'),
            p('The page says that payment methods are how clients can pay you, and where LanceraOS shows these on invoices. Fill in only the ones you use.'),
            p('In "Invoicing Defaults" there is also a box called "Allow sending Formal Notice emails". It controls whether the firmer, manual email for severely overdue invoices is available. Turning it off hides the action button.'),
            note('Your business name and logo are on the Profile page, not here.'),
            link('Open Business settings', '/settings?tab=business'),
        ],
        related=['tax-and-pseb-details', 'payment-reminders-and-formal-notice', 'create-an-invoice'],
        ui_labels=['Business', 'Business Address', 'Invoicing Defaults', 'Payment Methods', 'Allow sending Formal Notice emails'],
        sources=['frontend/src/pages/settings/BusinessSection.jsx'], checked_on=TODAY),
    guide(
        'tax-and-pseb-details', 'Tax and PSEB details', 'settings',
        'Save your CNIC, NTN and PSEB registration number, and see where each one is used.',
        ['cnic', 'ntn', 'pseb', 'national tax number', 'registration number', 'tax profile', 'identity', 'fbr number'],
        [
            p('Open Settings and choose "Tax & PSEB". The "Tax Identity" card has fields for your CNIC, your "NTN (National Tax Number)", a box "I am registered with PSEB" and, when that box is ticked, your PSEB registration number. These details are kept in encrypted form.'),
            p('The page explains how they are used. Your saved PSEB number sets the rate in your tax estimate. The self-declared PSEB box alone does not. CNIC and NTN are printed only on documents where you tick them, such as the Income Statement and the tax summary.'),
            note('LanceraOS does not check these numbers with any government office. It only stores what you type.'),
            link('Open Tax & PSEB settings', '/settings?tab=tax'),
        ],
        related=['the-tax-page', 'income-statement', 'the-tax-summary-pdf'],
        ui_labels=['Tax & PSEB', 'Tax Identity', 'NTN (National Tax Number)', 'I am registered with PSEB'],
        sources=['frontend/src/pages/settings/TaxSection.jsx', 'frontend/src/pages/taxHelpers.js'], checked_on=TODAY),
    guide(
        'notification-settings', 'Notification settings', 'settings',
        'Choose which kinds of events you are told about, and know which alerts always stay on.',
        ['email notifications', 'stop emails', 'unsubscribe', 'mute', 'alerts', 'security alerts', 'switches', 'toggle'],
        [
            p('Open Settings and choose "Notifications". The "Email Notifications" card has three switches. "Invoice Events" covers recurring invoice activity, client acknowledgments, overdue escalations and stale-draft reminders. "Client Messages" covers a client messaging you in the portal, accepting or declining a proposal, and signing or declining a contract. "Payments" covers a client reporting a payment for you to review.'),
            p('A switch decides whether you hear about that kind of event, in the bell and by email. "Security Alerts" is marked "Always On": it covers new device sign-ins, password changes and account lockouts, and it cannot be switched off.'),
            link('Open Notifications settings', '/settings?tab=notifications'),
        ],
        related=['notifications', 'payment-reminders-and-formal-notice', 'invoice-messages-and-payment-claims'],
        ui_labels=['Notifications', 'Email Notifications', 'Invoice Events', 'Client Messages', 'Payments', 'Security Alerts', 'Always On'],
        sources=['frontend/src/pages/settings/NotificationsSection.jsx', 'apps/invoices/notifications.py'], checked_on=TODAY),
    guide(
        'send-emails-from-your-own-address', 'Send emails from your own address', 'settings',
        'Connect your own mailbox so emails to your clients come from your address.',
        ['smtp', 'gmail', 'outlook', 'yahoo', 'custom email', 'app password', 'sender', 'noreply', 'email sending', 'from address'],
        [
            p('By default, emails to your clients are sent from the LanceraOS address. In Settings, "Custom Email" lets you send client-facing emails, such as invoices and receipts, from your own address instead.'),
            steps(
                'Open Settings and choose "Custom Email".',
                'Pick your provider: Gmail, Outlook, Yahoo or Custom SMTP.',
                'Enter the name clients should see, your email address and your password. Gmail needs an app password made in your Google account.',
                'For Custom SMTP, also enter the host and port.',
                'Press "Test & Save". LanceraOS tests the connection and sends a test email to your own address.',
            ),
            note('Sign-in codes, password resets and security alerts always come from LanceraOS, never from your address.'),
            note('If your own mail server fails when an email is sent, LanceraOS sends it from its own address instead and tells you. Check your settings if that happens. Press "Disable" to go back to the default.'),
            link('Open Custom Email settings', '/settings?tab=smtp'),
        ],
        related=['send-an-invoice', 'payment-reminders-and-formal-notice'],
        ui_labels=['Custom Email', 'Test & Save', 'Disable'],
        sources=['frontend/src/pages/settings/SmtpSection.jsx', 'apps/users/views/smtp.py'], checked_on=TODAY),
)
