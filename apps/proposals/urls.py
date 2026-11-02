# apps/proposals/urls.py
from django.urls import path

from . import views, views_public

urlpatterns = [
    path('', views.proposal_list, name='proposal_list'),
    path('generate-ai/', views.proposal_generate_ai_create, name='proposal_generate_ai_create'),
    # Literal paths before the <uuid:pk> routes.
    path('public/<str:view_token>/', views_public.proposal_public, name='proposal_public'),
    path('public/<str:view_token>/respond/', views_public.proposal_public_respond, name='proposal_public_respond'),
    path('<uuid:pk>/', views.proposal_detail, name='proposal_detail'),
    path('<uuid:pk>/generate-ai/', views.proposal_generate_ai, name='proposal_generate_ai'),
    path('<uuid:pk>/send/', views.proposal_send, name='proposal_send'),
    path('<uuid:pk>/withdraw/', views.proposal_withdraw, name='proposal_withdraw'),
    path('<uuid:pk>/duplicate/', views.proposal_duplicate, name='proposal_duplicate'),
    path('<uuid:pk>/convert-to-invoice/', views.proposal_convert_to_invoice, name='proposal_convert_to_invoice'),
]
