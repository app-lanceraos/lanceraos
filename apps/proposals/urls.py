# apps/proposals/urls.py
from django.urls import path

from . import views

urlpatterns = [
    path('', views.proposal_list, name='proposal_list'),
    path('generate-ai/', views.proposal_generate_ai_create, name='proposal_generate_ai_create'),
    path('<uuid:pk>/', views.proposal_detail, name='proposal_detail'),
    path('<uuid:pk>/generate-ai/', views.proposal_generate_ai, name='proposal_generate_ai'),
]
