# apps/help/urls.py
"""Routes of the Help assistant, mounted at /api/help/ (config/urls.py)."""
from django.urls import path

from . import views

app_name = 'help'

urlpatterns = [
    path('guides/', views.list_guides, name='list_guides'),
    path('guides/<str:slug>/', views.get_guide, name='get_guide'),
    path('search/', views.search_guides, name='search_guides'),
    path('ask/', views.ask_question, name='ask_question'),
    path('rate/', views.rate_answer, name='rate_answer'),
]
