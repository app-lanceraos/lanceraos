# apps/users/admin.py
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import EmailChangeRequest, FreelancerProfile, Session, TrustedDevice, User, UserSocialAccount


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ['email', 'username', 'is_email_verified', 'two_fa_enabled', 'is_deleted', 'is_active', 'date_joined']
    list_filter = ['is_email_verified', 'two_fa_enabled', 'is_deleted', 'is_active', 'is_staff']
    search_fields = ['email', 'username', 'first_name', 'last_name']
    ordering = ['-date_joined']
    readonly_fields = ['password_history', 'password_changed_at', 'last_login_ip', 'last_login_device', 'anonymized_at']

    fieldsets = (
        (None, {'fields': ('email', 'username', 'password')}),
        ('Personal info', {'fields': ('first_name', 'last_name', 'date_of_birth')}),
        ('Security', {'fields': (
            'is_email_verified', 'two_fa_enabled', 'failed_login_attempts',
            'account_locked_until', 'last_login_ip', 'last_login_device',
            'password_changed_at', 'password_history',
        )}),
        ('Email change', {'fields': ('pending_email', 'pending_email_expires_at')}),
        ('Deletion', {'fields': (
            'is_deleted', 'deleted_at', 'deletion_requested_at',
            'deletion_scheduled_at', 'anonymized_at',
        )}),
        ('Permissions', {'fields': (
            'is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions',
        )}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {'classes': ('wide',), 'fields': ('email', 'username', 'password1', 'password2')}),
    )


@admin.register(FreelancerProfile)
class FreelancerProfileAdmin(admin.ModelAdmin):
    list_display = ['display_name', 'user', 'business_name', 'default_currency', 'custom_smtp_enabled', 'onboarding_completed']
    list_filter = ['default_currency', 'custom_smtp_enabled', 'onboarding_completed', 'pseb_registered']
    search_fields = ['display_name', 'business_name', 'user__email']
    # Encrypted/hash columns and the SMTP password are never manually
    # editable through the admin — they exist for the app's own use
    # (encryption + blind-index lookups), not for staff to type into.
    readonly_fields = [
        'cnic_encrypted', 'cnic_hash', 'ntn_encrypted', 'ntn_hash',
        'pseb_encrypted', 'pseb_hash', 'custom_smtp_password',
        'created_at', 'updated_at',
    ]


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = ['user', 'device_name', 'ip_address', 'created_at', 'last_used_at', 'expires_at']
    list_filter = ['created_at']
    search_fields = ['user__email', 'device_name', 'ip_address']
    readonly_fields = ['refresh_token_hash', 'created_at']


@admin.register(UserSocialAccount)
class UserSocialAccountAdmin(admin.ModelAdmin):
    list_display = ['user', 'provider', 'provider_uid', 'created_at']
    list_filter = ['provider']
    search_fields = ['user__email', 'provider_uid']


@admin.register(TrustedDevice)
class TrustedDeviceAdmin(admin.ModelAdmin):
    list_display = ['user', 'device_name', 'ip_address', 'created_at', 'expires_at', 'last_used_at']
    search_fields = ['user__email', 'device_name']
    readonly_fields = ['token_hash', 'created_at']


@admin.register(EmailChangeRequest)
class EmailChangeRequestAdmin(admin.ModelAdmin):
    list_display = ['user', 'new_email', 'step', 'created_at', 'completed_at']
    list_filter = ['step']
    search_fields = ['user__email', 'new_email']
    readonly_fields = ['step1_token', 'step2_token', 'created_at', 'completed_at']