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
#   last-resort glyph fallback (the bundled invoice fonts are loaded from file://).
# - fonts-liberation: 10 of the 11 invoice templates checked set their body text
#   in a system font stack ('-apple-system, BlinkMacSystemFont, "Segoe UI", Arial,
#   sans-serif') instead of a bundled font. On a Mac or Windows PC that resolves to
#   a real Helvetica/Arial-class font; on slim Debian, with only DejaVu installed,
#   it silently resolved to DejaVu Sans, whose letters are visibly wider, so line
#   and page breaks differed from the gallery previews. Liberation Sans is
#   metric-compatible with Arial (same glyph widths), and fontconfig's built-in
#   aliases map Arial/Helvetica to it, so the PDFs lay out as designed.
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
        fonts-liberation \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

# /app/beat-data: where Celery Beat keeps its "when did each task last run" file.
# docker-compose.yml mounts a named volume here. A named volume is created
# root-owned unless the image already contains the directory owned by the
# user, in which case Docker copies that ownership onto the new volume - so
# creating it here, as app, is what lets the non-root beat process write to it
# (a volume mounted at a path the image lacks gives "Permission denied").
RUN useradd --create-home --uid 1000 app \
    && mkdir /app /app/beat-data \
    && chown app:app /app /app/beat-data
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
