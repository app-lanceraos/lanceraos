# Dockerfile
#
# ONE image for all three Railway application services (web / worker / beat).
# Only the start command differs per service (see railway/*.json). The image
# is backend-only: the React app is built and served by Vercel, so frontend/
# and admin-frontend/ are excluded by .dockerignore.

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# WeasyPrint 69 on Debian (list from WeasyPrint's "First Steps" page for
# Debian >= 11, wheels install): Pango + HarfBuzz subsetting. Pango >= 1.44 is
# required; Debian's is newer.
# - fontconfig + fonts-dejavu-core: Pango needs at least one system font for
#   fallback glyphs (the invoice fonts themselves are loaded from file://).
# - tzdata: config/settings.py sets TIME_ZONE='Asia/Karachi' with USE_TZ=False.
#   Django exports that as the process TZ; without /usr/share/zoneinfo libc
#   silently falls back to UTC and every "today"/due-date/overdue calculation
#   is wrong for 5 hours a day. Installed explicitly rather than trusting the
#   base image to keep shipping it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libharfbuzz-subset0 \
        fontconfig \
        fonts-dejavu-core \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 app
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY --chown=app:app . .
USER app

# collectstatic imports config.settings, which refuses to load without
# SECRET_KEY (>= 50 chars), ENCRYPTION_KEY, BLIND_INDEX_KEY and the DB_* names.
# These are throwaway values scoped to this single RUN: they are not ENV, so
# they are not baked into the image. collectstatic never opens a DB connection.
RUN SECRET_KEY=build-only-throwaway-key-build-only-throwaway-key-0123456789 \
    ENCRYPTION_KEY=MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA= \
    BLIND_INDEX_KEY=build-only-throwaway \
    DB_NAME=build DB_USER=build DB_PASSWORD=build \
    DEBUG=False \
    python manage.py collectstatic --noinput

# Default = the web service. worker/beat override this per service.
# `sh -c` so ${PORT} (injected by Railway) is expanded; exec-form CMD would
# pass the literal string.
CMD ["sh", "-c", "daphne -b 0.0.0.0 -p ${PORT:-8000} config.asgi:application"]
