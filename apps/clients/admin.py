# apps/clients/admin.py
from django.contrib import admin

from .models import Client, ClientNote, ClientTag


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ['name', 'email', 'user', 'company', 'default_currency', 'is_active', 'is_flagged', 'created_at']
    list_filter = ['is_active', 'is_flagged', 'auto_flagged', 'default_currency']
    search_fields = ['name', 'email', 'company', 'user__email']
    readonly_fields = ['portal_token', 'created_at', 'updated_at']


@admin.register(ClientNote)
class ClientNoteAdmin(admin.ModelAdmin):
    list_display = ['client', 'author', 'created_at']
    search_fields = ['client__name', 'author__email', 'content']
    readonly_fields = ['created_at', 'updated_at']


@admin.register(ClientTag)
class ClientTagAdmin(admin.ModelAdmin):
    list_display = ['name', 'color', 'user']
    search_fields = ['name', 'user__email']
