# apps/health/urls.py
from django.urls import path

from . import views

app_name = 'health'

urlpatterns = [
    path('score/', views.health_score, name='health_score'),
    path('mini/', views.health_mini, name='health_mini'),
]
