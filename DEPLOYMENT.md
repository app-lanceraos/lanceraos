# DEPLOYMENT.md

Owner's runbook for putting LanceraOS on the internet. Written 31 October 2026 by the
"Deployment Foundation" pass, which could prepare and test the code but **could not deploy**
and **had no Docker on its machine**. Every step is tagged:

- **[V]** verified by the pass that wrote this (command run, output seen).
- **[D]** from provider docs fetched during that pass (may have changed since — if the UI looks
  different, trust the UI and fix this file).
- **[U]** written from general knowledge, NOT verified against a current provider doc or a real run.
  Read these with extra suspicion.

> **Update, 31 October 2026 (second pass):** Docker *was* available on this pass's machine, so the image
> was built and a Compose stack was run (on an Apple-silicon Mac). Appendix A now holds real results (for
> **arm64** Linux only), and **Appendix D** is the runbook for the interim plan: the same image on a free
> Linux VM behind a Cloudflare Tunnel, because Railway has paused new signups. Sections 3-4 and Appendix B
> describe the later Railway setup.

## 0. Target architecture (decided, don't re-litigate)

| Piece | Where | Hostname |
|---|---|---|
| React app | Vercel (project root = `frontend/`) | `https://lanceraos.com` |
| API + WebSockets (`web`) | Railway, Daphne | `https://api.lanceraos.com` |
| Background tasks (`worker`) | Railway, Celery | none (private) |
| Scheduler (`beat`) | Railway, Celery Beat | none (private) |
| Postgres 17, Redis | Railway managed plugins | private network |
| DNS | Cloudflare, **DNS-only (grey cloud)** for product hostnames | |

> **[Time-sensitive, 31 October 2026]** The "Railway" rows above are the *launch* plan. Railway disclosed a
> security incident on 21 October 2026 and paused new signups with no reopening date (see Appendix D's
> opening note for sources). Until public launch the API/worker/beat/Postgres/Redis run from `deploy/` on a
> free VM instead (Appendix D); only the hostnames and the Vercel frontend stay as in this table.

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
> "Infrastructure as Code"; existing files are honoured only "until 2026-12-01" for legacy
> services. **So the values you enter in each service's dashboard Settings are the source of truth**;
> treat `railway/*.json` as a convenience that may silently stop applying. Set the same values by hand
> (build: Dockerfile; start command / pre-deploy / health check as in the JSON files) and keep the two in
> step — when you change a start command, change both. Nothing else in the repo depends on these files.
> (Railway-specific; the interim VM stack in `deploy/` does not use them.)
>
> **Unverified [U]:** whether a leading `/` in the path resolves from the repo root (the docs
> say "absolute path"; community answers disagree). The deploy build log states which config
> file was used — check it says `railway/web.json`, not defaults.

Start commands (identical to the JSON files, in case you set them manually):

```
web:    sh -c 'daphne -b 0.0.0.0 -p ${PORT:-8000} config.asgi:application'
worker: celery -A config worker -l info --pool=solo
beat:   celery -A config beat -l info --schedule /tmp/celerybeat-schedule
```

Choices explained: the worker is `--pool=solo` (one process, no forking) — the same setting local macOS
dev needs, and now also the verified production choice: prefork was exercised on **arm64** Linux only
(Appendix A), and Railway runs **x86-64**, which is still unproven. If you later want prefork there, use
`--pool=prefork --concurrency=2 --max-tasks-per-child=50` (`--concurrency` because the default is "number
of CPUs" and a container can report the *host's* count; `--max-tasks-per-child` to cap WeasyPrint memory
growth) and run Appendix A on Railway staging first.
Beat uses the default `PersistentScheduler`. **On Railway** (this section) its state file lives in `/tmp`
and is lost when the container restarts, which means **a daily task is skipped if beat was down at its exact
minute** (and Railway has no volume for it unless you add one — D.9). **On the VM stack** the file is on a
Docker volume and survives a re-create (D.6). All scheduled tasks are idempotent, so you can trigger a
missed one by hand (section 7).
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

## 7a. Payments core release (the income ledger, 07 November 2026) **[U]**

Three migrations, applied by the normal pre-deploy `migrate` in this order (Django orders them from their dependencies):
1. `payments.0002_payment` — creates the `payments` table.
2. `invoices.0023_invoicepartialpayment_payment` — adds the nullable `payment` FK to `invoice_partial_payments`.
3. `invoices.0024_backfill_payments` — data migration: creates one `Payment` per existing allocation (rate copied, never recomputed; a
   missing non-USD rate stays missing with `rate_basis=none`), batches of 500, idempotent, reversible.

No new environment variable. **Take a Postgres backup first** (Section 9: a migration is not undone by redeploying). Deploy `web`,
`worker` and `beat` together: the old code does not know the ledger and would record invoice payments without a ledger row.

**Mandatory after the migrate step:** `python manage.py check_payment_ledger` (Railway -> `web` -> shell). It is read-only, prints
counts and at most 10 ids per problem (never amounts or names) and exits non-zero on any problem; a clean run ends with
`Payment ledger check passed.` Do not enable anything that depends on the ledger until it passes. To undo only the data step:
`python manage.py migrate invoices 0022` (clears the FK column and deletes the origin='invoice' payments; allocations stay).

## 7b. Payment import engine release (08 November 2026) **[U]**

One migration, applied by the normal pre-deploy `migrate`: `payments.0003_payment_import_engine` — additive (a defaulted `external_id` column, a nullable `import_batch` FK, the new `payment_import_batches` table, and a partial unique index on `payments`). Adding a defaulted `varchar` column is metadata-only on PostgreSQL 11+ (no table rewrite); `CREATE UNIQUE INDEX` scans the `payments` table once under a short lock, which is instant at this table's size. Existing rows have `external_id = ''`, which the partial index ignores, so it cannot fail on production data. `python manage.py sqlmigrate payments 0003` shows the exact SQL.

No new environment variable and no new service. **Run `python manage.py check_payment_ledger` afterwards** (it now also checks that an imported payment has a batch and that no manual/invoice payment carries an external id or batch). Smoke test (the Prompt 13 screens exist): sign in with a throwaway account, open **Payments**, click **Import**, choose **Wise** as where the money arrived, choose `apps/payments/sample_exports/wise_statement.csv` (synthetic), **Check the file**, confirm the rows (11 ready, a handful marked Check / May already be there / Already imported / Not income), **Import 11 payments**, then **Undo this import** and confirm. The currency snapshots for USD, EUR, GBP and PKR must exist for the dates in the file (check `ExchangeRateSnapshot`, or let the daily task run first) — a row whose currency has no snapshot at all is shown as "Can't read" and cannot be imported. The dialog is stateless and re-sends the file when you press Import, so the 2 MiB limit applies to both uploads and the per-hour limits are 20 checks, 10 imports and 10 undos per user. The 2 MiB upload cap sits under any proxy body limit (Cloudflare's default is 100 MB, Railway's is larger), so no proxy setting is needed. Undo: `python manage.py migrate payments 0002` drops the new columns and table (data in them is lost).

## 7c. Expenses ledger release (08 November 2026, Prompt 14) **[U]**

One migration, applied by the normal pre-deploy `migrate`: `payments.0004_expense` — purely additive (a new `expenses` table, one index and
one CHECK constraint on it). Nothing existing is rewritten, so it cannot fail on production data. `python manage.py sqlmigrate payments 0004`
shows the exact SQL. Undo: `python manage.py migrate payments 0003` drops the table (the expenses in it are lost).

No new environment variable and no new service. **Backend only**: the Expenses page is the next prompt, so there is no Vercel change and
nothing for a user to see yet. New endpoints, all under `/api/expenses/` and all behind login: `GET`/`POST /api/expenses/`,
`GET`/`PUT`/`DELETE /api/expenses/<id>/`, `GET /api/expenses/summary/`, `GET /api/expenses/currencies/`. Rate limits are per user and per
hour: 240 reads, 60 each of create, update and delete.

**Run `python manage.py check_payment_ledger` afterwards** (Railway -> `web` -> shell). Its "Ledger rows:" line now also counts expenses
(0 on the first deploy) and it checks that no USD expense has a rate other than 1 and that every expense's rate and rate basis agree. A
clean run still ends with `Payment ledger check passed.`

