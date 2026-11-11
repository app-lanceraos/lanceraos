# config/urls.py
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from apps.invoices.views_contract_pdf import contract_pdf_owner, contract_pdf_public
from apps.invoices.views_payment_link import (
    payment_link_candidates,
    payment_link_invoice,
    payment_unlink_invoice,
)
from apps.invoices.views_reports import income_statement_pdf, pnl_pdf
from apps.invoices.views_statement import client_statement_pdf
from apps.invoices.views_tax_pdf import tax_summary_pdf
from core.health import health_check
from core.notifications import (
    dismiss_notifications,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    mark_notifications_read,
)

urlpatterns = [
    # Platform probe (Railway healthcheck) — see core/health.py.
    path('api/health/', health_check, name='health_check'),
    # The Health Score (Prompt 18). AFTER the exact probe above: it matches only 'api/health/' itself.
    path('api/health/', include('apps.health.urls')),
    # The Tax Summary PDF (Prompt 20): WeasyPrint lives in apps.invoices, so it is registered here, BEFORE the apps.tax include.
    path('api/tax/summary/pdf/', tax_summary_pdf, name='tax_summary_pdf'),
    path('api/tax/', include('apps.tax.urls')),
    path('admin/', admin.site.urls),
    path('api/auth/', include('apps.users.urls')),
    path('api/admin/', include('apps.admin_panel.urls')),
    path('api/clients/', include('apps.clients.urls')),
    # Registered here, not in apps/clients/urls.py — the view itself
    # lives in apps.invoices (needs Invoice/InvoicePartialPayment data
    # + the shared WeasyPrint pipeline), and apps.clients can never
    # import from apps.invoices (the established one-directional
    # dependency rule). Matches the spec's own URL shape
    # (/api/clients/<pk>/statement/pdf/) exactly regardless of which
    # app's code implements it — see views_statement.py's own docstring.
    path('api/clients/<uuid:pk>/statement/pdf/', client_statement_pdf, name='client_statement_pdf'),
    path('api/invoices/', include('apps.invoices.urls')),
    # Registered here, BEFORE the apps.payments include, for the same reason as the statement route
    # above: linking a payment to an invoice needs both models, and apps.payments (the bottom of
    # the dependency tree) can never import apps.invoices. The URL shape is still /api/payments/...
    path('api/payments/<uuid:pk>/link-candidates/', payment_link_candidates, name='payment_link_candidates'),
    path('api/payments/<uuid:pk>/link-invoice/', payment_link_invoice, name='payment_link_invoice'),
    path('api/payments/<uuid:pk>/link-invoice/<uuid:allocation_id>/', payment_unlink_invoice, name='payment_unlink_invoice'),
    # The two report PDFs (Prompt 16): WeasyPrint lives in apps.invoices, so they are registered here, BEFORE
    # the apps.payments include, exactly like the links above.
    path('api/payments/pnl/pdf/', pnl_pdf, name='report_pnl_pdf'),
    path('api/payments/income-certificate/pdf/', income_statement_pdf, name='report_income_certificate_pdf'),
    path('api/payments/', include('apps.payments.urls')),
    path('api/expenses/', include('apps.payments.expense_urls')),
    path('api/proposals/', include('apps.proposals.urls')),
    # The two Contract PDFs (Prompt 22): WeasyPrint lives in apps.invoices, so they are registered here, BEFORE the
    # apps.contracts include, exactly like the tax summary and the report PDFs.
    path('api/contracts/<uuid:pk>/pdf/', contract_pdf_owner, name='contract_pdf_owner'),
    path('api/contracts/public/<str:view_token>/pdf/', contract_pdf_public, name='contract_pdf_public'),
    path('api/contracts/', include('apps.contracts.urls')),
    path('api/dashboard/', include('apps.dashboard.urls')),
    # The Help assistant (Prompt 24): guides, search, a guarded AI answer.
    path('api/help/', include('apps.help.urls')),
    # Lives at the root, not under api/auth/ — matches what the frontend
    # (AppShell.jsx) already calls directly via api.get('/notifications/'),
    # which resolves against the API base URL, not through /auth/.
    path('api/notifications/', list_notifications, name='notifications_list'),
    path('api/notifications/read-all/', mark_all_notifications_read, name='notifications_read_all'),
    path('api/notifications/dismiss/', dismiss_notifications, name='notifications_dismiss'),
    path('api/notifications/mark-read/', mark_notifications_read, name='notifications_mark_read'),
    path('api/notifications/<uuid:notification_id>/read/', mark_notification_read, name='notification_read'),
    # Future modules add their own include() here as they're built.
]

# Outside DEBUG, /static/ is served by WhiteNoise (settings.MIDDLEWARE), not
# by Django URL routing; this helper only ever works in DEBUG anyway.
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)