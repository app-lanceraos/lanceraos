# DEPLOYMENT.md

Owner's runbook for putting LanceraOS on the internet. Written 31 October 2026 by the
"Deployment Foundation" pass, which could prepare and test the code but **could not deploy**
and **had no Docker on its machine**. Every step is tagged:

- **[V]** verified by the pass that wrote this (command run, output seen).
- **[D]** from provider docs fetched during that pass (may have changed since — if the UI looks
  different, trust the UI and fix this file).
- **[U]** written from general knowledge, NOT verified against a current provider doc or a real run.
  Read these with extra suspicion.

## 0. Target architecture (decided, don't re-litigate)

| Piece | Where | Hostname |
|---|---|---|
| React app | Vercel (project root = `frontend/`) | `https://lanceraos.com` |
| API + WebSockets (`web`) | Railway, Daphne | `https://api.lanceraos.com` |
| Background tasks (`worker`) | Railway, Celery | none (private) |
| Scheduler (`beat`) | Railway, Celery Beat | none (private) |
| Postgres 17, Redis | Railway managed plugins | private network |
| DNS | Cloudflare, **DNS-only (grey cloud)** for product hostnames | |

Why one registrable domain matters: the login cookies are `httpOnly`, `SameSite=Lax`,
`Secure`, with `Domain=.lanceraos.com`. Lax cookies are only sent cross-origin between
**same-site** hosts, so `lanceraos.com` -> `api.lanceraos.com` works. The default
`*.vercel.app` / `*.up.railway.app` URLs are different sites: login would fail in Safari.
Never test login against them.

Why DNS-only (not proxied): see Appendix B — a Cloudflare proxy hop would make every user
share Cloudflare's IP in the app's rate limiting and audit log.

## 1. Order of operations

1. Cloudflare: make sure the domain's nameservers point at Cloudflare (domain is registered at
   Hostinger; change the nameservers there to the two Cloudflare gives you). **[U]**
2. Railway: project, Postgres, Redis, three services, variables. Deploy `web` first.
3. Cloudflare: `api` CNAME to Railway's target; wait for Railway to show the domain "issued".
4. Vercel: project, env vars, deploy, attach `lanceraos.com`.
5. Resend, Google OAuth, Cloudinary settings.
6. Smoke tests (section 8).
7. Run Appendix A (prefork PDF worker on Linux) and Appendix B (client IP) before inviting anyone.

## 2. Secrets to generate (keep them in a password manager — losing two of them is unrecoverable)

