# apps/tax/urls.py
from django.urls import path

from . import views

app_name = 'tax'

urlpatterns = [
    path('overview/', views.tax_overview, name='tax_overview'),
    path('law/', views.tax_law, name='tax_law'),
    path('calculator/', views.tax_calculator, name='tax_calculator'),
]
