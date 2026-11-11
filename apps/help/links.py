# apps/help/links.py
"""
The in-app destinations a guide's `link` block may point to (decision H4). Built from the static routes of
frontend/src/App.jsx that a signed-in person can open, plus a query form ONLY where the target page really reads it:
`/settings?tab=` (Settings.jsx VALID_TABS) and `/tax?view=` (taxHelpers.js VIEWS). Never a `:param` path, never an external
URL, never `/skill-gap` (it has no route). `check_help_library` verifies every entry against the frontend source.
"""
LINK_TARGETS = (
    '/dashboard',
    '/invoices',
    '/invoices/templates',
    '/invoices/analytics',
    '/clients',
    '/payments',
    '/expenses',
    '/pnl',
    '/income-certificate',
    '/health',
    '/tax',
    '/tax?view=calculator',
    '/tax?view=sources',
    '/proposals',
    '/proposals/new',
    '/contracts',
    '/contracts/new',
    '/settings',
    '/settings?tab=account',
    '/settings?tab=business',
    '/settings?tab=tax',
    '/settings?tab=security',
    '/settings?tab=sessions',
    '/settings?tab=notifications',
    '/settings?tab=smtp',
    '/profile',
)
