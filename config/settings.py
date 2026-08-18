# config/settings.py
import os
import sys
from datetime import timedelta

import cloudinary
import environ

env = environ.Env()
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
environ.Env.read_env(os.path.join(BASE_DIR, '.env'))

# ══════════════════════════════════════════════════════════════════
# CORE
# ══════════════════════════════════════════════════════════════════

SECRET_KEY = env('SECRET_KEY')
if len(SECRET_KEY) < 50:
    raise ValueError('SECRET_KEY is too short. Use a key of at least 50 characters.')

DEBUG = env.bool('DEBUG', default=False)
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost', '127.0.0.1'])

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
AUTH_USER_MODEL = 'users.User'

LANGUAGE_CODE = 'en-us'
# USE_TZ = False is deliberate, not an oversight: the platform stores and
# operates on Pakistan Standard Time only (see CLAUDE.md rule 2). A
# user's FreelancerProfile.timezone field is used purely for DISPLAY
# formatting on the frontend — there is no server-side timezone
# conversion anywhere, by design.
TIME_ZONE = 'Asia/Karachi'
USE_I18N = True
USE_TZ = False

STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')

# ══════════════════════════════════════════════════════════════════
# DATABASE
# ══════════════════════════════════════════════════════════════════

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('DB_NAME'),
        'USER': env('DB_USER'),
        'PASSWORD': env('DB_PASSWORD'),
        'HOST': env('DB_HOST', default='127.0.0.1'),
        'PORT': env('DB_PORT', default='5432'),
        # CONN_MAX_AGE must stay 0 under ASGI/Daphne: with pooled
        # connections, asgiref's thread pool would hold one open Postgres
        # connection per thread for the full timeout window. Under
        # sustained polling + WebSocket reconnects (once those modules
        # exist), threads accumulate until Postgres hits max_connections.
        # 0 = close after every request.
        'CONN_MAX_AGE': 0,
        'CONN_HEALTH_CHECKS': True,
    }
}

# ══════════════════════════════════════════════════════════════════
# INSTALLED APPS
# ══════════════════════════════════════════════════════════════════

INSTALLED_APPS = [
    # daphne must be listed before django.contrib.staticfiles so
    # `manage.py runserver` uses ASGI, not the WSGI dev server.
    'daphne',
    'django.contrib.admin',
    'axes',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # intcomma/floatformat for money formatting in invoice PDF templates
    # (Step 7) — thousands-separator display only, no models/migrations.
    'django.contrib.humanize',
    # Third party
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    'django_celery_beat',
    'channels',
    # LanceraOS
    'core',
    'apps.users',
    'apps.admin_panel',
    'apps.payments',
    'apps.clients',
    'apps.invoices',
    # Future modules join this list as their own chats build them:
    # 'apps.tax', 'apps.health',
    # 'apps.proposals', 'apps.contracts', 'apps.subscriptions',
    # 'apps.dashboard', 'apps.insights', 'apps.assistant',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # Ours, last — by the time this runs, request.user has already been
    # resolved by DRF's authentication step inside the view, which is
    # exactly what ApiRequestLog needs to attribute correctly.
    'core.middleware.RequestLoggingMiddleware',
    # django-axes — must be last per its own docs, so it sees the final
    # response (including from other middleware) before deciding whether
    # to lock out. Only guards /admin/ login today; apps.users' own views
    # already have their own account-lockout/rate-limiting logic and
    # don't go through AUTHENTICATION_BACKENDS at all.
    'axes.middleware.AxesMiddleware',
]

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

# ══════════════════════════════════════════════════════════════════
# CACHE — Redis, not LocMemCache
# ══════════════════════════════════════════════════════════════════
# v1 used LocMemCache, which is per-process memory. Every rate limit,
# 2FA session, and deletion-OTP session in apps/users lives in this
# cache — under more than one Railway worker process, LocMemCache would
# silently split that state across processes (a login rate-limited on
# worker A would look fresh on worker B). Redis is already provisioned
# for Celery; using it for the cache too costs nothing extra and closes
# this gap before it ever surfaces in production.

CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': env('REDIS_URL', default='redis://127.0.0.1:6379/1'),
    }
}

