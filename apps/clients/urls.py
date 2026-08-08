# apps/clients/urls.py
from django.urls import path

from . import views

app_name = 'clients'

urlpatterns = [
    path('', views.client_list, name='client_list'),
    path('tags/', views.client_tags, name='client_tags'),
    path('<uuid:pk>/', views.client_detail, name='client_detail'),
    path('<uuid:pk>/archive/', views.client_archive, name='client_archive'),
    path('<uuid:pk>/restore/', views.client_restore, name='client_restore'),
    path('<uuid:pk>/flag/', views.client_flag, name='client_flag'),
    path('<uuid:pk>/notes/', views.client_notes, name='client_notes'),
    path('<uuid:pk>/notes/<uuid:note_id>/', views.client_note_delete, name='client_note_delete'),
    path('<uuid:pk>/analytics/', views.client_analytics, name='client_analytics'),
    path('<uuid:pk>/tags/<uuid:tag_id>/attach/', views.client_tag_attach, name='client_tag_attach'),
    path('<uuid:pk>/tags/<uuid:tag_id>/', views.client_tag_detach, name='client_tag_detach'),
]
