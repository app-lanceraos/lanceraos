# config/urls.py
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from apps.invoices.views_statement import client_statement_pdf
from core.notifications import (
    dismiss_notifications,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    mark_notifications_read,
)

urlpatterns = [
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
    # Lives at the root, not under api/auth/ — matches what the frontend
    # (AppShell.jsx) already calls directly via api.get('/notifications/'),
    # which resolves against the API base URL, not through /auth/.
    path('api/notifications/', list_notifications, name='notifications_list'),
    path('api/notifications/read-all/', mark_all_notifications_read, name='notifications_read_all'),
    path('api/notifications/dismiss/', dismiss_notifications, name='notifications_dismiss'),
    path('api/notifications/mark-read/', mark_notifications_read, name='notifications_mark_read'),
    path('api/notifications/<uuid:notification_id>/read/', mark_notification_read, name='notification_read'),
    # Future modules add their own include() here as they're built.
    # (apps.payments has no HTTP surface of its own — it's consumed
    # internally by other modules, e.g. apps.clients'/apps.invoices'
    # currency validation.)
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)