# ══════════════════════════════════════════════════════════════════
# CORS / CSRF — cookie-based auth across the app.lanceraos.com /
# api.lanceraos.com subdomain split
# ══════════════════════════════════════════════════════════════════

CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS', default=[
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    # admin-frontend — a separate Vite dev server on its own port, same
    # reasoning as the main app above (cookies need CORS_ALLOW_CREDENTIALS
    # to actually travel cross-origin, not just a matching origin).
    'http://localhost:5174',
    'http://127.0.0.1:5174',
])
# Required because the frontend sends the JWT/CSRF cookies on every
# request (withCredentials / credentials: 'include') — without this,
# the browser silently drops the cookies on cross-origin requests even
# though CORS_ALLOWED_ORIGINS matches. v1 never needed this since it
# never sent cookies at all (JWT lived in localStorage + Authorization
# header instead).
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
])

# Shared across app.lanceraos.com and api.lanceraos.com in production
# (COOKIE_DOMAIN=.lanceraos.com); None (host-only cookie) is correct for
# local dev where frontend/backend are on different localhost ports.
COOKIE_DOMAIN = env('COOKIE_DOMAIN', default=None)
COOKIE_SECURE = env.bool('COOKIE_SECURE', default=not DEBUG)
COOKIE_SAMESITE = env('COOKIE_SAMESITE', default='Lax')

CSRF_COOKIE_DOMAIN = COOKIE_DOMAIN
CSRF_COOKIE_SAMESITE = COOKIE_SAMESITE
CSRF_COOKIE_SECURE = COOKIE_SECURE
SESSION_COOKIE_DOMAIN = COOKIE_DOMAIN
SESSION_COOKIE_SAMESITE = COOKIE_SAMESITE
SESSION_COOKIE_SECURE = COOKIE_SECURE

# ══════════════════════════════════════════════════════════════════
# REST FRAMEWORK / JWT
# ══════════════════════════════════════════════════════════════════

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'apps.users.authentication.CookieJWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    # Blanket safety nets only. Per-endpoint rate limits (login, register,
    # forgot-password, 2FA resend, etc.) are enforced explicitly inside
    # each view via Django's cache — v1 declared DRF scoped-throttle rates
    # for these in this same dict, but never actually attached
    # `throttle_scope` to any view, so those entries did nothing. Not
    # carried forward for the same reason the unused email-change token
    # generators weren't: config that looks load-bearing but isn't is
    # worse than no config at all.
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/hour',
        'user': '1000/hour',
    },
}

SIMPLE_JWT = {
    # Must match apps/users/cookies.py's ACCESS_TOKEN_MAX_AGE_SECONDS
    # (900s) — the cookie and the token it carries must expire together.
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    # Only a fallback default: apps/users/token_service.py always calls
    # refresh.set_exp() explicitly with the real 30/90-day lifetime, so
    # this value is never actually relied on in practice.
    'REFRESH_TOKEN_LIFETIME': timedelta(days=30),
    'UPDATE_LAST_LOGIN': False,  # updated manually in views (see auth._update_last_login)
}

# ══════════════════════════════════════════════════════════════════
# PASSWORD HASHING — Argon2 (CLAUDE.md rule 7, never bcrypt/plaintext)
# ══════════════════════════════════════════════════════════════════
# Requires `argon2-cffi` in requirements.txt. Argon2 listed first is
# what makes Django hash NEW passwords with it; the PBKDF2 entries after
# it exist only so Django can still verify any password that was ever
# hashed differently (there are none yet in a fresh v2 database, but
# this is the correct permanent ordering regardless).

PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.Argon2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher',
]

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 8}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ══════════════════════════════════════════════════════════════════
# DJANGO-AXES — /admin/ brute-force protection
# ══════════════════════════════════════════════════════════════════
# apps.users' own login/2FA/deletion/etc. views never go through
# AUTHENTICATION_BACKENDS or django.contrib.auth's authenticate() at
# all (they call user.check_password() directly and enforce their own
# cache-based lockout/rate-limiting) — so this only ever guards
# /admin/login/, which had no brute-force protection of its own before
# this. Axes' backend must run before ModelBackend so it gets the
# chance to reject a login attempt before Django's own password check.

