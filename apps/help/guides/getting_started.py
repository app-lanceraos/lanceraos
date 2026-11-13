# apps/help/guides/getting_started.py
"""Guides: getting started (what LanceraOS does, first steps, finding your way, items that are not available yet)."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'what-is-lanceraos', 'What LanceraOS does', 'getting-started',
        'LanceraOS helps freelancers in Pakistan run the money side of their work from one place.',
        ['about', 'overview', 'features', 'freelancer', 'pakistan', 'what can i do', 'modules', 'introduction', 'app', 'platform', 'software'],
        [
            p('LanceraOS is a web app for freelancers in Pakistan who work with clients abroad. You keep your clients, invoices, payments and expenses together, and you can see how your business is doing.'),
            p('In the sidebar you can open Invoices, Clients, Payments, Expenses, P&L, Tax, Proposals, Contracts, Health Score and Income Statement. The Dashboard is the page you land on after you sign in.'),
            p('Invoices and Payments record the money you earn. Expenses record what you spend. P&L, Income Statement and Health Score read those records and turn them into reports. Tax shows an estimate based on your payments. Proposals and Contracts help you win work and agree terms.'),
            link('Open the Dashboard', '/dashboard'),
        ],
        related=['first-steps', 'find-your-way-around', 'your-dashboard'],
        sources=['frontend/src/components/AppShell.jsx', 'frontend/src/App.jsx'], checked_on=TODAY),
    guide(
        'first-steps', 'Set up your account', 'getting-started',
        'The first things to fill in so your invoices and documents carry the right details.',
        ['getting started', 'new account', 'onboarding', 'welcome', 'begin', 'first invoice', 'profile', 'setup', 'start'],
        [
            p('After your first sign-in you see a short welcome form about your work. It asks for your profession, how you earn and where you find clients. If you signed up with Google it also asks you to review your username and add your date of birth.'),
            steps(
                'Finish the welcome form and press "Continue to LanceraOS".',
                'On the Profile page, add your "Display Name" and "Business Name", and upload your "Business Logo" if you have one.',
                'Open Settings and fill in "Business" with your address and the ways clients can pay you.',
                'If you want tax details on your documents, open "Tax & PSEB" in Settings and add them.',
                'Open Clients in the sidebar and add your first client.',
                'Open Invoices in the sidebar and create your first invoice.',
            ),
            note('Your business name and logo appear on your invoices, so add them before you send one.'),
            link('Open your profile', '/profile'),
        ],
        related=['business-details-and-payment-methods', 'add-and-manage-clients', 'create-an-invoice'],
        ui_labels=['Continue to LanceraOS', 'Display Name', 'Business Name', 'Business Logo', 'Business', 'Tax & PSEB'],
        sources=['frontend/src/pages/Onboarding.jsx', 'frontend/src/pages/Profile.jsx', 'frontend/src/pages/Settings.jsx'],
        checked_on=TODAY),
    guide(
        'find-your-way-around', 'Find your way around', 'getting-started',
        'Where things are: the sidebar, the bell, your profile menu and the light and dark theme.',
        ['navigation', 'sidebar', 'menu', 'dark mode', 'light mode', 'theme', 'where is', 'header', 'collapse'],
        [
            p('The sidebar on the left groups the app. Menu holds Dashboard, Invoices and Clients. Finance holds Payments, Expenses, P&L and Tax. Docs holds Proposals and Contracts. Account holds Health Score and Income Statement.'),
            p('The bell in the top bar opens your notifications. Your profile menu has Profile, Settings and "Sign out". The sidebar has a switch between a light and a dark theme.'),
            p('You can close the sidebar to give the page more room. Use the button at the top of the sidebar, or "Open menu" on a phone.'),
            note('Profile is about how you appear on invoices. Settings is where you change your account, business, tax details, security and email sending.'),
        ],
        related=['what-is-lanceraos', 'notifications'],
        ui_labels=['Sign out', 'Open menu'],
        sources=['frontend/src/components/AppShell.jsx'], checked_on=TODAY),
)
