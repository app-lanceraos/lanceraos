"""
WSGI entrypoint. Not used for local dev (Daphne serves both HTTP and
WebSocket traffic — see asgi.py); kept for the eventual Railway
gunicorn deploy path referenced in requirements.txt.
"""
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

application = get_wsgi_application()