AUTHENTICATION_BACKENDS = [
    'axes.backends.AxesStandaloneBackend',
    'django.contrib.auth.backends.ModelBackend',
]

AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = 1  # hours
AXES_LOCKOUT_PARAMETERS = ['username', 'ip_address']

# ══════════════════════════════════════════════════════════════════
# SECURITY HEADERS (production only)
# ══════════════════════════════════════════════════════════════════

if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_HSTS_SECONDS = 31536000  # 1 year
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    X_FRAME_OPTIONS = 'DENY'

# ══════════════════════════════════════════════════════════════════
# ENCRYPTION — Fernet + blind-index (core/encryption.py)
# ══════════════════════════════════════════════════════════════════

ENCRYPTION_KEY = env('ENCRYPTION_KEY')
BLIND_INDEX_KEY = env('BLIND_INDEX_KEY')

# ══════════════════════════════════════════════════════════════════
# EMAIL — Resend HTTP API (core/email.py), NOT Django's mail backend
# ══════════════════════════════════════════════════════════════════
# v1 pointed Django's EMAIL_BACKEND at Resend's SMTP relay — which
# technically worked, but contradicts CLAUDE.md rule 3 ("never use
# Django's email backend or SMTP directly") and isn't what core/email.py
# actually does anyway (it calls Resend's HTTP API directly via
# requests.post, bypassing Django mail entirely). So there's no global
# EMAIL_BACKEND/EMAIL_HOST configuration here for platform email — only
# the plain values core.email and apps.users.emails read directly.
# Django's SMTP backend IS still used, deliberately, but only inside
# apps/users/views/smtp.py's save_custom_smtp(), which constructs its
# own one-off connection per call to test a USER'S OWN mail server —
# a different operation from LanceraOS sending its own mail.

RESEND_API_KEY = env('RESEND_API_KEY', default='')
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='LanceraOS <noreply@lanceraos.com>')
RESEND_FROM_NAME = env('RESEND_FROM_NAME', default='LanceraOS')

FRONTEND_URL = env('FRONTEND_URL', default='http://localhost:5173')
# Used to build every client-facing link (Invoice.portal_view_url, the
# client-portal magic-link resend flow, etc.) — including, as of 18
# August 2026, the invoice VIEW page itself: apps/invoices/models.py's
# Invoice.portal_view_url now points at the frontend's own real React
# route (/invoice/:token, InvoiceView.jsx) instead of the raw backend/API
# host, so a client always sees the actual product domain in their
# address bar. See DECISIONS.md's real-frontend-domain-invoice-view-page
# entry — that same entry is why BACKEND_URL (which existed solely to
# build that one link) was removed entirely rather than left unused.

# Step 13 — apps/invoices/views_email.py's inbound email-reply webhook
# (POST /api/invoices/email/incoming/) authenticates the real Cloudflare
# Email Routing -> Worker -> webhook call with this shared secret, sent
# as the X-Webhook-Secret header. No default — an empty/unset value
# means the endpoint rejects every request (fails closed, not open).
CLOUDFLARE_WEBHOOK_SECRET = env('CLOUDFLARE_WEBHOOK_SECRET', default='')

# Because core/email.py bypasses Django's mail backend entirely (see
# above), `manage.py test` needs its own safety net to guarantee no test
# can reach the real Resend API — see core/test_runner.py for why this
# has to patch requests.post rather than core.email.send_email directly.
TEST_RUNNER = 'core.test_runner.SafeTestRunner'

# ══════════════════════════════════════════════════════════════════
# OAUTH
# ══════════════════════════════════════════════════════════════════

GOOGLE_CLIENT_ID = env('GOOGLE_CLIENT_ID', default='')
# Not yet in .env — Facebook app hasn't been created yet. Reading these
# with a blank default means apps/users/oauth/facebook.py fails
# predictably (OAuthVerificationError: "not configured") rather than
# with a KeyError, until they're added.
FACEBOOK_APP_ID = env('FACEBOOK_APP_ID', default='')
FACEBOOK_APP_SECRET = env('FACEBOOK_APP_SECRET', default='')