The same release refactors how the Payments income summary is computed (the loop now lives in `apps/payments/rollup.py`). Its output is
unchanged and pinned byte for byte by a test, so `GET /api/payments/summary/` and the Payments page need no check beyond the usual smoke
test. Smoke test: sign in with a throwaway account, `POST /api/expenses/` (a browser console `fetch` with the CSRF header, or the Django
shell's test client) with `{"amount": "10.00", "currency": "USD", "expense_date": "<today>", "category": "software"}`, expect 201;
`GET /api/expenses/summary/` should show `10.00` in `this_month`; `DELETE` it and expect 204.

## 7d. Expenses page release (08 November 2026, Prompt 15) **[U]**

Code only: **no migration, no environment variable, no new service, no backend change.** Redeploy the frontend (Vercel). The release also fixes two
bugs in the payment import dialog (its "Past imports" list was stale after an import or undo, and closing the dialog while an undo was running left
the Payments list stale); nothing to configure for those either. `/expenses` is a private route; the sidebar's "Expenses" item already existed and
now leads to it. The `vercel.json` SPA rewrite already covers the new path.

Smoke test: sign in, open Expenses (the sidebar item stays highlighted), Add expense (category Software and subscriptions, USD 10), check the
three headline numbers and the chart update, open the row's menu and choose Duplicate, save the copy (expect a "Possible duplicate" step because it
is dated within 3 days of the original), choose "Delete the one I just added", then delete the original from the menu. The list ends empty.

## 7e. Reports release (08 November 2026, Prompt 16) **[U]**

Backend only: **no migration, no environment variable, no new service.** Redeploy the **web** service only: the worker and beat do not render reports.
WeasyPrint is already required by the invoice PDFs, so nothing new is installed; the fonts the reports use (IBM Plex Sans, Source Serif 4) are the ones
already shipped under `apps/invoices/static/invoices/fonts/`. New endpoints (all need a signed-in user): `GET /api/payments/pnl/`,
`GET /api/payments/pnl/pdf/`, `GET /api/payments/income-certificate/` and `GET /api/payments/income-certificate/pdf/`; the two PDF routes share one
rate-limit bucket of 30 per user per hour.

One visible effect on existing screens: converted amounts are now rounded to the cent once per row before they are added up, so a card on the Payments
or Expenses page can differ by a few paisa from before (never more than 0.005 times the number of rows behind that figure). Nothing is stored
differently; only the totals shown are affected.

Smoke test: sign in, then with that session call `GET /api/payments/pnl/` (expect 200 and JSON with `income`, `expenses`, `net`) and
`GET /api/payments/pnl/pdf/` (expect 200, `Content-Type: application/pdf`, a file that opens). For the statement, record one payment dated this month first,
then `GET /api/payments/income-certificate/pdf/?purpose=bank` (expect 200); with no payment in the period it must answer 400
"You have no payments in this period, so there is nothing to put in the statement." If a PDF answers 500 "Could not create the PDF", read the
`[PDF] document_type=` log line for that `request_id`: WeasyPrint is the usual cause (see Appendix A).

## 7f. Report pages release (09 November 2026, Prompt 17) **[U]**

Frontend only (Vercel): **no migration, no environment variable, no new service, no backend change.** **Deploy the backend of 7e first**: the pages call endpoints
(`/api/payments/pnl/`, `/api/payments/income-certificate/` and their `/pdf/` routes) that do not exist before it. The sidebar item that used to read "Income
Certificate" now reads "Income Statement" (the URL `/income-certificate` is unchanged, so bookmarks keep working).

