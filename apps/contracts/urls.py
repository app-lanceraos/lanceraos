# apps/contracts/urls.py
from django.urls import path

from . import views, views_public

urlpatterns = [
    path('', views.contract_list, name='contract_list'),
    # Literal paths before the <uuid:pk> routes.
    path('templates/', views.contract_templates, name='contract_templates'),
    path('public/<str:view_token>/', views_public.contract_public, name='contract_public'),
    path('public/<str:view_token>/sign/', views_public.contract_public_sign, name='contract_public_sign'),
    path('public/<str:view_token>/decline/', views_public.contract_public_decline, name='contract_public_decline'),
    path('<uuid:pk>/', views.contract_detail, name='contract_detail'),
    path('<uuid:pk>/send/', views.contract_send, name='contract_send'),
    path('<uuid:pk>/withdraw/', views.contract_withdraw, name='contract_withdraw'),
    path('<uuid:pk>/duplicate/', views.contract_duplicate, name='contract_duplicate'),
]
