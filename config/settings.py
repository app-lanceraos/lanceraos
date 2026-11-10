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

# WhiteNoise serves /static/ straight from the container (Django admin CSS/JS
# and the invoice fonts) — no separate static host or CDN to provision.
#
# CompressedStaticFilesStorage, NOT CompressedManifestStaticFilesStorage, on
# purpose: apps/invoices/pdf_generator.py calls static('invoices/fonts/...')
# at MODULE IMPORT time (PORTAL_FONT_CONTEXT). The manifest variant raises
# ValueError from static() for any file missing from staticfiles.json, so
# every process that imports that module (web, the Celery worker, beat, and
# the test suite) would crash at import unless collectstatic had already run
# in that exact environment. The plain variant resolves URLs without a
# manifest; the cost is no content-hashed filenames (WhiteNoise's default
# short max-age applies instead of immutable caching), which only matters for
# a handful of admin assets and fonts.
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage'},
}

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
    'apps.proposals',
    'apps.dashboard',
    'apps.health',
    'apps.tax',  # Prompt 20: verified-only tax estimate (no models, no migration)
    # Future modules join this list as their own chats build them:
    # 'apps.contracts', 'apps.subscriptions',
    # 'apps.insights', 'apps.assistant',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    # Immediately after SecurityMiddleware, per WhiteNoise's docs, so static
    # responses still get the security headers and bypass everything below.
    'whitenoise.middleware.WhiteNoiseMiddleware',
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
# CORS / CSRF — cookie-based auth across the lanceraos.com (frontend) /
# api.lanceraos.com (backend) subdomain split
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
# Response headers a browser normally hides from cross-origin JS reads
# unless explicitly exposed. Content-Disposition specifically: InvoiceView.jsx
# (frontend/src/pages/InvoiceView.jsx) fetches invoice PDFs as a blob and
# reads this header to recover the real filename
# (portal_invoice_pdf_download's own `attachment; filename="..."` value)
# for the browser's save dialog — without this, every download would
# silently fall back to a generic "invoice.pdf". Exposing just this one,
# already-public header costs nothing security-wise.
CORS_EXPOSE_HEADERS = ['Content-Disposition']

CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
])

# Shared across lanceraos.com and api.lanceraos.com in production
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

# The platform's health probe is plain HTTP and must not be redirected to
# HTTPS (a 301 is not a 2xx, so the deploy would be marked unhealthy). Matched
# against the path with the leading slash stripped. Defined unconditionally —
# harmless while SECURE_SSL_REDIRECT is off. Keep in sync with
# core.health.HEALTH_CHECK_PATH.
SECURE_REDIRECT_EXEMPT = [r'^api/health/$']

if not DEBUG:
    SECURE_SSL_REDIRECT = True
    # Railway terminates TLS at its edge and forwards plain HTTP to the
    # container with X-Forwarded-Proto. Without this Django sees every
    # request as insecure and SECURE_SSL_REDIRECT redirects forever.
    # Trust assumption: the container is reachable ONLY through the platform
    # proxy, which sets/overwrites this header. If the service were ever
    # exposed directly, a client could forge it — so never publish the
    # container's port outside the platform.
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_CONTENT_TYPE_NOSNIFF = True
    # Env-driven with a LOW default so a first staging deploy cannot pin a
    # mistake into browsers for a year. Raise it in steps once HTTPS is proven
    # (see DEPLOYMENT.md > "Raising HSTS"). The previous hard-coded value was
    # 31536000 + preload.
    SECURE_HSTS_SECONDS = env.int('SECURE_HSTS_SECONDS', default=3600)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool('SECURE_HSTS_INCLUDE_SUBDOMAINS', default=True)
    # Preload is effectively irreversible (browsers ship the list); opt-in only.
    SECURE_HSTS_PRELOAD = env.bool('SECURE_HSTS_PRELOAD', default=False)
    if not SECURE_HSTS_PRELOAD:
        # `check --deploy` W021 nags to enable preload. Deliberately declined:
        # removal from the browser preload list takes months, so it is only
        # worth enabling after HSTS has run at a long max-age for a while.
        SILENCED_SYSTEM_CHECKS = ['security.W021']
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
# AI (Groq) — only core/ai.py talks to Groq; features call core.ai.run_ai_task
# ══════════════════════════════════════════════════════════════════
# No product feature calls Groq yet (the only earlier consumer, the AI-seeded
# invoice design classifier, was removed with the free-canvas editor on
# 12 September 2026). core/ai.py is the foundation the upcoming features
# (Proposals, Dashboard insights, Health tips, Tax guidance, Contracts, Help)
# will reuse — see DECISIONS.md, 02 November 2026.