```bash
# SECRET_KEY (>= 50 chars; settings.py refuses to start otherwise)
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
# ENCRYPTION_KEY (Fernet)
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# BLIND_INDEX_KEY
python -c "import secrets; print(secrets.token_hex(32))"
# CLOUDFLARE_WEBHOOK_SECRET
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

**ENCRYPTION_KEY and BLIND_INDEX_KEY must never change after the first real user saves a CNIC/NTN/
PSEB number or SMTP password.** A new key makes every existing encrypted value unreadable and
breaks the uniqueness index. Use *new* keys for production; do not reuse your dev `.env` values
(your dev database won't be migrated to production, so nothing needs to decrypt with them).

## 3. Railway **[D]/[U]**

### 3.1 Project and plugins
1. New project -> add **PostgreSQL** and **Redis** from the database templates. Confirm the
   Postgres major version is 17 (CLAUDE.md's choice); if Railway's template gives a different
   major, it still works with this code (Django 5.2 supports 14-17+), but note it. **[U]**
2. Add three services from the same GitHub repo, named exactly `web`, `worker`, `beat`.

### 3.2 Per-service configuration files
Config-as-code files live in `railway/`. In each service: **Settings -> Config-as-code -> path**
(absolute from the repo root): **[D]**

| Service | Config file path |
|---|---|
| web | `/railway/web.json` |
| worker | `/railway/worker.json` |
| beat | `/railway/beat.json` |

They set: build with the repo `Dockerfile`; the start command; and (web only) the pre-deploy
command `python manage.py migrate --noinput` and health check `/api/health/`. Pre-deploy runs
**only on web** so three services never race to migrate.

> **Heads-up [D]:** Railway's docs now mark config-as-code as deprecated in favour of
> "Infrastructure as Code"; existing files keep working "until 2026-12-01" for legacy
> services. If `railway/*.json` stops being honoured, set the same values by hand in each
> service's Settings (build: Dockerfile; start command / pre-deploy / health check as in the
> JSON files). Nothing else in the repo depends on these files.
>
> **Unverified [U]:** whether a leading `/` in the path resolves from the repo root (the docs
> say "absolute path"; community answers disagree). The deploy build log states which config
> file was used — check it says `railway/web.json`, not defaults.

Start commands (identical to the JSON files, in case you set them manually):

```
web:    sh -c 'daphne -b 0.0.0.0 -p ${PORT:-8000} config.asgi:application'
worker: celery -A config worker -l info --pool=prefork --concurrency=2 --max-tasks-per-child=50
beat:   celery -A config beat -l info --schedule /tmp/celerybeat-schedule
```

Choices explained: `--concurrency=2` because the default is "number of CPUs", and a container
can report the *host's* CPU count (dozens), each prefork child importing WeasyPrint's native
libraries. `--max-tasks-per-child=50` recycles children to cap memory growth from PDF rendering.
Beat uses the default `PersistentScheduler`; its state file lives in `/tmp` and is lost when the
container restarts, which means **a daily task is skipped if beat was down at its exact minute**.
All scheduled tasks are idempotent, so you can trigger a missed one by hand (section 7).
**Never run more than one beat instance** — duplicates fire every task twice.

Do **not** use `daphne --proxy-headers`: Daphne's parser takes the *leftmost* (client-controlled)
`X-Forwarded-For` entry, and the app already reads the header itself **[V]** (Appendix B).

### 3.3 Variables
Use Railway "reference variables" (`${{Postgres.PGHOST}}`) so credentials aren't copied by hand.
Set the common ones as **shared variables** and attach to all three services; `web` needs a few
more. "W/K/B" = needed by web / worker / beat. Everything is read by `config/settings.py`
(**[V]**: `.env.example` and the `env()` calls in `settings.py` were diffed and match exactly).

| Variable | Production value | W | K | B |
|---|---|---|---|---|
| `DEBUG` | `False` | x | x | x |
| `SECRET_KEY` | generated (section 2) | x | x | x |
| `ALLOWED_HOSTS` | `api.lanceraos.com,healthcheck.railway.app` | x | x | x |
| `DB_NAME` | `${{Postgres.PGDATABASE}}` | x | x | x |
| `DB_USER` | `${{Postgres.PGUSER}}` | x | x | x |
| `DB_PASSWORD` | `${{Postgres.PGPASSWORD}}` | x | x | x |
| `DB_HOST` | `${{Postgres.PGHOST}}` | x | x | x |
| `DB_PORT` | `${{Postgres.PGPORT}}` | x | x | x |
| `REDIS_URL` | `${{Redis.REDIS_URL}}/1` | x | x | x |
| `CELERY_BROKER_URL` | `${{Redis.REDIS_URL}}/0` | x | x | x |
| `CELERY_RESULT_BACKEND` | `${{Redis.REDIS_URL}}/0` | x | x | x |
| `CHANNEL_LAYER_URL` | `${{Redis.REDIS_URL}}/2` | x | x | x |
| `FRONTEND_URL` | `https://lanceraos.com` | x | x | x |
| `COOKIE_DOMAIN` | `.lanceraos.com` | x | x | x |
| `COOKIE_SECURE` | `True` | x | x | x |
| `COOKIE_SAMESITE` | `Lax` | x | x | x |
| `CORS_ALLOWED_ORIGINS` | `https://lanceraos.com` | x | | |
| `CSRF_TRUSTED_ORIGINS` | `https://lanceraos.com` | x | | |
| `ENCRYPTION_KEY` | generated | x | x | x |
| `BLIND_INDEX_KEY` | generated | x | x | x |
| `RESEND_API_KEY` | from Resend | x | x | x |
| `DEFAULT_FROM_EMAIL` | `LanceraOS <noreply@lanceraos.com>` | x | x | x |
| `RESEND_FROM_NAME` | `LanceraOS` | x | x | x |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | from Cloudinary | x | x | x |
| `GOOGLE_CLIENT_ID` | same as frontend `VITE_GOOGLE_CLIENT_ID` | x | | |
| `FACEBOOK_APP_ID` / `_SECRET` | leave blank (app not created) | | | |
| `GROQ_API_KEY` | from Groq | x | x | |
| `CLOUDFLARE_WEBHOOK_SECRET` | generated | x | | |
| `SECURE_HSTS_SECONDS` | omit (default 3600); raise per section 10 | x | | |
| `SENTRY_DSN` | leave blank — nothing reads it yet | | | |

Why `/0` `/1` `/2`: cache, broker and Channels layer would otherwise share Redis database 0, and
any `cache.clear()` would flush queued Celery tasks. `healthcheck.railway.app` in
`ALLOWED_HOSTS` **[V]**: Django returns **400** for a Host not in the list (tested, including on
`/api/health/`), and Railway documents that its probe uses that hostname **[D]**.

> Why `worker` and `beat` need `ALLOWED_HOSTS`/`COOKIE_*`/`CORS_*`: they import the same
> `config.settings` (e.g. `FRONTEND_URL` builds the links inside emails sent from tasks), so
> sharing one variable set is simpler and safer than tracking exactly which are unused.

### 3.4 Public domain
Only `web` gets a public domain: Settings -> Networking -> Custom Domain -> `api.lanceraos.com`.
Railway shows a CNAME target (and possibly a verification TXT) to create in Cloudflare **[U]**.
Do **not** generate a `*.up.railway.app` domain for `worker`/`beat`.

> The container must be reachable only through Railway's proxy. `config/settings.py` trusts
> `X-Forwarded-Proto` from whoever connects (`SECURE_PROXY_SSL_HEADER`); never expose the
> container port any other way.

## 4. Cloudflare DNS **[U]**

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `api` | the target Railway shows | **DNS only (grey)** |
| A / CNAME | `@` | the value Vercel shows when you add the domain | **DNS only (grey)** |
| CNAME | `www` | Vercel's value (and set `www` -> apex redirect in Vercel) | **DNS only (grey)** |
| (various) | as Resend shows | SPF / DKIM / return-path records | DNS only (Cloudflare forces this for TXT/MX anyway) |

Keep these grey even though Cloudflare offers to proxy: Railway and Vercel issue their own TLS
certificates and expect to see the real client. Leave Cloudflare's SSL mode alone (irrelevant
when DNS-only). Cloudflare Email Routing for `reply+<token>@lanceraos.com` (inbound invoice
replies) is separate and optional for the demo; when you set it up, its Worker must send the
header `X-Webhook-Secret: <CLOUDFLARE_WEBHOOK_SECRET>` to `POST /api/invoices/email/incoming/`.

## 5. Vercel **[U]** (rewrite behaviour is documented; the rest is the standard Vite setup)

1. Import the GitHub repo. **Root Directory: `frontend`**. Framework preset: Vite.
   Build `npm run build`, output `dist`, Node 24 (project standard).
2. Environment variables (Production). They are baked in **at build time**: change one -> redeploy.

   | Name | Value |
   |---|---|
   | `VITE_API_URL` | `https://api.lanceraos.com` |
   | `VITE_WS_URL` | `wss://api.lanceraos.com` |
   | `VITE_GOOGLE_CLIENT_ID` | your Google OAuth client ID |
   | `VITE_FACEBOOK_APP_ID` | blank |

   **Set these before the first build.** If `VITE_API_URL` is missing, `src/lib/api.js` silently
   falls back to `http://localhost:8000/api` (and `useWebSocket.js` to `ws://localhost:8000`) and
   the site "loads" but nothing works. **[V]**: a build with the four values above contains zero
   `localhost` strings and exactly one `wss://api.lanceraos.com`.
3. `frontend/vercel.json` rewrites every path to `/index.html` so `/invoice/<token>`,
   `/portal/...`, `/reset-password/...` and `/verify-email/...` work on a direct visit or refresh.
   Vercel serves real files (JS/CSS/images, `design-previews/*.png`) before applying rewrites. **[D/U]**
4. Add domain `lanceraos.com` (and `www.lanceraos.com`, redirect to apex).
5. `frontend/viteset.config.js` is dead (nothing references it and Vite/Vitest don't load that
   filename; `vite.config.js` already holds the test config). Left in place, untouched.
6. Build prints a >500 kB chunk warning (one 1.19 MB JS file) and a dynamic/static import warning
   about `authStore.js`. Both pre-existing, neither breaks anything. **[V]**

## 6. Third-party consoles

**Resend [U]:** Domains -> add `lanceraos.com` -> create the DNS records it lists in Cloudflare
-> wait for "Verified". Until then every email (verification, password reset, 2FA) fails; the
send path logs the error but registration will appear to work.

**Google Cloud OAuth [U]:** APIs & Services -> Credentials -> your Web client -> *Authorised
JavaScript origins*: add `https://lanceraos.com`. (Keep `http://localhost:5173` for dev.) The app
uses `@react-oauth/google`; if sign-in later asks for a redirect URI, the error message names the
exact one to add. Also check the OAuth consent screen's publishing status — a project left in
"Testing" only lets listed test users sign in, which would break a live demo.

**Cloudinary [D from this repo's own history]:** the dev account once had *Settings -> Security ->
"Restricted media types"* blocking PDF/raw delivery, which made stored invoice PDFs return 401
(DECISIONS.md, 11 August 2026; later fixed by the owner on the dev account, 19 August 2026). The
code works around it (`fetch_invoice_pdf_bytes` falls back to re-render), but it costs speed and
risks the invoice drifting from what was sent. **If production uses a different Cloudinary
account, check that same setting before launch**, and confirm with the PDF smoke test below that
`Invoice.pdf_url` opens in an incognito tab.

## 7. First deploy checklist

- [ ] All variables in 3.3 set; `ENCRYPTION_KEY`/`BLIND_INDEX_KEY` saved off-platform.
- [ ] `web` deployed; build log shows `railway/web.json` honoured and the pre-deploy `migrate` ran.
- [ ] `https://api.lanceraos.com/api/health/` returns `{"status":"ok"}`.
- [ ] `worker` and `beat` deployed; worker log shows `celery@... ready`, beat log shows `beat: Starting...`.
- [ ] Create a superuser for Django admin (and the app's admin panel if wanted): Railway ->
      `web` -> shell/`railway run`: `python manage.py createsuperuser`. **[U]**
- [ ] Vercel deployed with env vars set *before* the build.
- [ ] Section 8 smoke tests pass.
- [ ] Appendix A and B done.
- [ ] Trigger a missed/first scheduled task by hand if needed (from a `worker` shell):
      `python manage.py shell -c "from apps.payments.tasks import fetch_exchange_rates; fetch_exchange_rates.delay()"`
      (exchange rates must exist before invoices in non-USD currencies convert).

## 8. Smoke tests (run in order; stop at the first failure)

1. **Health:** `curl -i https://api.lanceraos.com/api/health/` -> `200 {"status":"ok"}`. Plain
   `curl -i http://api.lanceraos.com/api/auth/csrf/` -> `301` to https; the health URL over
   plain http -> `200` (exempt on purpose).
2. **No redirect loop:** `curl -sI https://api.lanceraos.com/api/auth/csrf/` -> `200`, header
   `Strict-Transport-Security: max-age=3600; includeSubDomains`.
3. **Static:** `curl -sI https://api.lanceraos.com/static/admin/css/base.css` -> `200`.
   Browse `https://api.lanceraos.com/admin/` -> styled login page.
4. **Register + verify email:** at `https://lanceraos.com/register` create an account with a real
   inbox; the email arrives from `noreply@lanceraos.com`; the link opens the *frontend* domain and
   verifies.
5. **Login + cookie flags:** log in; DevTools -> Application -> Cookies. The access/refresh
   cookies must show `HttpOnly`, `Secure`, `SameSite=Lax`, **Domain `.lanceraos.com`**; `csrftoken`
   `Secure` too. Reload: you stay logged in. (If you're bounced to login, `COOKIE_DOMAIN`,
   `CORS_ALLOWED_ORIGINS` or `CSRF_TRUSTED_ORIGINS` is wrong.)
6. **WebSocket:** open the notification bell, DevTools -> Network -> WS: a `wss://api.lanceraos.com/ws/notifications/`
   connection with status 101. In the Console: `new WebSocket('wss://api.lanceraos.com/ws/echo/')`
   from `https://lanceraos.com` opens; the same line typed on `https://example.com` is refused
   (**[V]** locally: only the exact origin `https://lanceraos.com` was accepted).
7. **Invoice PDF:** create a client + invoice, **Finalise**. Within ~10 s the PDF appears
   (Download works; if it only works after a long wait, the worker isn't running). Check
   `Invoice.pdf_url` opens in an incognito window (Cloudinary note in section 6). Open the
   invoice in a second browser as the client via "View Invoice": PDF displays.
8. **Celery task ran:** the worker log shows `render_and_store_invoice_pdf ... succeeded`.
9. **Beat fires:** with the worker running, in beat's log find `Scheduler: Sending due task`
   at the next quarter-hour (`notify-unread-comments-every-15-minutes`), and a matching
   `succeeded` in the worker log.
10. **Timezone is PKT:** from a `web` shell:
    `python -c "import os,django;os.environ['DJANGO_SETTINGS_MODULE']='config.settings';django.setup();import datetime;print(datetime.datetime.now(), datetime.datetime.utcnow())"`
    -> the two values differ by exactly 5 hours. If they're equal, `tzdata` is missing from the
    image and every due-date/overdue calculation is wrong for 5 hours a day.
11. **Probe doesn't spam the log:** after 10 minutes, `ApiRequestLog.objects.filter(path='/api/health/').count()` is `0`.

## 9. Rollback

- **Bad code:** Railway -> service -> Deployments -> previous deployment -> Redeploy. Do web,
  worker, beat together.
- **Bad migration:** the pre-deploy `migrate` is not reversible by redeploying. Before any
  deploy containing a migration, take a Postgres backup (Railway Postgres -> Backups, or
  `pg_dump` via the public proxy URL). To undo: restore the backup *and* redeploy the old code.
- **Bad frontend:** Vercel -> Deployments -> previous -> *Promote to Production*.
- **Bad env var:** change it back; Railway redeploys. A wrong `ENCRYPTION_KEY` is the one thing
  that cannot be "changed back" after data was written with another — restore the original.
- **HSTS regret:** if HTTPS breaks while HSTS is on, browsers refuse plain HTTP until
  max-age expires. That's why it starts at one hour.

## 10. Raising HSTS

`SECURE_HSTS_SECONDS` defaults to **3600**. Once the smoke tests pass and you've used the site
over HTTPS for a few days without certificate problems, raise it one step per week:
`86400` (1 day) -> `2592000` (30 days) -> `31536000` (1 year). Change the variable on `web`,
redeploy, confirm the header. Leave `SECURE_HSTS_INCLUDE_SUBDOMAINS=True` (it only covers
`*.api.lanceraos.com`, which doesn't exist). Leave `SECURE_HSTS_PRELOAD` **unset** unless you
deliberately want the browser preload list: removal takes months, and `lanceraos.com` itself
isn't served by this header anyway. For a university demo, 86400 is plenty.

---

## Appendix A — verify the Linux PDF stack (closes PERF-001; **NOT yet done**)

**Status: not verified.** The pass that wrote this had no Docker. `CLAUDE.md` Section 8c's belief
that Celery's prefork pool doesn't segfault on Linux (as it does on macOS with WeasyPrint's
Pango/Cairo libraries) is therefore still an expectation. Run this once, either locally with
Docker or on Railway staging.

**With Docker (local):**
```bash
docker build -t lanceraos .                       # also proves the apt package list + collectstatic RUN
# Postgres + Redis for the test (any reachable ones; adjust hosts)
docker run -d --name lpg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=lancera -p 55432:5432 postgres:17
docker run -d --name lrd -p 56379:6379 redis:8
export E="-e DEBUG=True -e SECRET_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(60))') \
 -e ENCRYPTION_KEY=$(python3 -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())') \
 -e BLIND_INDEX_KEY=$(python3 -c 'import secrets;print(secrets.token_hex(32))') \
 -e DB_NAME=lancera -e DB_USER=postgres -e DB_PASSWORD=pw -e DB_HOST=host.docker.internal -e DB_PORT=55432 \
 -e REDIS_URL=redis://host.docker.internal:56379/1 -e CELERY_BROKER_URL=redis://host.docker.internal:56379/0 \
 -e CELERY_RESULT_BACKEND=redis://host.docker.internal:56379/0 -e CHANNEL_LAYER_URL=redis://host.docker.internal:56379/2"

# 1. Timezone: expect the two timestamps 5 hours apart
docker run --rm $E lanceraos python -c "import os,django;os.environ['DJANGO_SETTINGS_MODULE']='config.settings';django.setup();import datetime;print(datetime.datetime.now(), datetime.datetime.utcnow())"

# 2. Migrate, then render all template previews through the real render_invoice_pdf (single process)
docker run --rm $E lanceraos sh -c "python manage.py migrate --noinput && python manage.py generate_template_previews"

# 3. Prefork worker, concurrency 2 (exactly the production command)
docker run -d --name lw $E lanceraos celery -A config worker -l info --pool=prefork --concurrency=2 --max-tasks-per-child=50
# 4. Queue 12 renders back to back. (Needs finalised invoices: create a user + invoices via the app
#    against this DB, or loop over a restored copy of your dev data.) Cloudinary upload will fail
#    without credentials - acceptable; the *render* is what is under test.
docker run --rm $E lanceraos python manage.py shell -c "
from apps.invoices.models import Invoice
from apps.invoices.tasks import render_and_store_invoice_pdf
ids=list(Invoice.objects.exclude(status='draft').values_list('pk',flat=True)[:12])
print(len(ids),'invoices');[render_and_store_invoice_pdf.delay(str(i)) for i in ids]"
```
**Pass criteria** (report each): (a) `docker logs lw` shows at least 12 `weasyprint.progress: Step 7`
lines; (b) **zero** occurrences of `WorkerLostError`, `SIGSEGV`, `signal 11`; (c) the worker is
still `ready` and the container never restarted (`docker inspect -f '{{.RestartCount}}' lw` = 0);
(d) fonts embedded - in the container:
```bash
docker exec lw python -c "
import os,django;os.environ['DJANGO_SETTINGS_MODULE']='config.settings';django.setup()
import fitz
from apps.invoices.models import Invoice
from apps.invoices.pdf_generator import render_invoice_pdf
inv=Invoice.objects.exclude(status='draft').first()
doc=fitz.open(stream=render_invoice_pdf(inv),filetype='pdf')
print({f[3] for p in doc for f in p.get_fonts()})"
```
expect names containing `IBMPlex`/`SourceSerif`/`SpaceGrotesk`, not only a fallback like `DejaVu`.
Repeat (3)-(4) with `--concurrency=4` for a harder test.

**On Railway staging instead:** deploy `worker` as configured, finalise 12 invoices in quick
succession through the UI (or one script), and check the same criteria in the worker's logs and
that each invoice gets a `pdf_url`. Then record the result in CLAUDE.md Section 8c.

**If prefork crashes on Linux:** change `railway/worker.json`'s start command to `--pool=solo`
(or `--pool=threads --concurrency=2`), redeploy, re-test, and update Section 8c.

## Appendix B — client IP behind Railway (**NOT yet verified**)

Rate limits, lockouts and the audit trail all use `core.observability.get_client_ip`, which takes
the **last** `X-Forwarded-For` entry. That is correct if Railway's edge **appends** the real
client address (and is the only hop that does). Railway's own forum answers contradict each other
on whether the edge appends, replaces or strips a client-supplied header, and several users
report edge IPs appearing in these headers. Nothing in this repo can settle that; only a request
through the real edge can.

What **was** verified locally **[V]**: given `X-Forwarded-For: 9.9.9.9, 203.0.113.77`, the app
logs `203.0.113.77` (client-injected leading entries are ignored), identically with and without
`daphne --proxy-headers`; `core/tests/test_client_ip.py` pins this.

**Do this once after the first deploy:** from your own machine run
`curl -s -H 'X-Forwarded-For: 1.2.3.4' https://api.lanceraos.com/api/auth/csrf/ -o /dev/null`,
then in a `web` shell read the newest `ApiRequestLog` row for `/api/auth/csrf/`
(`.latest('created_at').ip_address`). Compare with `curl -s https://ifconfig.me`.
- Equals your real public IP -> correct, nothing to do.
- Equals `1.2.3.4` -> Railway doesn't append; attackers can spoof IPs and evade rate limits.
  Change `get_client_ip` to read the header Railway documents as authoritative (e.g. `X-Real-IP`).
- Equals an address that is the same from your phone on mobile data -> a shared edge/proxy IP:
  every user would share one rate-limit bucket. Same fix: use the authoritative header.
Repeat from a second network (phone, mobile data) to confirm two clients differ.

## Appendix C — known limitations of this setup

- **Docker image never built here** (no Docker on the authoring machine): the apt package
  list comes from WeasyPrint's current Debian instructions **[D]**; the `collectstatic` build
  step was reproduced from a clean copy without `.env` **[V]**; `apt-get`, the user/permissions
  and the final `CMD` are **[U]** until Appendix A's `docker build` succeeds.
- Beat state is not persisted across restarts (see 3.2).
- `SENTRY_DSN` is read but nothing initialises Sentry: no error monitoring until someone adds
  `sentry-sdk`.
- Railway's config-as-code is deprecated (3.2).
