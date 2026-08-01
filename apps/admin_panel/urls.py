# apps/admin_panel/urls.py
from django.urls import path

from . import views, views_audit, views_deletion, views_users

app_name = 'admin_panel'

urlpatterns = [
    path('login/', views.admin_login, name='admin_login'),
    path('2fa/verify/', views.admin_verify_2fa, name='admin_2fa_verify'),
    path('logout/', views.admin_logout, name='admin_logout'),
    path('token/refresh/', views.admin_refresh, name='admin_token_refresh'),
    path('me/', views.admin_me, name='admin_me'),
]

urlpatterns += [
    path('users/search/', views_users.search_users, name='admin_user_search'),
    path('users/<uuid:user_id>/', views_users.user_detail, name='admin_user_detail'),
    path('users/<uuid:user_id>/sessions/', views_users.user_sessions, name='admin_user_sessions'),
    path('users/<uuid:user_id>/sessions/<uuid:session_id>/', views_users.admin_revoke_session, name='admin_revoke_session'),
    path('users/<uuid:user_id>/suspend/', views_users.suspend_user, name='admin_suspend_user'),
    path('users/<uuid:user_id>/reactivate/', views_users.reactivate_user, name='admin_reactivate_user'),
    path('users/<uuid:user_id>/grant-admin/', views_users.grant_admin_access, name='admin_grant_access'),
    path('users/<uuid:user_id>/revoke-admin/', views_users.revoke_admin_access, name='admin_revoke_access'),
    path('users/<uuid:user_id>/resend-verification/', views_users.admin_resend_verification, name='admin_resend_verification'),
]

urlpatterns += [
    path('audit-log/', views_audit.audit_log_list, name='admin_audit_log_list'),
    path('audit-log/event-types/', views_audit.audit_log_event_types, name='admin_audit_log_event_types'),
]

urlpatterns += [
    path('deletion-queue/', views_deletion.deletion_queue, name='admin_deletion_queue'),
    path('users/<uuid:user_id>/restore/', views_deletion.admin_restore_account, name='admin_restore_account'),
]