# ══════════════════════════════════════════════════════════════════
# CLOUDINARY
# ══════════════════════════════════════════════════════════════════

cloudinary.config(
    cloud_name=env('CLOUDINARY_CLOUD_NAME', default=''),
    api_key=env('CLOUDINARY_API_KEY', default=''),
    api_secret=env('CLOUDINARY_API_SECRET', default=''),
)

# ══════════════════════════════════════════════════════════════════
# AI (Groq) — not used by apps.users, read here for when other modules need it
# ══════════════════════════════════════════════════════════════════

GROQ_API_KEY = env('GROQ_API_KEY', default='')
GROQ_MODEL_FAST = 'openai/gpt-oss-20b'
GROQ_MODEL_QUALITY = 'llama-3.3-70b-versatile'
# apps.invoices' AI-seeded design classification (Step 9, core/ai.py +
# apps/invoices/ai_design.py) is the first real Groq consumer in this
# project. Read from env with the real POC-tested model as the default —
# note this is NOT actually "the same pattern as GROQ_MODEL_FAST/QUALITY"
# above (checked directly: those two are plain hardcoded strings, not env
# reads, despite the sibling naming suggesting otherwise) — env-overridable
# felt like the right call for a model id that Groq could deprecate out
# from under a hardcoded string; not silently changing FAST/QUALITY to
# match, since that wasn't asked for here.
GROQ_MODEL_VISION = env('GROQ_MODEL_VISION', default='qwen/qwen3.6-27b')

# ══════════════════════════════════════════════════════════════════
# CELERY / CHANNELS
# ══════════════════════════════════════════════════════════════════

CELERY_BROKER_URL = env('CELERY_BROKER_URL', default='redis://localhost:6379/0')
CELERY_RESULT_BACKEND = env('CELERY_RESULT_BACKEND', default='redis://localhost:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'Asia/Karachi'

# `manage.py test` never has a real worker consuming the broker, so any
# .delay() call (e.g. apps.invoices.tasks.render_and_store_invoice_pdf,
# fired from _finalise_invoice — item 15 of the verification pass) would
# otherwise just queue silently and never run, breaking every test that
# asserts on its result. Standard Django+Celery testing practice — task
# code still runs through the exact same shared_task machinery, just
# synchronously and in-process; production is untouched, since this is
# gated on the test runner actually being invoked, not an env flag
# someone could leave on by accident.
#
# Deliberately NOT also setting CELERY_TASK_EAGER_PROPAGATES: that flag
# changes .apply()'s own behavior too (not just eager .delay()), and
# apps/payments/tests.py's test_fetch_retries_on_request_failure already
# relies on the default (False) — a task's exception, once self.retry()
# exhausts its max_retries and re-raises, must land in the returned
# EagerResult (result.result / result.successful()) rather than
# propagating out of .apply() itself. Confirmed directly: turning this on
# breaks that pre-existing, deliberately-designed test.
if 'test' in sys.argv:
    CELERY_TASK_ALWAYS_EAGER = True

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.pubsub.RedisPubSubChannelLayer',
        'CONFIG': {
            'hosts': [env('CHANNEL_LAYER_URL', default='redis://localhost:6379/1')],
        },
    },
}

# ══════════════════════════════════════════════════════════════════
# TOKEN LIFETIMES — apps/users/tokens.py reads these
# ══════════════════════════════════════════════════════════════════

PASSWORD_RESET_TIMEOUT = 3600        # 1 hour
EMAIL_VERIFICATION_TIMEOUT = 86400   # 24 hours
EMAIL_CHANGE_TIMEOUT = 86400         # 24 hours

# ══════════════════════════════════════════════════════════════════
# OBSERVABILITY
# ══════════════════════════════════════════════════════════════════

SENTRY_DSN = env('SENTRY_DSN', default='')

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {'format': '{asctime} [{levelname}] {name}: {message}', 'style': '{'},
    },
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'verbose'},
    },
    'root': {'handlers': ['console'], 'level': 'INFO'},
    'loggers': {
        'django': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
    },
}