GROQ_API_KEY = env('GROQ_API_KEY', default='')
# Phase 0 (06 September 2026): all three model ids are env-readable, fixing a
# real asymmetry (FAST/QUALITY were hardcoded while only VISION was env()-read)
# — a model id is exactly the kind of value Groq can deprecate out from under
# a hardcoded string with no code change possible. Each is env-overridable,
# with the current best-known-live model as the default.
#
# GROQ_MODEL_QUALITY's default changed in that pass — its old hardcoded
# value, 'llama-3.3-70b-versatile', was already DEAD (Groq shut it down
# 16 August 2026, per console.groq.com/docs/deprecations, found by checking
# live GroqCloud status rather than trusting this file's own prior claim —
# see DECISIONS.md). Replaced with 'openai/gpt-oss-120b', Groq's own listed
# migration target for that deprecation. Run `manage.py check_ai_models` after
# any Groq deprecation notice to catch this class of failure early.
GROQ_MODEL_FAST = env('GROQ_MODEL_FAST', default='openai/gpt-oss-20b')
GROQ_MODEL_QUALITY = env('GROQ_MODEL_QUALITY', default='openai/gpt-oss-120b')
# GROQ_MODEL_VISION is used by NO feature today. It is kept because the env
# var and the docs reference it and it is the one vision-capable model that
# was live-tested (06 September 2026, see DECISIONS.md): 'qwen/qwen3.8-27b'
# replaced 'qwen/qwen3.6-27b', which Groq decommissions on 14 September 2026.
GROQ_MODEL_VISION = env('GROQ_MODEL_VISION', default='qwen/qwen3.8-27b')

# Runtime limits for core/ai.py (02 November 2026). Defaults come from live
# measurements on the free tier (DECISIONS.md): a 3000-token completion takes
# about 7 s, so a 25 s per-attempt timeout is generous, and the production
# worker is `--pool=solo` (ONE Celery task at a time), so the whole call —
# every attempt plus every rate-limit wait — is bounded by a hard budget.
# AI_ENABLED is the kill switch: False means no network call, ever.
AI_ENABLED = env.bool('AI_ENABLED', default=True)
AI_REQUEST_TIMEOUT_SECONDS = env.int('AI_REQUEST_TIMEOUT_SECONDS', default=25)
# Hard ceiling of 60 s, enforced here AND again inside core.ai.call_groq so an
# env typo or an override_settings cannot exceed it.
AI_TOTAL_BUDGET_SECONDS = min(env.int('AI_TOTAL_BUDGET_SECONDS', default=40), 60)
# A 429 whose "try again in" wait is longer than this fails immediately
# (rate_limited) instead of sleeping inside a request or a worker slot.
AI_MAX_RETRY_WAIT_SECONDS = env.int('AI_MAX_RETRY_WAIT_SECONDS', default=8)
# Per user, per feature, per hour — protects the shared free-tier quota.
AI_RATE_LIMIT_PER_HOUR = env.int('AI_RATE_LIMIT_PER_HOUR', default=20)
# Per-feature kill switch (Prompt 09): False switches ONLY the Dashboard insights card's model calls off (the card
# still shows its fixed sentences) without touching Proposals. The global AI_ENABLED above overrides it: if either is
# off, the insights endpoint makes no model call and writes no AiCallLog row.
# DEFAULT IS False: the pre-registered live evaluation (AI_EVALUATION.md section 14) did not clear its "no claim the facts
# do not support" read for either model, so the owner decides. Set DASHBOARD_INSIGHTS_AI_ENABLED=True to turn it on.
DASHBOARD_INSIGHTS_AI_ENABLED = env.bool('DASHBOARD_INSIGHTS_AI_ENABLED', default=False)

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