Smoke test: sign in, open **P&L** (the figures load for "This year"), then **Download PDF** (a file named `profit_and_loss_<start>_<end>.pdf` arrives and
opens; its headline totals equal the page's). Open **Income Statement**, choose **Last 12 months** and **Bank account or loan application**, then
**Download statement (PDF)** (a file arrives); with no payment in the period the page must say so and the button must be disabled with the reason instead.
Confirm the browser can read the `Content-Disposition` filename (it needs `Access-Control-Expose-Headers: Content-Disposition`, already set by
`CORS_EXPOSE_HEADERS`); if it cannot, the page falls back to its own file name and nothing breaks.

## 7g. Health Score backend release (09 November 2026, Prompt 18) **[U]**

Backend only: redeploy the **web** service. **No migration, no environment variable, no new service**; the worker and beat do not use it (there is no
task, no model and nothing stored). Two read-only endpoints are new: `GET /api/health/score/?months=3|6|12|24` and `GET /api/health/mini/`. The platform probe
`GET /api/health/` is unchanged (exact path, still not written to `ApiRequestLog`, still exempt from the HTTPS redirect). The `/health` page and the Dashboard
widget are not built yet, so nothing in the browser changes.

Smoke test: sign in, then `GET /api/health/score/?months=12` returns 200 with a `dimensions` array of length 5 and `Cache-Control: no-store`
(`score` may be `null` with a `message` for an account with few records: that is correct, not an error); `GET /api/health/score/?months=7` returns 400
`{"error": "months must be 3, 6, 12 or 24."}`; `GET /api/health/mini/` returns 200; signed out, both return 401; and `GET /api/health/` still answers the probe.

## 7h. Health Score page release (09 November 2026, Prompt 19) **[U]**

Frontend only: redeploy on **Vercel** AFTER section 7g (the backend with `GET /api/health/score/` and `/mini/` must be live first, or the page and the
Dashboard widget show their load errors). **No environment variable, no migration, no backend change, no new service.** `vercel.json`'s SPA rewrite
already serves `/health` on a direct visit or a reload.

Smoke test: sign in; the Dashboard shows a "Financial health" card with a score and a grade word, or "No score yet" for an account with few records;
the sidebar's "Health Score" opens `/health` and stays highlighted; each of the four pills (3, 6, 12, 24 months) changes the "Looking at ..." dates
line; reloading `/health` directly works; the Network tab shows `GET /api/health/mini/` on the Dashboard and `GET /api/health/score/?months=12` on the
page (React StrictMode doubles GETs in development only).

## 7i. Tax backend release (10 November 2026, Prompt 20) **[U]**

Backend only. **No migration, no environment variable, no new service, no Celery change.** `apps.tax` has no model, so `makemigrations --check` stays
clean. Redeploy the **web** service only: the worker and beat do not render PDFs and run no Tax task. Deploy this BEFORE the frontend of Prompt 21
(the Tax pages call these routes; without them they show their load errors).

The four routes (all need a login, all answer `Cache-Control: no-store`): `GET /api/tax/overview/?tax_year=2026|2027`, `GET /api/tax/law/`,
`POST /api/tax/calculator/` and `GET /api/tax/summary/pdf/?tax_year=&include_ntn=` (the PDF shares the 30 per hour bucket of the two report PDFs).
The tax law lives in `apps/tax/law.py` and `TAX_LAW.md`; a change to either is a code deploy. From 1 July 2027 the current tax year is no longer
supported and the overview answers with `stale_law: true` until `law.py` is updated: put a reminder in the calendar for June 2027.

Smoke test: sign in; `GET /api/tax/overview/` returns 200 with a `rate` object and a `monthly` array; `GET /api/tax/law/` returns 200 with eight `facts`;
`POST /api/tax/calculator/` with `{"taxable_income":"1500000"}` returns 200 with `"total_tax": "150000.00"`; `GET /api/tax/summary/pdf/?tax_year=2027`
returns 200 with `Content-Type: application/pdf` for an account with at least one payment in that tax year (400 "You have no payments in this tax
year ..." otherwise, which is correct, not an error); signed out, all four return 401.

## 7j. Tax page release (10 November 2026, Prompt 21) **[U]**

Frontend, plus ONE backend sentence. **No migration, no environment variable, no new service, no Celery change.** Prompt 21 rewords overview note 3 in
`apps/tax/copy.py` (copy only), so: (1) redeploy the **web** service first (on top of 7i; the worker and beat are unaffected); (2) then redeploy the Vercel
frontend. The page calls the four routes of 7i; without them it shows its load errors.

Smoke test: sign in; the sidebar "Tax" opens `/tax`; the three links change the view and `?view=`; the year pills switch 2026 and 2027 and the Estimate
figures equal `GET /api/tax/overview/`; the calculator with `1500000` shows total tax `PKR 150,000.00`; "How this works" lists eight facts; "Download tax
summary (PDF)" downloads a PDF that opens (a 400 with a sentence for an account with no payment in the year is correct); the third note of the estimate reads
"The estimate applies one rate, the one for your PSEB status today ..."; Settings > Tax & PSEB shows the new subtitle ("Your saved PSEB number sets the rate
in your tax estimate. ...") and no longer mentions the SRO check; reloading `/tax?view=sources` directly works (`vercel.json` already rewrites to the SPA).

## 7k. Contracts backend release (10 November 2026, Prompt 22) **[U]**

Backend only. **Back up the database first** (`pg_dump -Fc`, kept outside the repo). **ONE migration: `contracts.0001_initial`** (a new table; nothing
existing is touched). **No environment variable, no new service, no Celery Beat change.** Redeploy the **web** AND the **worker** service together: the
worker runs the new task `apps.contracts.tasks.send_signed_copies` (it renders the signed PDF and emails both sides), so a worker left on the old
image would leave signed copies queued and unsent. Beat is unaffected. Deploy this BEFORE the frontend of Prompt 23 (the Contracts pages call these routes).
The frontend's Vercel response headers for `/contract/*` (noindex, no-referrer, like `/proposal/*`) are part of Prompt 23, not this release.

The routes (the owner routes need a login; every response answers `Cache-Control: no-store`): `GET /api/contracts/templates/`, `GET/POST /api/contracts/`,
`GET/PATCH/DELETE /api/contracts/<id>/`, `POST /api/contracts/<id>/send/`, `/withdraw/`, `/duplicate/`, `GET /api/contracts/<id>/pdf/` (shares the 30 per hour
report-PDF bucket), and the public, no-login `GET /api/contracts/public/<token>/`, `POST .../sign/`, `POST .../decline/`, `GET .../pdf/` (signed contracts only,
20 per hour per IP).

Before the Contracts pages are announced publicly, a Pakistani lawyer reads `CONTRACTS_LAW.md`, `apps/contracts/clauses.py`, the signing-page wording, the
contract emails and the PDF text.

Smoke test: sign in; `GET /api/contracts/templates/` returns 5 `templates`; `POST /api/contracts/` with `{"template_key":"custom"}` returns 201 with a `draft`;
`GET /api/contracts/<id>/pdf/` returns 200 with `Content-Type: application/pdf`; fill the `[[...]]` text with PATCH, set `valid_until`, then
`POST /api/contracts/<id>/send/` with `{"method":"link","confirm":true,"signer_name":"<your name>"}` returns 200 with a `contract_number` and a `public_url`;
open that public URL's API form (`/api/contracts/public/<token>/`) in a private window with no cookies: `state` is `open`, there is no email address in it;
`POST .../sign/` with `{"signer_name":"Test Client","agree":true}` returns 200 with `state: signed`; the contract's detail shows `status: signed` and a
`signature_record`; `GET /api/contracts/public/<token>/pdf/` now returns a PDF (409 before signing); within a minute the worker log shows
`Signed copies sent for contract <id>`. Signed out, every owner route returns 401.

## 8. Smoke tests (run in order; stop at the first failure)

**Proposals release (04 November 2026).** Read this before deploying the release that adds Proposals
(the AI writer, Send, the client's public page, accept/decline, withdraw, convert to invoice):

- **Back up first:** run `deploy/backup.sh` (or Railway's own backup) *before* migrating.
- **Migrations in this release:** `core.0006_aicalllog`, `proposals.0001_initial`,
  `proposals.0002_proposal_part2_fields`. All additive; the `web` pre-deploy `migrate` applies them.
- **`GROQ_API_KEY` must be set on the `web` AND the `worker` services.** Proposal generation itself runs
  synchronously inside the request on `web`; the `worker` is given the same key so any AI call that is
  ever moved to a background task does not silently fail. No other new variable.
- **`FRONTEND_URL` must equal the public frontend origin exactly** (scheme + host, no trailing
  slash, e.g. `https://lanceraos.com`): every link a client receives — the proposal email and the
  copyable link — is built from it, and a wrong value sends clients to a page that does not exist.
- **Run `python manage.py check_ai_models`** from a `web` shell and confirm every configured model answers.
- **No new environment variable and no migration beyond the three above** in the close-out release (owner
  recognition through the refresh cookie, the PKT labels, the menu keyboard support). `evaluate_proposal_ai` is a
  development tool that spends Groq requests; it is not a deploy step.

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
12. **Proposals — create a link:** create a proposal with AI (paste a real job post of 50+ characters),
    set a valid-until date in the future, **Send** -> *Just create the link*. The proposal becomes *Sent*,
    gets a number (`PRO-YYYY-NNNN`), and a link beginning with your frontend origin appears under
    *Client link*.
13. **Proposals — the client's page:** open that link in a **private window you control** — the page
    loads with no redirect to `/login`. In DevTools -> Network select the page document and check the
    response headers for `X-Robots-Tag: noindex, nofollow, noarchive` and `Referrer-Policy: no-referrer`
    (these come from `frontend/vercel.json`; they cannot be checked locally). Use the private window for the
    client view: opened while you are signed in, the link shows you a preview and does not count as a view
    (even after the 15-minute access cookie has expired, because the long-lived refresh cookie identifies you);
    opened signed out, in a private window or on another device, it counts as your client viewing it.
13a. **Proposals — your own link stays a preview:** in the browser you are signed in with, open your own
    sent proposal's link: the blue preview banner shows. Wait 16 minutes, or delete only the `lanceraos_access`
    cookie in DevTools -> Application -> Cookies, and reload: still the preview banner, and in the app the
    proposal is still *Sent*, not *Viewed*. The refresh cookie must reach the API host (`COOKIE_DOMAIN`, as
    already required for login); if sign-in works, this works.
13b. **Proposals — a private window counts:** open the same link in a private window: no banner, Accept and
    Decline are offered, and in the app the proposal becomes *Viewed*.
14. **Proposals — email:** send a second proposal **by email** to an inbox you own. It arrives (from your
    custom SMTP if configured, else `noreply@lanceraos.com`) with a link beginning with the frontend
    origin and *not* containing the proposal text; replying goes to your own account email.
15. **Proposals — accept and convert:** in the private window, *Accept* with a short message. The page
    says *Your answer has been recorded.* In the app the proposal shows *Accepted*, the message and the
    time; **Create invoice** opens a draft invoice with the same items and totals.
16. **Proposals — withdraw:** withdraw a third proposal (*More actions* -> *Withdraw*). Its link, reloaded
    in the private window, shows *This proposal was withdrawn*.
17. **Dashboard (Module 9):** log in: you land on `/dashboard` (and `/` redirects there). *Outstanding* equals the Invoices
    page KPI strip set to **All Time**; *Paid this month* equals it set to **This Month**; the *Exchange rates* card shows
    today's date (a stale note means the 8:00 AM rate fetch missed days). Dashboard needs **no new environment variable and
    no migration** — deploying it is a code-only release (`python manage.py makemigrations --check --dry-run` reports none).
18. **Dashboard insights (Prompt 09):** one new OPTIONAL environment variable, `DASHBOARD_INSIGHTS_AI_ENABLED` (a boolean; **default
    False**, so deploying changes nothing about AI until you set it to `True`; it is independent of `AI_ENABLED` and of Proposals). No
    migration. Insights use Redis for their per-user cache (already required). Smoke test: open `/dashboard` with the variable **True**
    and enough data (payments in two months, or 3 paid invoices): the Insights card shows a skeleton and then up to three tiles, with a
    "Written by AI" footer when any text is model-written; reload, it appears at once and `ai_call_logs` gets NO new
    `dashboard_insights` row; with `DASHBOARD_INSIGHTS_AI_ENABLED` unset (or `AI_ENABLED=false`) the card still shows sentences
    (no footer) and no row is written. Before enabling it for real users: the privacy policy must say aggregated income figures are
    processed by an AI provider, and Groq's current data-handling terms must be checked (DECISIONS.md, 06 November 2026).
19. **Payments page (Prompt 11):** a code-only release — **no migration, no new environment variable** (`python manage.py makemigrations
    --check --dry-run` reports none); the one new backend route, `GET /api/payments/currencies/`, is read-only. Smoke test with a real account:
    open `/payments` (the sidebar's *Payments* item no longer lands on the dashboard); the three KPI numbers equal the figures from
    `GET /api/payments/summary/`. *Add payment* (amount, currency, date): it appears first in the list and *This month* changes; add the same
    amount again within three days: the "Possible duplicate" step appears AFTER it is saved and *Delete the one I just added* removes only the
    new one. Open a payment, *Link to invoice*: the open invoice with the same balance is listed first as "Exact match"; link it, the invoice
    becomes *Paid*; *Unlink* (it asks first), the invoice goes back to *Sent*. A payment recorded on an invoice shows no Unlink and no Delete, only
    the reason. On an invoice, *Add Payment* now has a third choice, *Use a Payment I Already Recorded*: it lists only unlinked payments in the
    invoice's currency dated on or after its issue date; linking one updates the invoice in place with a timeline entry. Browser console clean
    throughout; no horizontal scroll at 320px.

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

## Appendix A — the Linux PDF stack (closes PERF-001 for **arm64**; x86-64 still **NOT verified**)

**Status (31 October 2026): verified on arm64 Linux; NOT verified on x86-64.** CLAUDE.md Section 8c
feared that Celery's prefork pool segfaults with WeasyPrint's Pango/Cairo libraries on any OS, as it does
on macOS. It does **not** on Debian (`python:3.13-slim`, this repo's `Dockerfile`) running as `aarch64`
inside Docker Desktop's Linux VM. The test machine reported `uname -m` = `aarch64`; **Railway runs
x86-64**, a different CPU architecture and different native library builds, so a pass here is strong
evidence but not proof for Railway. Run the "repeat on x86-64" step below once there.

Results (12 finalised invoices, different templates, created through the app's own `invoice_create` /
`invoice_finalise` views; the burst is 12 `render_and_store_invoice_pdf.delay()` tasks enqueued back to back,
repeated 3 times per configuration = 36 renders; Cloudinary credentials blank, so the upload step fails
**after** a successful render — expected, and what a bad Cloudinary config would look like, see D.6):

| Worker configuration | Renders ok | `WorkerLostError` / `SIGSEGV` / `signal 11` | Restarts | Worker peak RAM |
|---|---|---|---|---|
| **solo** (production config) | 36/36 | 0 | 0 | 163 MiB |
| prefork `--concurrency=2 --max-tasks-per-child=50` | 36/36 | 0 | 0 | 339 MiB |
| prefork `--concurrency=4` | 36/36 | 0 | 0 | 568 MiB |

"Renders ok" = 36 `weasyprint.progress: Step 7` lines and 36 `Cloudinary invoice-PDF upload failed` lines
(the upload is attempted only after the render returns bytes). Also: all 22 selectable templates rendered
through `generate_template_previews`; embedded fonts for 11 templates inspected with PyMuPDF — every PDF
embeds IBM Plex / Source Serif, and **before the font fix** 10 of 11 used **DejaVu** (the container's
fallback) for body text where the template asks for a system font; the image now installs `fonts-liberation`
and those PDFs embed Liberation Sans instead (before/after table: D.6). A 200-item, 23-page invoice rendered
in 24 s without a crash.

**Repeat it (anywhere with Docker; this is the Compose stack, D.8):**
```bash
deploy/make-test-env.sh
alias dct='docker compose -f deploy/docker-compose.yml --env-file deploy/.env.test'
dct up -d --build
# create 12 finalised invoices through the app's own views, with the worker stopped so they stay queued:
dct stop worker
dct exec -T web python manage.py shell < deploy/test-seed.py
# then for each configuration:
dct run -d --no-deps --name lw worker celery -A config worker -l info --pool=prefork --concurrency=2 --max-tasks-per-child=50
dct exec -T web python manage.py shell -c "
from apps.invoices.models import Invoice
from apps.invoices.tasks import render_and_store_invoice_pdf
[render_and_store_invoice_pdf.delay(str(i)) for i in Invoice.objects.exclude(status='draft').values_list('pk', flat=True)[:12]]"
docker logs lw 2>&1 | grep -c 'Step 7'                                   # expect 12
docker logs lw 2>&1 | grep -c -E 'WorkerLostError|SIGSEGV|signal 11'     # expect 0
docker inspect -f '{{.RestartCount}}' lw                                 # expect 0
docker rm -f lw; dct down -v
```

**Repeat on x86-64 (needed before running prefork on Railway):** deploy `worker` on Railway staging with
`--pool=prefork --concurrency=2 --max-tasks-per-child=50`, finalise 12 invoices in quick succession through
the UI, and check the same three criteria in the worker's logs plus that each invoice gets a `pdf_url`.
Record the result in CLAUDE.md Section 8c.

**If prefork ever crashes on Linux:** the shipped default is already `--pool=solo`; nothing to change.

## Appendix B — client IP behind Railway (**NOT yet verified**)

> On the interim VM + Cloudflare Tunnel setup, use **D.7** instead (same idea, different proxy). This appendix
> applies again once the backend is on Railway.

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

- **Docker image:** built and run for real on 31 October 2026 (arm64; Appendix A/D.8): `apt-get`, user and
  permissions, `collectstatic` as `app`, and the final `CMD` all work. It has not been built on x86-64 or
  on the 2 GiB target VM itself (build memory there is an estimate, D.5).
- Beat's "last run" file survives a container re-create on the VM stack (volume, D.6) but **not on Railway** unless a volume is added there (3.2, D.9).
- `pro_prestige` (and any template whose font stack is `Georgia, serif` with no Times fallback) still falls back to DejaVu Serif for that text: Debian has no Georgia look-alike in the packages installed (D.6).
- `SENTRY_DSN` is read but nothing initialises Sentry: no error monitoring until someone adds
  `sentry-sdk`.
- Railway's config-as-code is deprecated; dashboard settings are the source of truth (3.2).

---

## Appendix D — Free-VM stack (Docker Compose behind a Cloudflare Tunnel)

> **[TIME-SENSITIVE — written 31 October 2026; delete or rewrite this paragraph when it stops being true.]**
> Railway disclosed a security incident on 21 October 2026
> (<https://railway.com/changelog/2026-10-23-october-21-security-incident>) and, per its own support
> forum, **paused new account signups with no reopening date**. Separately, the owner wants to spend
> **USD 0** until the product is public. So, *until public launch*, the backend runs from the same Docker
> image on a **free, always-on rented Linux VM**, reached from the internet through a **Cloudflare Tunnel**
> at `https://api.lanceraos.com` (the VM needs **no inbound ports**). The React app stays on Vercel at
> `https://lanceraos.com`. At public launch the backend moves to Railway (if signups are open) or wherever
> is then best (D.9). Sections 3-4 and Appendix B above describe that later Railway setup and still apply
> to it.
>
> **Where the VM lives — Sydney, not Mumbai.** The owner's AWS account is on AWS's **Free plan, which is locked
> to the Sydney region (`ap-southeast-2`)**. Any other region (Mumbai included) needs the dashboard's
> "Upgrade plan" button, which switches the account to a plan that can **bill the card** — so the VM is in
> Sydney. (An earlier version of this appendix said Mumbai; that was wrong for this account.) Latency from
> Pakistan to Sydney has **not been measured yet**; a number will be added here after the live check (D.7
> procedure step 6).

### D.0 In one paragraph

`deploy/docker-compose.yml` starts seven containers from **one** image built from the repo's
`Dockerfile`: `db` (Postgres 17), `redis` (Redis 7), `migrate` (runs once, then exits), `web` (Daphne),
`worker` (Celery, `--pool=solo`), `beat` (Celery Beat) and optionally `cloudflared` (the tunnel). Nothing
except `web` on the machine's own loopback address (`127.0.0.1:8000`) is reachable from outside the Docker
network, and the tunnel reaches `web` over Docker's private network, not through a host port. The
machine only ever makes *outbound* connections (to Cloudflare, Resend, Cloudinary, Groq...).

### D.1 What is in `deploy/`

| File | What it is |
|---|---|
| `docker-compose.yml` | The stack. Memory limits sized for a 2 GiB machine (D.5). Comments explain every non-obvious line. |
| `env.example` | Template for `deploy/.env` (the real, secret, git-ignored file). `CHANGE_ME` placeholders only. |
| `backup.sh` | `pg_dump` to `~/lanceraos-backups/`, keeps the newest 14, refuses to keep an unreadable dump (D.4). |
| `make-test-env.sh` | Writes `deploy/.env.test`: throwaway secrets for a separate **test** copy of the stack (D.8). |
| `test-seed.py` | Test-stack only: creates a user, a client and 12 finalised invoices through the app's own views (fed to `manage.py shell` on stdin). |

One env file feeds both Compose and the containers, so the Postgres container's user/password/database
are literally the same variables Django reads (`DB_USER`/`DB_PASSWORD`/`DB_NAME`) and cannot drift apart.
`deploy/` is excluded from the Docker image (`.dockerignore`) — proven: `ls /app/deploy` inside the built
image fails — so the secrets file can never be baked into it, and `deploy/.env*` is git-ignored
(`deploy/env.example` stays tracked).

Note: every container reads the whole env file, including `TUNNEL_TOKEN`. Anyone who could run code
inside `web` could therefore read the tunnel token — but they could already read every other secret there,
so splitting files would add complexity without closing a real gap.

### D.2 One-time setup, start to finish

Everything below happens once. Steps tagged **[U]** are written from general knowledge of AWS /
Ubuntu / Cloudflare and were **not** executed or checked against the live console by the pass
that wrote this — consoles move buttons around. If the screen disagrees with a step, trust the
screen, and fix this file afterwards. Steps tagged **[D]** were checked against the provider's
own documentation on 31 October 2026. Steps with no tag were run for real by that pass (on a
Mac, which is why they are about Docker, not about AWS).

#### Part 1 — Create the server in AWS **[U]**

**1. Create the server's IAM role first (once).** The role is what later lets you open a shell with no
open port, and the launch form can only *pick* an existing role, so make it before launching. IAM is
account-wide (it has no region).

   IAM -> **Roles** -> **Create role** -> Trusted entity type **AWS service** -> Use case **EC2** -> Next ->
   in "Permissions policies" search for **`AmazonSSMManagedInstanceCore`** and tick it -> Next ->
   Role name **`lanceraos-server-role`** -> **Create role**.

**2. Pick the region.** In the top-right region picker choose **Asia Pacific (Sydney) `ap-southeast-2`**.
The Free plan only works in Sydney; the console may let you *look at* other regions, but launching there
needs "Upgrade plan", which can bill your card — **do not click it** (see Part 1a below). Latency from
Pakistan to Sydney has not been measured yet (D.7 step 6 adds the number).

**3. EC2 -> Launch instance.**
   - Name: `lanceraos`.
   - Image (AMI): **Ubuntu Server 24.04 LTS**, architecture **64-bit (Arm)**. It must be Arm,
     because `t4g` machines are Arm (Graviton) — an x86 image will not even appear for them.
   - Instance type: **`t4g.small`** (2 vCPU, 2 GiB RAM). The Free plan only allows
     `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`, `c7i-flex.large`, `m7i-flex.large`;
     `t4g.micro` has 1 GiB (not enough — see D.5), and the 4 GiB/8 GiB types burn the credit in
     about two months.
   - Key pair: choose **Proceed without a key pair** (we use Session Manager, below, so no
     SSH key can leak).
   - Network settings -> **Create security group** with **no inbound rules at all** (delete the
     default "SSH from anywhere" rule). Outbound stays "all" — the machine dials out to
     Cloudflare, nothing dials in. Leave "Auto-assign public IP" **enabled** (the machine needs
     *some* route to the internet; with no inbound rule the address is unreachable anyway).
   - Storage: **30 GiB gp3**.
   - Advanced details -> **IAM instance profile**: choose **`lanceraos-server-role`** (made in step 1).
   - Advanced details -> **Termination protection: Enable** (stops a mis-click in the console from
     deleting the server and its database; to delete it deliberately later you first switch this off).
   - Advanced details -> **Credit specification: `Standard`** (see below).
**4.** Launch. Wait for "2/2 checks passed".

**CPU credit mode — set it to Standard. [D]** `t4g` machines are *burstable*: they earn a small
amount of CPU "credit" every hour (20 % of one core per vCPU is the free baseline for
`t4g.small`) and spend it when busy. AWS's documentation says T4g instances **launch in
`unlimited` mode by default** — in that mode, if the machine averages above its baseline over
24 hours, it keeps running full speed and AWS **charges surplus credits**. On the Free plan
that charge comes out of your prepaid credit, silently shortening the plan. In **`standard`**
mode the machine is simply slowed down to the baseline when credits run out (pages get slow,
nothing is billed). For a demo that sits idle almost all day, `standard` is the safe choice. To
change a running machine: EC2 -> select the instance -> Actions -> Instance settings -> **Change
credit specification** -> Standard. Watch the `CPUCreditBalance` graph under the instance's
Monitoring tab; if it sits near zero, the stack is too busy for this size (see D.5).

#### Part 1a — Things on the AWS dashboard to be careful with **[U]**

- **The "Upgrade plan" button** switches the account from the Free plan (which closes the
  account when credits end, never charging your card) to a **paid plan that can bill your card**.
  Do not click it unless you have decided to start paying. Credits expiring 30 Apr 2027 (or
  earlier if used up) is the *intended* end of this setup — by then the product should be
  moving to Railway or another host (D.9).
- Set a **Budget alert** (Billing -> Budgets) at a small amount (e.g. USD 1) so any charge at all
  e-mails you.
- Never make the security group more open "just to test". If something cannot connect, the
  answer is in D.7, not in an inbound rule.

#### Part 2 — Open a shell on the server (no SSH, no open ports) **[U]**

Options compared:

| Way in | Needs an inbound port? | Weakness |
|---|---|---|
| SSH from "my IP only" | Yes (22) | Your home IP changes, so the rule keeps breaking; "from anywhere" invites constant attacks. |
| EC2 Instance Connect (browser button) | Yes (22, from AWS's address range) | Still an open port; its range is wide. |
| **SSM Session Manager (recommended)** | **No** | Needs the IAM role from Part 1; shell lives in the AWS console. |

Use **Session Manager**: EC2 -> select the instance -> **Connect** -> tab **Session Manager** ->
Connect. A terminal opens in the browser as user `ssm-user`; run `sudo -iu ubuntu` to become the
normal `ubuntu` user for everything below. If the Session Manager tab says the instance is not
connected, wait 5 minutes after launch, and check the IAM role is attached (Actions -> Security ->
Modify IAM role).

#### Part 3 — Prepare Ubuntu **[U]** (commands are standard; Docker's lines were checked against Docker's own docs **[D]**)

Everything here is written to run **without any pop-up**. On Ubuntu 24.04 the `needrestart` helper and
`dpkg-reconfigure` each open a full-screen blue dialog that hangs a browser terminal such as Session
Manager. The `APT` line below turns both off for every apt command — paste it first, in the same
terminal, and use `$APT ...` for every apt call.

```bash
# 0. Non-interactive apt (no needrestart dialog, keep existing config files on upgrade)
APT="sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get -y -o Dpkg::Options::=--force-confold"

# 1. Updates
$APT update && $APT upgrade

# 2. Swap file (the safety net for a 2 GiB machine - see D.5 for what it does and doesn't do)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl vm.swappiness=10 && echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf
# Redis asks for this (it forks to rewrite its log file; without it the fork can fail under memory pressure)
echo 'vm.overcommit_memory=1' | sudo tee /etc/sysctl.d/99-redis.conf && sudo sysctl -p /etc/sysctl.d/99-redis.conf
free -h     # should now show ~2 GiB of Swap

# 3. Automatic security updates: install the package, then switch it on by writing its settings file
#    (this is what `dpkg-reconfigure -plow unattended-upgrades` does, minus the dialog)
$APT install unattended-upgrades
sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# 4. Docker Engine + Compose plugin from Docker's own apt repository
$APT install ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
$APT update
$APT install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker containerd     # start on every boot
sudo usermod -aG docker ubuntu                    # then log out and back in (sudo -iu ubuntu again)
docker run --rm hello-world && docker compose version
```

Unattended upgrades install security fixes by themselves but do **not** reboot the machine on their own;
if a kernel update is waiting, `/var/run/reboot-required` exists — reboot at a quiet moment (`sudo reboot`;
the stack comes back by itself, below).

**Surviving a reboot:** Docker starts at boot (`systemctl enable` above) and every long-running
service in `docker-compose.yml` has `restart: unless-stopped`, so after a reboot — or an AWS
maintenance restart — the whole stack comes back by itself in about a minute. Prove it once:
`sudo reboot`, wait two minutes, reopen Session Manager, run `docker compose ps` (D.3). A service
you stopped yourself with `docker compose stop` stays stopped after a reboot, on purpose.

#### Part 4 — Get the code and write the secrets file

The repository is private (`app-lanceraos/lanceraos`), so the server needs permission to read it — and
**only** read it. That is a GitHub **deploy key**: a key pair made on the server, whose public half you
register on this one repository, read-only. No personal access token and no GitHub password ever goes on
the server.

```bash
# 4a. Make the key (no passphrase, so the server can pull unattended)
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -N "" -C "lanceraos-server-deploy-key" -f ~/.ssh/lanceraos_deploy
cat ~/.ssh/lanceraos_deploy.pub          # prints ONE line starting "ssh-ed25519 ..." - copy it
```

**4b. Register it on GitHub [D].** Open `https://github.com/app-lanceraos/lanceraos` -> **Settings** ->
(sidebar) **Deploy keys** -> **Add deploy key** -> Title `lanceraos-server` -> paste the line into **Key**
-> **leave "Allow write access" UNTICKED** (keys are read-only by default; a read-only key means that if
the server is ever broken into, the attacker still cannot change your code) -> **Add key**. (Menu names
from GitHub's "Managing deploy keys" page, fetched 31 October 2026.)

```bash
# 4c. Tell ssh to use that key for github.com
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/lanceraos_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

# 4d. Teach the server GitHub's real identity BEFORE connecting (so it cannot be tricked into trusting an imposter)
echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' >> ~/.ssh/known_hosts
ssh-keygen -lf ~/.ssh/known_hosts          # prints a line ending "github.com (ED25519)"
```

**Compare the fingerprint ssh just printed** with the one GitHub publishes — it must be exactly
`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU` (Ed25519). Source: GitHub Docs, "GitHub's SSH key
fingerprints" (<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints>),
fetched 31 October 2026; the `known_hosts` line above is the Ed25519 line quoted on that page.
**Verified on the Mac:** that exact line produces that fingerprint, and `ssh-keyscan -t ed25519 github.com`
returned the same fingerprint on the same day. If the server prints anything else, **stop** and do not
continue. (GitHub can rotate host keys; if so, the page above is the source of truth — update this file.)

```bash
# 4e. Check access, then clone
ssh -T git@github.com        # expect: "Hi app-lanceraos/lanceraos! You've successfully authenticated, but GitHub does not provide shell access."
git clone git@github.com:app-lanceraos/lanceraos.git LanceraOS
cd LanceraOS/deploy
cp env.example .env
nano .env          # replace every CHANGE_ME (Ctrl+O, Enter, Ctrl+X to save)
chmod 600 .env
```

(The exact wording of the `ssh -T` greeting is from memory **[U]**; the point is that it says it
authenticated.) **If the repository is ever made public**, skip 4a-4d and just use
`git clone https://github.com/app-lanceraos/lanceraos.git LanceraOS`.

Later updates are `cd ~/LanceraOS && git pull` — the deploy key makes that work with no password.

Fill the values from your password manager. The comments at the top of `env.example` give the
exact one-line commands that generate each secret. **Put ENCRYPTION_KEY and BLIND_INDEX_KEY in
the password manager before you write them anywhere else** — if the machine is lost and those two
are not saved elsewhere, every encrypted CNIC/NTN/SMTP password in any restored backup is gone
for good. `deploy/.env` is ignored by git and by Docker's build; it exists only on this machine.

#### Part 5 — Start it

```bash
cd ~/LanceraOS/deploy
docker compose up -d --build        # first build takes 5-10 minutes on this size of machine
docker compose ps                   # everything "Up", db/redis/web "(healthy)", migrate "Exited (0)"
curl -s http://127.0.0.1:8000/api/health/      # {"status":"ok"}
```

If you left `COMPOSE_PROFILES=tunnel` in `.env`, the `cloudflared` container is also started;
until Part 6 is finished it will show as *restarting* — that is harmless. Create your own
admin login for `/admin/` (optional): `docker compose exec web python manage.py createsuperuser`.

#### Part 6 — Connect it to the internet with a Cloudflare Tunnel **[U]**

(The general flow — Networking -> Tunnels -> Create a tunnel -> add a published-application
route with a service URL — matches Cloudflare's current documentation **[D]**; the exact button
labels, and where the token appears, were **not** visible to the pass that wrote this.)

1. Cloudflare dashboard -> **Zero Trust / Networking -> Tunnels -> Create a tunnel** -> type
   *Cloudflared* -> name it `lanceraos-api`.
2. Choose **Docker** as the environment. The page shows a command containing
   `--token eyJ...`. **Copy only the long token** (the part after `--token`) — do **not** run
   that command yourself; Compose runs the container for you.
3. On the server: `nano ~/LanceraOS/deploy/.env`, set `TUNNEL_TOKEN=<the token>`, keep
   `COMPOSE_PROFILES=tunnel`, save. Then `docker compose up -d`. The tunnel page in Cloudflare
   should show the connector as **Healthy/Connected**.
4. In the tunnel's **Routes / Public hostname** tab add a *published application*:
   hostname `api` + domain `lanceraos.com`, **Service URL `http://web:8000`** (`web` is the
   container's name on Compose's private network — *not* `localhost`).
5. Cloudflare creates the DNS record `api` -> `<tunnel-id>.cfargotunnel.com` **proxied (orange
   cloud) automatically** — see D.7 for why this is the one place this project deliberately
   differs from "keep everything grey-cloud".
6. Run the checks in D.7 (client-IP check) and the DEPLOYMENT.md section 8 smoke tests.

**Never put the tunnel token in git, chat, or a screenshot.** Anyone holding it can attach their
own connector to your tunnel. If it leaks: Cloudflare -> the tunnel -> refresh/roll the token,
update `.env`, `docker compose up -d`.

### D.3 Day to day (run these inside `~/LanceraOS/deploy`)

| I want to... | Command |
|---|---|
| See what is running | `docker compose ps` |
| Check the site answers | `curl -s http://127.0.0.1:8000/api/health/` |
| Watch logs live (Ctrl+C to stop) | `docker compose logs -f --tail=50 web` (or `worker`, `beat`, `db`, `redis`, `cloudflared`) |
| Did a PDF fail to upload? | `docker compose logs worker \| grep "render+store failed"` (see D.6: Celery still says "succeeded") |
| Stop everything (data is kept) | `docker compose stop` |
| Start it again | `docker compose up -d` |
| Update to the newest code | `cd ~/LanceraOS && git pull && cd deploy && docker compose up -d --build` (then `docker compose ps`) |
| Run a missed scheduled task by hand | `docker compose exec worker python manage.py shell -c "from apps.payments.tasks import fetch_exchange_rates; fetch_exchange_rates.delay()"` |
| Open a Django shell | `docker compose exec web python manage.py shell` |
| Reset beat's memory of when tasks last ran (rarely needed — Celery repairs a damaged file itself, D.6) | `docker compose stop beat && docker compose rm -f beat && docker volume rm lanceraos_beatdata && docker compose up -d beat` — replace `lanceraos` with the `COMPOSE_PROJECT_NAME` in your `.env`; `docker volume ls` shows the exact name. Beat then starts fresh and waits for the next scheduled slot. |
| **Delete all data (!)** | `docker compose down -v` — **never** run this on the real stack; the `-v` deletes the database volume. Plain `docker compose down` is safe. |

Updating briefly stops `web` while it rebuilds (a minute or two). `migrate` runs automatically
before `web` starts. Take a backup (D.4) before any update that contains a database migration.

### D.4 Backups — and getting them OFF the machine

**Make one now and after every update:**
```bash
~/LanceraOS/deploy/backup.sh          # writes ~/lanceraos-backups/lanceraos-<date>.dump, keeps the newest 14
```
It checks the file is a readable archive before keeping it, and creates it readable by you only.
Nightly automatically: `crontab -e` and add `0 3 * * * /home/ubuntu/LanceraOS/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1`.

**Restore** (into the running stack; replaces nothing until you decide to — this restores into a
*new, empty* database so you can check it first):
```bash
cd ~/LanceraOS/deploy
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE restore_check"'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner' < ~/lanceraos-backups/<file>.dump
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_check -c "select count(*) from users"'
```
To make a restored database the *live* one: `docker compose stop web worker beat`, then rename
(`ALTER DATABASE lanceraos RENAME TO lanceraos_old; ALTER DATABASE restore_check RENAME TO lanceraos;`
run from `-d postgres`), then `docker compose up -d`. The restore commands above were run and
checked (row counts of 6 tables identical before and after) on the Mac test lab.

**A backup that lives only on the VM dies with the VM.** Copy it somewhere else — pick one:

1. **A private S3 bucket (recommended, no inbound port needed) [U].** Create a bucket (S3 ->
   Create bucket; keep "Block all public access" ON). In IAM add to the instance's role a policy
   allowing only `s3:PutObject` on that bucket. On the server: `sudo snap install aws-cli
   --classic`, then after each backup:
   `aws s3 cp ~/lanceraos-backups/lanceraos-<date>.dump s3://<your-bucket>/ --region ap-southeast-2`.
   The bucket outlives the instance. (Check S3's pricing/limits under the Free plan in the
   console; a few MB per day is tiny.)
2. **A second copy of the whole disk: an EBS snapshot [U].** EC2 -> Volumes -> select the
   volume -> Actions -> **Create snapshot**. It captures everything (database volume, `.env`,
   backups) as it is at that instant, "crash-consistent" (Postgres recovers from that like it
   would from a power cut). Do this before risky changes and monthly. Snapshots are stored by
   AWS outside the instance, so they survive losing it. They are a *second layer*, not a
   replacement for `backup.sh` (a dump is portable to Railway; a snapshot is not).
3. **Google Drive via rclone [U].** `sudo apt install rclone`, `rclone config` (it walks you
   through linking Drive; it needs a one-time browser sign-in), then
   `rclone copy ~/lanceraos-backups drive:lanceraos-backups`.

Whichever you pick, **test one restore from the off-machine copy** at least once, and keep
`ENCRYPTION_KEY` / `BLIND_INDEX_KEY` in your password manager — a backup without them cannot
decrypt CNIC/NTN/PSEB values or SMTP passwords.

### D.5 How much RAM do I need? (measured, with the gaps stated)

Measured on 31 October 2026 on an **arm64 Linux Docker VM with 8 GiB** (so nothing was ever short of
memory; the numbers are what the services actually *use*), with `docker stats` sampled about once a
second:

| Service | Idle | Peak during 36 ordinary renders | Ceiling (`mem_limit`) |
|---|---|---|---|
| `web` (Daphne) | 89-92 MiB | 148-191 MiB (the higher figure includes a live 23-page PDF render) | 448 MiB |
| `worker` (solo) | 100 MiB | 163-172 MiB | 576 MiB |
| `beat` | 98-101 MiB | 98-101 MiB | 160 MiB |
| `db` (Postgres, tuned) | 19-29 MiB | 22-38 MiB (tiny test data) | 384 MiB |
| `redis` | 11 MiB | 11 MiB (1.8 MB of data after ~150 tasks) | 96 MiB (`--maxmemory 64mb`) |
| `cloudflared` | not measured (needs a real tunnel); Go, small | | 96 MiB |
| **Sum** | **~320 MiB** | **442-496 MiB** | **1.62-1.7 GiB** |

Worst case seen: one **200-line-item, 23-page** invoice takes **24 s** and **366 MiB** to render in a
fresh process. `--pool=prefork --concurrency=4` peaked at 568 MiB for the worker alone on ordinary
invoices — one reason the stack ships `solo`.

What was **not** measured (so treat as estimates **[U]**): the Ubuntu OS plus Docker's own daemon on the
real machine (typically 300-500 MiB), Postgres once it holds real data (its cache grows toward
`shared_buffers` = 128 MB), and the memory the first `docker compose build` needs on the small VM
(`pip install` plus Debian packages; the build was run on a Mac).

**Verdict, plainly:**
- **1 GiB: not workable.** Measured peak (~0.5 GiB) plus the OS and Docker (~0.4 GiB) leaves no
  headroom for one big PDF, and the image build alone is likely to run out of memory.
- **2 GiB (`t4g.small`): fits, with a swap file** — measured peak is under half of it, so it is *not* tight
  for a demo-sized user base. It becomes tight with several heavy PDFs at once, a large database, or a
  prefork worker. This is the chosen size.
- **4 GiB: comfortable**, if the 2 GiB size ever shows `CPUCreditBalance`/memory trouble — but it costs
  roughly double the AWS credit per hour (D.2, Part 1).

**Per-service ceilings.** If a container exceeds its `mem_limit` the kernel kills *that container
only* and Docker restarts it; the others and the VM are untouched. **Verified**: with `web` squeezed to
230 MiB and three live 23-page renders requested at once, `web` was OOM-killed (exit code 137), the three
requests were dropped, Docker restarted it automatically within a second (restart count 0 -> 1), and
`db`/`redis`/`worker`/`beat` stayed at 0 restarts. `docker compose logs web` shows nothing about it
(the process is killed, not told) — look at `docker inspect -f '{{.State.OOMKilled}}' <container>` and the
restart count in `docker ps`.

**The swap file (Part 3)** gives the *whole machine* a slower overflow area on disk, so a short spike
slows things down instead of killing something. It does **not**: add real memory, make a permanently
too-small machine adequate (a machine living in swap is unusably slow and burns EBS IO), or stop the
per-container limits (a container swaps before it is killed, so the kill just happens later). It is a
safety net, not a plan.

### D.6 Behaviours checked in the test lab (the ones that will confuse you later)

- **A failed PDF upload looks like success to Celery.** With Cloudinary credentials missing, each render
  task logged **two ERROR tracebacks** (`ValueError: Must supply api_key`, then "Background PDF
  render+store failed ... pdf_url left blank"), did **not** retry, and Celery still printed `succeeded ...
  None`. `Invoice.pdf_url` stays blank and the next fetch renders the PDF on demand. So in production,
  *"succeeded" in the worker log does not mean the PDF was stored*: search for `render+store failed`
  (D.3) after configuring Cloudinary.
- **When Redis is full (64 MB, `noeviction`), the app does not lose queued work — it refuses new work.**
  Filled to the limit: `/api/health/` returned **503**; `/api/auth/csrf/`, login and "create invoice"
  returned **HTTP 500** (every rate-limit check writes to the cache); publishing a Celery task raised
  `OperationalError: command not allowed when used memory > 'maxmemory'`. Already-queued tasks and the
  running containers were unaffected, nothing crashed, and everything recovered by itself the moment
  space was freed. At a measured 1.8 MB working set this needs a runaway cause (e.g. a flood of unique
  cache keys), not normal use. **Do not** switch Redis to an evicting policy to "fix" it — that can
  silently delete queued tasks.
- **`restart: unless-stopped` restarts crashes, not manual stops.** A service you `docker stop`/`docker
  kill`/`docker compose stop` stays stopped (including after a reboot) by design; an OOM kill or a
  crash is restarted. Docker (documented behaviour; not exercised here) does **not** restart a container that is merely
  *unhealthy* — a hung Daphne with a live process would stay hung; the health check only reports. If that ever bites, add an
  "autoheal" sidecar — not done here.
- **Beat's memory of "when did each task last run" — FIXED (31 October 2026, second pass).** Beat keeps that
  record in a small file. It used to be `/tmp/celerybeat-schedule`, which is thrown away whenever the container
  is re-created (every `docker compose up -d --build`). It now lives on a Docker volume, `beatdata`, mounted at
  `/app/beat-data` (the `Dockerfile` creates that directory owned by the non-root `app` user — a volume mounted
  at a path the image does not already have is created `root:root` and `app` gets *Permission denied*, tested
  last pass; a volume at an image-owned path inherits the right owner). Tested on the Compose stack, old
  files vs new files, same 15-minute task (`notify-unread-comments-every-15-minutes`):

  | Scenario | Old (`/tmp`, no volume) | New (`beatdata` volume) |
  |---|---|---|
  | **A.** Re-create beat 25 s after it sent the task | not re-sent (17:00:27 start, nothing until the next slot) | not re-sent (17:15:28 start, nothing until the next slot) |
  | **B.** Beat is gone across a slot, then a *new* container starts after it | the missed 17:15 slot was **skipped** (container started 17:15:17, next send 17:30:00) | the missed 17:30 slot was **caught up at once** (container started 17:30:16, task sent 17:30:16) |

  So the benefit is **not** "stops duplicate runs around a deploy" — nothing was re-sent in scenario A either
  way — but **"a deploy that straddles a slot no longer silently skips it"**, which matters for the daily
  jobs (08:00 exchange rates, 08:30 recurring invoices, 09:00 reminders). Catch-up runs each overdue task
  once at start-up (seen for the one task tested); all scheduled tasks are idempotent. Also tested: a
  **brand-new empty volume** starts fine (`id` 1000/`app`, `/app/beat-data` owned by `app`, writable, schedule
  files created on first start); and a **damaged schedule file** (random bytes, or emptied, left with a stale
  `-wal`) is **repaired by Celery itself** — it logs `Removing corrupted schedule file ... db type could not
  be determined`, creates a fresh one and keeps running with zero restarts. The manual reset in D.3 (stop beat,
  remove the container and the volume, start beat) was also run verbatim and works; you should rarely need it.
  **Railway has no such volume by default**, so there the old `/tmp` behaviour remains (3.2, D.9).
- **Timezone is Pakistan time in the containers.** `datetime.now()` and `datetime.utcnow()` differ by
  5 hours (the tzdata package is in the image); Celery's 15-minute schedule and the 08:00 daily jobs are
  PKT.
- **The system-font fallback — FIXED (31 October 2026, second pass).** 10 of the 11 templates rendered to real
  PDFs in the container set their body text in a system font stack (`-apple-system, BlinkMacSystemFont,
  'Segoe UI', Arial, sans-serif`). On a Mac that is a real font; in the old image only DejaVu was installed,
  so the PDFs silently used **DejaVu Sans** (different, wider letters; line and page breaks could differ from
  the gallery previews, which were rendered on a Mac). The `Dockerfile` now installs `fonts-liberation`;
  fontconfig then maps Arial/Helvetica to **Liberation Sans** (metric-compatible with Arial). Evidence — the
  same 12 invoices rendered with the old and the new image, embedded fonts read with PyMuPDF:

  | Template | Fonts BEFORE (old image) | Fonts AFTER (`fonts-liberation`) |
  |---|---|---|
  | `professional` (Ledger) | IBM Plex Mono/Sans (+Semi-Bold), Source Serif 4 Semi-Bold | identical |
  | `pro_executive` | DejaVu Sans (+Bold), IBM Plex Mono, Source Serif 4 Semi-Bold | Liberation Sans (+Bold), IBM Plex Mono, Source Serif 4 Semi-Bold |
  | `pro_grid` | DejaVu Sans (+Bold), IBM Plex Mono (+Semi-Bold) | Liberation Sans (+Bold), IBM Plex Mono (+Semi-Bold) |
  | `pro_signature` | DejaVu Sans/Serif (+Bold), IBM Plex Mono | Liberation Sans/Serif (+Bold), IBM Plex Mono |
  | `pro_prestige` | DejaVu Sans/Serif (+Bold), IBM Plex Mono | Liberation Sans/Serif (+Bold), **DejaVu Serif** (one `Georgia, serif` stack), IBM Plex Mono |
  | `pro_consulting`, `free_essential`, `free_compact`, `free_minimal`, `free_professional` | DejaVu Sans (+Bold), IBM Plex Mono | Liberation Sans (+Bold), IBM Plex Mono |
  | `free_classic` | DejaVu Sans (+Bold), DejaVu Serif Bold, IBM Plex Mono | Liberation Sans (+Bold), Liberation Serif Bold, IBM Plex Mono |

  All bundled fonts (IBM Plex, Source Serif 4) are still embedded in every template (checked by comparing the
  non-system font sets before/after: unchanged for all 11), and every page count is unchanged (all 1 page, except
  `free_professional` at 2, before and after). Image size, built from identical trees: **675 MB -> 682 MB
  (+7 MB)**. Remaining gap: `Georgia` has no look-alike among the installed packages (`fc-match Georgia` ->
  DejaVu Serif), so a `Georgia, serif` stack with no Times fallback — only `pro_prestige` among the 11 tested — still
  uses DejaVu Serif for that text. A Georgia-metric package (`fonts-gelasio` — name from memory) was not tried. The other 11
  templates were not rendered in this check.
- **cloudflared pinned to `2026.10.7`**, the newest release on <https://github.com/cloudflare/cloudflared>
  on 31 October 2026. With a deliberately invalid token the container starts, rejects it locally
  (`Provided Tunnel token is not valid`) and restart-loops harmlessly; a *real* token was never tried.

### D.7 Cloudflare proxying and the client's IP address — must be checked live

**Why the tunnel hostname is proxied.** DEPLOYMENT.md section 4 says product hostnames stay
DNS-only (grey cloud), because a proxy in front of Railway would make every user share the
proxy's address in rate limits and the audit log. A Cloudflare Tunnel cannot be grey: its DNS
record (`api` -> `<tunnel-id>.cfargotunnel.com`) only works proxied. That is acceptable here for
a specific reason: Cloudflare becomes the **single trusted hop** in front of Django, and nothing
else can reach `web` (it has no public port; its host port is loopback-only).

**What this means for `get_client_ip`** (`core/observability.py`): it takes the **last**
`X-Forwarded-For` entry. Reasoned from the code and Cloudflare's published behaviour **[U — not
verified against a real tunnel]**: Cloudflare's edge appends the address that connected to it
(the real visitor) to whatever `X-Forwarded-For` the visitor sent, and `cloudflared` relays
headers to `http://web:8000` without adding an entry of its own. If both are true, the last entry
is the real visitor, a forged leading entry is ignored, and the app keeps working as designed.
If `cloudflared` *did* append its own container address, the last entry would be a `172.x.x.x`
address for **everyone** — all users would share one rate-limit bucket and one audit-log IP.
The same applies to `X-Forwarded-Proto`: Cloudflare is expected to send `https` to the origin;
if it did not, Django would redirect every request to HTTPS forever (a redirect loop). **Both
must be checked once, live.**

**Owner procedure — do this once after the tunnel shows Connected:**

1. From your own computer (not the server):
   `curl -s -i -H 'X-Forwarded-For: 1.2.3.4' https://api.lanceraos.com/api/auth/csrf/ | head -20`
   - Expect `HTTP/2 200` and a `strict-transport-security: max-age=3600; includeSubDomains`
     header. A `301`/`302` loop (curl prints `Too many redirects` with `-L`) means
     `X-Forwarded-Proto` is not reaching Django: stop and tell your developer; do not "fix" it
     by opening ports.
2. Find your real public address: `curl -s https://ifconfig.me`  (write it down).
3. On the server, read what the app recorded for that request:
   ```bash
   cd ~/LanceraOS/deploy
   docker compose exec -T web python manage.py shell -c "
   from core.models import ApiRequestLog as L
   r = L.objects.filter(path='/api/auth/csrf/').latest('created_at'); print('recorded IP:', r.ip_address)"
   ```
4. Compare:
   - **Equals your real address from step 2** -> correct; nothing to do.
   - **Equals `1.2.3.4`** -> the proxy is NOT appending; visitors can forge their address and
     dodge rate limits. Change `get_client_ip` to read `CF-Connecting-IP` instead.
   - **Starts with `172.` or `10.`** (a container address) -> `cloudflared` is appending its own
     entry; everyone shares one address. Same fix: read `CF-Connecting-IP`.
5. Repeat step 1-3 from your phone on mobile data. The recorded address must be **different**
   from the first one (two real visitors, two addresses).
6. **Measure the latency to Sydney** (never measured yet; the VM is in Sydney, `ap-southeast-2`, because that
   is where the Free plan is locked). From a Pakistani connection run
   `for i in 1 2 3 4 5; do curl -s -o /dev/null -w '%{time_total}s\n' https://api.lanceraos.com/api/health/; done`
   and write the typical figure here, with the date and the network: *(not measured yet)*. Expect a few
   hundred milliseconds per request; the first number includes connection set-up and is always the slowest.

### D.8 The test lab (how this was verified, and how to repeat it)

Run on a MacBook (Apple silicon, Docker Desktop 29.9.2, Linux VM `aarch64`) against a throwaway copy of
the stack: its own project name (`lanceraos-test`), its own volumes, host port **18000**, and freshly
generated secrets in the git-ignored `deploy/.env.test`. Repeat it:

```bash
deploy/make-test-env.sh                                  # writes deploy/.env.test (leaves an existing one alone)
alias dct='docker compose -f deploy/docker-compose.yml --env-file deploy/.env.test'
dct up -d --build && dct ps                              # migrate exits 0, db/redis/web healthy
curl -s http://127.0.0.1:18000/api/health/               # {"status":"ok"}
dct exec -T web python manage.py generate_template_previews   # all 22 templates render
dct exec -T web python manage.py shell < deploy/test-seed.py  # 12 finalised invoices via the app's own views
dct down -v                                              # ALWAYS finish with -v: test data must not survive
```

**Never point the real stack at volumes created by a test stack** (different encryption keys make that
data unreadable); the `-p`/`COMPOSE_PROJECT_NAME` separation keeps them apart automatically.

Results of the 31 October 2026 run (all on **arm64 Linux**; see Appendix A for what that does and does not prove):

| Check | Result |
|---|---|
| `docker build` (cold cache, Mac) | ~6 min; image 683 MB, `arm64`; `collectstatic` ran as the non-root `app` user |
| In the image | `uid=1000(app)`; `/app` owned by `app`; no `/app/deploy`; no `/app/.env` |
| Stack from empty volumes | healthy in ~18 s; `migrate` exit 0; **98** migrations applied |
| `/api/health/` over plain HTTP | 200 `{"status":"ok"}` |
| `/api/auth/csrf/`, Host `api.lanceraos.com`, no `X-Forwarded-Proto` | **301** to https |
| same, with `X-Forwarded-Proto: https` | **200** + `Strict-Transport-Security: max-age=3600; includeSubDomains` |
| `/static/admin/css/base.css` | 200 |
| Host not in `ALLOWED_HOSTS` | 400 |
| `X-Forwarded-For: 9.9.9.9, 203.0.113.77` | recorded IP `203.0.113.77` (forged leading entry ignored) |
| 25 health probes | **0** `ApiRequestLog` rows for `/api/health/` |
| WebSocket `ws/echo/` with `Origin: https://lanceraos.com` | 101 (opens) |
| ... with `https://evil.example`, `http://localhost:5173`, or no Origin | 403 (refused) |
| 22 templates through `generate_template_previews` | 22/22 rendered |
| `docker compose down` then `up` (no `-v`) | test user and all 14 invoices still there |
| Beat -> worker | `Scheduler: Sending due task notify-unread-comments-every-15-minutes` at 16:30:00.000, worker `received` 16:30:00.006, `succeeded` 16:30:00.029 |
| Backup -> restore into a scratch database | row counts of `users`, `invoices`, `invoice_items`, `clients`, `api_request_logs`, `django_migrations` **identical** (1, 14, 303, 1, 34, 98); retention kept exactly 14 files |

### D.9 Moving to Railway (or elsewhere) at public launch

1. **Backup** on the VM (`deploy/backup.sh`) and copy the `.dump` somewhere safe (D.4).
2. Create the Railway project as described in sections 3 and 4 above. **Copy these three secrets
   unchanged from the VM's `deploy/.env`: `ENCRYPTION_KEY`, `BLIND_INDEX_KEY`, `SECRET_KEY`.**
   The first two are non-negotiable (a different value makes every encrypted CNIC/NTN/PSEB and
   SMTP password unreadable and breaks the uniqueness index). `SECRET_KEY` signs login tokens and
   e-mail/password-reset links: keep it, or all of those stop working.
3. Restore the dump into Railway's Postgres with `pg_restore --no-owner --clean --if-exists -d "<Railway public DB URL>" <file>.dump`
   (run from any machine that has `pg_restore` 17; use the *public* proxy URL, not the private one).
   Do this with `web`/`worker`/`beat` stopped or not yet deployed, then deploy `web` (its pre-deploy
   `migrate` is a no-op on an up-to-date database).
4. Redis is **not** moved. It only holds the task queue, cache and live-socket traffic. Anything
   mid-flight (a pending 2FA code, a rate-limit counter, a queued PDF) is lost; scheduled tasks
   resume from the next slot. Users may be asked to log in again if a refresh was in flight.
5. DNS swap: in Cloudflare delete the tunnel's `api` record, create the `api` CNAME to Railway
   (DNS-only/grey per section 4), wait for Railway to issue the certificate. Switch **before**
   shutting the VM down; keep it stopped (not deleted) for a week as a fallback.
6. **Beat's memory on Railway.** On the VM, beat remembers when each task last ran in a file on a Docker
   volume (`beatdata`, D.6). `railway/beat.json` is documentation only and a Railway service has no such
   volume by default, so on Railway a restart of `beat` forgets that history unless you add a Railway
   volume to the `beat` service and set its start command to `--schedule <mount path>/celerybeat-schedule`
   (the mount path must be owned by the container's non-root user — Railway's volume ownership was not
   checked). The alternative that needs no volume, `django_celery_beat`'s `DatabaseScheduler`, is the thing to
   revisit at that point — see DECISIONS.md, 31 October 2026 (second entry).
7. Afterwards: the proxy topology is Railway's, not Cloudflare's, so Appendix B (client IP) applies
   again and must be re-run. Remove the AWS resources and the Cloudflare tunnel when you are sure.
