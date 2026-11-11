# apps/help/guides/dashboard.py
"""Guides: the dashboard and notifications."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'your-dashboard', 'Your dashboard', 'dashboard',
        'What each card on the Dashboard shows, from your key figures to what needs your attention.',
        ['home', 'landing page', 'overview', 'kpi', 'cards', 'needs attention', 'insights', 'summary', 'outstanding', 'unread'],
        [
            p('The Dashboard is the page you land on after you sign in. At the top are four cards: "Outstanding", "Overdue", "Paid this month" and "Active clients". Outstanding is everything still owed to you today. Paid this month is the money received this month, and it shows how it compares with last month when there is one.'),
            p('Below them is a bar chart of the income you received over the last few months. "Needs your attention" lists overdue invoices, unread messages and proposals awaiting an answer. "Upcoming recurring invoices" lists the ones due in the next few days, and "Recent activity" shows what happened lately.'),
            p('"Exchange rates" shows the latest saved rates, and "Financial health" shows your health score with the best next step. "Insights" gives a few short observations about your own numbers. With AI off, it shows fixed sentences built from the same figures.'),
            note('Each card loads on its own. If one cannot load, it says so and you can press "Retry" without losing the others. Times are shown in Pakistan time.'),
            link('Open the Dashboard', '/dashboard'),
        ],
        related=['invoice-analytics', 'health-score', 'exchange-rates-and-converted-amounts', 'ai-features-in-lanceraos'],
        ui_labels=['Outstanding', 'Overdue', 'Paid this month', 'Active clients', 'Needs your attention', 'Upcoming recurring invoices', 'Recent activity',
                   'Exchange rates', 'Financial health', 'Insights', 'Retry'],
        sources=['frontend/src/pages/Dashboard.jsx', 'frontend/src/pages/dashboardHelpers.js', 'frontend/src/components/DashboardAttentionCard.jsx', 'frontend/src/components/DashboardInsightsCard.jsx'],
        checked_on=TODAY),
    guide(
        'notifications', 'Notifications', 'dashboard',
        'Use the bell to see what has happened, mark things read, and control what you are told about.',
        ['bell', 'alerts', 'unread', 'mark as read', 'clear notifications', 'notification panel', 'delete notification', 'push'],
        [
            p('The bell in the top bar shows how many notifications are unread. Press it to open "Notifications". New ones appear as they arrive. Select a notification to go to the invoice, client, proposal or contract it is about.'),
            steps(
                'Press "Mark all read" to clear the unread count in one step.',
                'Press "Select" to choose notifications yourself.',
                'Pick some, or press "Select All", then use "Mark selected as read" or "Delete selected".',
            ),
            p('When there is nothing yet, the panel says "No notifications yet".'),
            note('What you are told about depends on your switches in Settings under "Notifications". Security alerts always stay on.'),
            link('Open Notifications settings', '/settings?tab=notifications'),
        ],
        related=['notification-settings', 'find-your-way-around', 'invoice-messages-and-payment-claims'],
        ui_labels=['Notifications', 'Mark all read', 'Select', 'Select All', 'Mark selected as read', 'Delete selected', 'No notifications yet'],
        sources=['frontend/src/components/AppShell.jsx', 'frontend/src/pages/settings/NotificationsSection.jsx'], checked_on=TODAY),
)
