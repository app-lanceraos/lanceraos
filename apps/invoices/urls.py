# apps/invoices/urls.py
from django.urls import path

from . import views, views_email, views_portal

app_name = 'invoices'

urlpatterns = [
    path('', views.invoice_list, name='invoice_list'),
    path('summary/', views.invoice_summary, name='invoice_summary'),
    path('currencies/', views.invoice_currencies, name='invoice_currencies'),
    path('exchange-rate/', views.exchange_rate_lookup, name='exchange_rate_lookup'),
    path('analytics/', views.invoice_analytics, name='invoice_analytics'),
    path('email/incoming/', views_email.email_incoming_webhook, name='email_incoming_webhook'),

    # Client Portal content (Step 12) — apps.invoices imports the
    # session/identity utility from apps.clients, never the reverse.
    # portal/view/<token>/ and portal/me/ are structurally distinct from
    # portal/<uuid:pk>/ (different segment shapes — 'view' is never a
    # valid uuid), so ordering between them doesn't affect matching, but
    # literal-prefixed routes are still listed first for consistency
    # with this file's other route groups.
    path('portal/me/', views_portal.portal_invoice_list, name='portal_invoice_list'),
    path('portal/view/<str:view_token>/', views_portal.portal_invoice_view_html, name='portal_invoice_view_html'),
    path('portal/view/<str:view_token>/pdf/', views_portal.portal_invoice_pdf_download, name='portal_invoice_pdf_download'),
    path('portal/<uuid:pk>/', views_portal.portal_invoice_detail, name='portal_invoice_detail'),
    path('portal/<uuid:pk>/comments/', views_portal.portal_invoice_comments, name='portal_invoice_comments'),
    path('portal/<uuid:pk>/claims/', views_portal.portal_invoice_claims, name='portal_invoice_claims'),
    path('portal/<uuid:pk>/acknowledge/', views_portal.portal_invoice_acknowledge, name='portal_invoice_acknowledge'),

    path('presets/', views.preset_list, name='preset_list'),
    path('presets/<uuid:pk>/', views.preset_detail, name='preset_detail'),
    path('presets/<uuid:pk>/set-default/', views.preset_set_default, name='preset_set_default'),
    path('presets/<uuid:pk>/create-invoice/', views.preset_create_invoice, name='preset_create_invoice'),

    path('designs/ai-seed/', views.design_ai_seed, name='design_ai_seed'),
    path('signature/', views.signature_upload, name='signature_upload'),

    path('designs/', views.design_list, name='design_list'),
    path('designs/duplicate/', views.design_duplicate, name='design_duplicate'),
    path('designs/preview/', views.design_builtin_preview, name='design_builtin_preview'),
    path('designs/<uuid:pk>/', views.design_detail, name='design_detail'),
    path('designs/<uuid:pk>/set-default/', views.design_set_default, name='design_set_default'),
    path('designs/<uuid:pk>/preview/', views.design_preview, name='design_preview'),

    path('<uuid:pk>/', views.invoice_detail, name='invoice_detail'),
    path('<uuid:pk>/pdf/', views.invoice_pdf, name='invoice_pdf'),
    path('<uuid:pk>/finalise/', views.invoice_finalise, name='invoice_finalise'),
    path('<uuid:pk>/finalise-and-send/', views.invoice_finalise_and_send, name='invoice_finalise_and_send'),
    path('<uuid:pk>/mark-sent/', views.invoice_mark_sent, name='invoice_mark_sent'),
    path('<uuid:pk>/send/', views.invoice_send, name='invoice_send'),
    path('<uuid:pk>/mark-paid/', views.invoice_mark_paid, name='invoice_mark_paid'),
    path('<uuid:pk>/payments/', views.invoice_add_payment, name='invoice_add_payment'),
    path('<uuid:pk>/payments/undo/', views.invoice_undo_payment, name='invoice_undo_payment'),
    path('<uuid:pk>/cancel/', views.invoice_cancel, name='invoice_cancel'),
    path('<uuid:pk>/refund/', views.invoice_refund, name='invoice_refund'),
    path('<uuid:pk>/bad-debt/', views.invoice_mark_bad_debt, name='invoice_mark_bad_debt'),
    path('<uuid:pk>/duplicate/', views.invoice_duplicate, name='invoice_duplicate'),
    path('<uuid:pk>/toggle-reminders/', views.invoice_toggle_reminders, name='invoice_toggle_reminders'),
    path('<uuid:pk>/send-reminder/', views.invoice_send_reminder, name='invoice_send_reminder'),
    path('<uuid:pk>/resend/', views.invoice_resend, name='invoice_resend'),
    path('<uuid:pk>/pause-recurring/', views.invoice_pause_recurring, name='invoice_pause_recurring'),
    path('<uuid:pk>/resume-recurring/', views.invoice_resume_recurring, name='invoice_resume_recurring'),
    path('<uuid:pk>/timeline/', views.invoice_timeline, name='invoice_timeline'),
    path('<uuid:pk>/preview-as-client/', views_portal.invoice_preview_as_client, name='invoice_preview_as_client'),
    path('<uuid:pk>/comments/', views.invoice_comments, name='invoice_comments'),
    path('<uuid:pk>/claims/', views.invoice_claims, name='invoice_claims'),
    path('<uuid:pk>/claims/<uuid:claim_id>/confirm/', views.invoice_claim_confirm, name='invoice_claim_confirm'),
    path('<uuid:pk>/claims/<uuid:claim_id>/reject/', views.invoice_claim_reject, name='invoice_claim_reject'),
    path('<uuid:pk>/dismiss-escalation/', views.invoice_dismiss_escalation, name='invoice_dismiss_escalation'),
    path('<uuid:pk>/send-formal-notice/', views.invoice_send_formal_notice, name='invoice_send_formal_notice'),
]
