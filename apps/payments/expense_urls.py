# apps/payments/expense_urls.py
from django.urls import path

from . import views_expenses

app_name = 'expenses'

urlpatterns = [
    path('', views_expenses.expense_list, name='expense_list'),
    path('summary/', views_expenses.expense_summary, name='expense_summary'),
    path('currencies/', views_expenses.expense_currencies, name='expense_currencies'),
    path('<uuid:pk>/', views_expenses.expense_detail, name='expense_detail'),
]
