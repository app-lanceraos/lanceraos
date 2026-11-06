# apps/dashboard/urls.py
from django.urls import path

from . import views

app_name = 'dashboard'

urlpatterns = [
    path('summary/', views.dashboard_summary, name='dashboard_summary'),
]
