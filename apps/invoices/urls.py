# apps/invoices/urls.py
from django.urls import path

from . import views

app_name = 'invoices'

urlpatterns = [
    path('', views.invoice_list, name='invoice_list'),
    path('summary/', views.invoice_summary, name='invoice_summary'),
    path('aging-report/', views.invoice_aging_report, name='invoice_aging_report'),
    path('exchange-rate/', views.exchange_rate_lookup, name='exchange_rate_lookup'),

    path('presets/', views.preset_list, name='preset_list'),
    path('presets/<uuid:pk>/', views.preset_detail, name='preset_detail'),
    path('presets/<uuid:pk>/set-default/', views.preset_set_default, name='preset_set_default'),
    path('presets/<uuid:pk>/create-invoice/', views.preset_create_invoice, name='preset_create_invoice'),

    path('designs/ai-seed/', views.design_ai_seed, name='design_ai_seed'),
    path('signature/', views.signature_upload, name='signature_upload'),

    path('designs/', views.design_list, name='design_list'),
    path('designs/duplicate/', views.design_duplicate, name='design_duplicate'),
    path('designs/<uuid:pk>/', views.design_detail, name='design_detail'),
    path('designs/<uuid:pk>/set-default/', views.design_set_default, name='design_set_default'),

    path('<uuid:pk>/', views.invoice_detail, name='invoice_detail'),
    path('<uuid:pk>/pdf/', views.invoice_pdf, name='invoice_pdf'),
    path('<uuid:pk>/finalise/', views.invoice_finalise, name='invoice_finalise'),
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
    path('<uuid:pk>/pause-recurring/', views.invoice_pause_recurring, name='invoice_pause_recurring'),
    path('<uuid:pk>/resume-recurring/', views.invoice_resume_recurring, name='invoice_resume_recurring'),
    path('<uuid:pk>/timeline/', views.invoice_timeline, name='invoice_timeline'),
]
