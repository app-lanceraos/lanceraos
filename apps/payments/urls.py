# apps/payments/urls.py
from django.urls import path

from . import views, views_import, views_reports

app_name = 'payments'

urlpatterns = [
    path('', views.payment_list, name='payment_list'),
    # Import routes come BEFORE '<uuid:pk>/' (none of them is a uuid, but the order keeps it obvious).
    path('import/', views_import.import_commit, name='payment_import_commit'),
    path('import/preview/', views_import.import_preview, name='payment_import_preview'),
    path('import/batches/', views_import.import_batch_list, name='payment_import_batches'),
    path('import/batches/<uuid:pk>/', views_import.import_batch_undo, name='payment_import_undo'),
    path('pnl/', views_reports.pnl_report, name='report_pnl'),
    path('income-certificate/', views_reports.income_certificate_report, name='report_income_certificate'),
    path('summary/', views.payment_summary, name='payment_summary'),
    path('currencies/', views.payment_currencies, name='payment_currencies'),
    path('<uuid:pk>/', views.payment_detail, name='payment_detail'),
]
