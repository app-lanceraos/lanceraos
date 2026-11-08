# apps/payments/urls.py
from django.urls import path

from . import views

app_name = 'payments'

urlpatterns = [
    path('', views.payment_list, name='payment_list'),
    path('summary/', views.payment_summary, name='payment_summary'),
    path('currencies/', views.payment_currencies, name='payment_currencies'),
    path('<uuid:pk>/', views.payment_detail, name='payment_detail'),
]
