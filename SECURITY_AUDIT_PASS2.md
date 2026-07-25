# LanceraOS Security Audit — Pass 2 (Attacker-Scenario Trace)

Follow-up to `SECURITY_AUDIT.md`. This pass traces eight specific attack scenarios through the
actual code rather than re-running the checklist. No fixes applied — findings only.

Two of the eight scenarios turned out to be **not exploitable** on inspection (Host header
poisoning, open redirect) and one is exploitable but only as a *hardening gap*, not a live bug
(JWT algorithm, Cloudinary public_id). Those are included below with the reasoning, per your
request to confirm either way. The other five are real, and one of them (onboarding bypass) is
worse than anything in the first pass.

---

## Critical

### C1. `PUT /api/auth/profile/` lets any authenticated user set `onboarding_completed = true` directly, bypassing the mandatory age-verification gate
**Files:** [apps/users/serializers.py:292-300](apps/users/serializers.py#L292-L300), [apps/users/views/profile.py:34-48](apps/users/views/profile.py#L34-L48), [apps/users/oauth/base.py:50-55](apps/users/oauth/base.py#L50-L55)

`FreelancerProfileSerializer.Meta` uses `exclude`, not an explicit `fields` allowlist:

```python
class Meta:
    model = FreelancerProfile
    exclude = [
        'cnic_encrypted', 'cnic_hash', 'ntn_encrypted', 'ntn_hash',
        'pseb_encrypted', 'pseb_hash',
        'custom_smtp_password',
        'wise_access_token', 'wise_refresh_token',
        'user',
    ]
```

`onboarding_completed` (a plain `BooleanField` on `FreelancerProfile`) is **not** in that list, so
it's a normal read/write field on this serializer. The `profile` view passes `request.data`
straight through with no field filtering:

```python
serializer = FreelancerProfileSerializer(prof, data=request.data, partial=True)
...
serializer.save()
```

There is no `validate_onboarding_completed` and no server-side check that the proper onboarding
flow (`complete_onboarding` in profile.py:135-177, which runs `OnboardingSerializer` — profession/
income_source/platform_used requirements and the age check) was ever executed. So:

```
PUT /api/auth/profile/
{"onboarding_completed": true}
```

...succeeds for any authenticated user, at any time, regardless of whether `complete_onboarding`
has ever been called.

**Why this is Critical, not just a data-integrity bug:** the *only* place the mandatory
`>= 16 years old` check runs for an OAuth signup is inside `OnboardingSerializer.validate()`
(serializers.py:388-408). Google/Facebook signups never go through `RegisterSerializer`'s age
check — `oauth/base.py`'s `link_or_create_user` creates the `User` row with no `date_of_birth` at
all (oauth/base.py:50-55). For an OAuth-created account, age is verified *exactly once*, at
onboarding, and nowhere else. The attack:

1. Sign up via Google OAuth (no DOB collected, no age check runs).
2. `PrivateRoute.jsx` redirects to `/onboarding` because `onboarding_completed` is false.
3. Instead of submitting the onboarding form, call `PUT /api/auth/profile/` directly with
   `{"onboarding_completed": true}`.
4. `PrivateRoute.jsx` now treats onboarding as done and grants full app access.
5. `date_of_birth` remains `NULL` forever — the account has never been age-checked at all, on a
   platform CLAUDE.md explicitly requires be 16+ (Section 1: "Age must be >= 16").

This is a one-request bypass of a compliance-relevant, legally-motivated control, reachable by
any authenticated account, requiring no special timing or race condition — the single most
serious finding across both passes.

**Same root cause also affects `custom_smtp_verified` — see H4 below.**

**Fix:** Switch `FreelancerProfileSerializer.Meta` from `exclude` to an explicit `fields` allowlist
containing only the fields the Profile/Business/Tax/Notifications UI actually needs to write, and
mark `onboarding_completed` (and `custom_smtp_*`, `pseb_registered` — see H4/M3) `read_only=True`
so they can only change via their dedicated, validated endpoints (`complete_onboarding`,
`save_custom_smtp`). This is the single fix that also closes H4 and M3 below, since they're the
same underlying `exclude`-list bug on three different fields.

---

## High

### H1. `send_new_device_login_email` embeds the raw, attacker-controlled `User-Agent` and IP into an unescaped HTML email
**Files:** [apps/users/emails.py:237-247](apps/users/emails.py#L237-L247), [apps/users/views/auth.py:112-129](apps/users/views/auth.py#L112-L129)

```python
def send_new_device_login_email(user, ip_address, user_agent, timestamp) -> bool:
    ...
    + f'<p ...><strong>IP address:</strong> {ip_address or "unknown"}</p>'
    + f'<p ...><strong>Device:</strong> {user_agent or "unknown"}</p>'
```

Called from `_update_last_login`:

```python
ua_normalized = normalize_user_agent(ua)          # safe: "Chrome on Windows" etc.
is_new_device = (... or user.last_login_device != ua_normalized)
if is_new_device:
    send_new_device_login_email(user, ip, ua, timezone.now())   # <-- raw `ua`, not `ua_normalized`
```

`ua = get_user_agent(request)` is `request.META.get('HTTP_USER_AGENT', '')[:500]` — an ordinary
HTTP header, fully attacker-controlled, truncated but never escaped. `ip` is `get_client_ip(request)`,
which (per pass 1, H1) is also attacker-controlled via `X-Forwarded-For`. Both are interpolated
directly into the email's HTML body with an f-string — no `django.utils.html.escape`, no
templating autoescape (this module hand-builds HTML strings, it isn't using Django's template
engine at all).

**Exploit path:** this fires on every login flagged as "new device" for the account that just
authenticated — which means the attacker needs valid credentials for the target account (via
phishing, credential stuffing, a leaked password, etc.) to trigger it. That's exactly the scenario
this email exists to catch. The attack chain: attacker obtains victim's password through any means,
logs in with a crafted `User-Agent` header (e.g. containing an `<a href="https://evil-lookalike.com/verify">`
styled to match the real "Change your password" button), and LanceraOS's own authenticated,
DKIM/SPF-legitimate "New sign-in to your account" email delivers that attacker HTML straight into
the real victim's inbox. This turns the platform's own trusted security-alert channel into a
phishing-delivery mechanism at exactly the moment a victim is most likely to click a "secure your
account" link — i.e., it doesn't cause the initial compromise, but it meaningfully amplifies it and
undermines the credibility of every other legitimate security email this app sends.

**Fix:** HTML-escape both values before interpolation (`django.utils.html.escape(ip_address)`,
`django.utils.html.escape(user_agent)`), or — better — use the already-sanitized `ua_normalized`
(which only ever contains one of a small fixed set of browser/OS name strings) in the email instead
of the raw header, and validate `ip_address` looks like an actual IP before display. This module
should probably escape by default in its `_paragraph`/`_heading`/etc. helpers rather than relying on
every call site remembering to do it — right now every other call site happens to only pass in
values that are already safe (names validated to letters/hyphens/spaces at registration, tokens,
static strings), but this is the one place attacker-controlled request headers reach the same
unescaped path.

---

### H2. Timing-based user enumeration on login: password hashing only runs on the "user exists" path
**File:** [apps/users/views/auth.py:272-325](apps/users/views/auth.py#L272-L325)

```python
try:
    user = User.objects.get(email=login_input) if '@' in login_input else User.objects.get(username=login_input)
except User.DoesNotExist:
    log_event('login_failed', request=request, metadata={'reason': 'user_not_found'})
    return Response({'error': 'Invalid credentials...'}, status=status.HTTP_401_UNAUTHORIZED)   # <-- fast path
...
if not user.check_password(password):   # <-- Argon2 hash runs here, only if user exists
    ...
```

Confirmed: the "user not found" branch returns immediately after a single indexed DB lookup — no
password hashing occurs at all. The "wrong password" branch calls `user.check_password(password)`,
which runs a real Argon2id hash (deliberately expensive — that's the entire point of Argon2,
typically tens of milliseconds by design). Both branches return the *same* response body text
("Invalid credentials...") for the common case, which is exactly what defeats a content-based
enumeration check but does nothing against a timing-based one: the response body is identical,
but the response *time* is not. An attacker measuring response latency for a list of candidate
emails (with enough samples per candidate to average out network jitter — very feasible for a
local or same-datacenter attacker, and still practical remotely with a few hundred samples) can
distinguish "account exists, password was wrong" from "no such account" purely from timing,
regardless of the message text.

**Fix:** Run a dummy password verification on the not-found path so both branches do comparable
work:

```python
except User.DoesNotExist:
    from django.contrib.auth.hashers import make_password, check_password
    check_password(password, make_password('dummy-fixed-value'))  # burns comparable Argon2 time
    log_event(...)
    return Response(...)
```

(Precompute the dummy hash once at module load rather than calling `make_password` per request —
`make_password` itself does a fresh Argon2 hash, which is the expensive part you actually want to
keep, but no need to pay the salt-generation cost per call when a fixed dummy hash string works
identically for timing purposes.)

---

### H3. `custom_smtp_verified` and the rest of the custom-SMTP config are mass-assignable via `PUT /api/auth/profile/`, bypassing the mandatory test-email requirement
**Files:** [apps/users/serializers.py:292-300](apps/users/serializers.py#L292-L300), [apps/users/views/smtp.py:22-110](apps/users/views/smtp.py#L22-L110)

Same root cause as C1: `FreelancerProfileSerializer`'s `exclude` list only excludes
`custom_smtp_password`. Every other custom-SMTP field — `custom_smtp_enabled`, `custom_smtp_host`,
`custom_smtp_port`, `custom_smtp_username`, `custom_smtp_use_tls`, `custom_smtp_use_ssl`,
`custom_smtp_from_name`, `custom_smtp_verified`, `custom_smtp_verified_at` — is writable through
`PUT /api/auth/profile/`, completely bypassing `save_custom_smtp`'s mandatory "send a real test
email through this server before persisting anything" flow (smtp.py:26-32, and CLAUDE.md's Custom
Email Rules item 7: *"Before saving SMTP settings, always send a test email... If the test fails,
reject the settings"*).

```
PUT /api/auth/profile/
{"custom_smtp_enabled": true, "custom_smtp_host": "smtp.example.com",
 "custom_smtp_verified": true, "custom_smtp_verified_at": "2026-01-01T00:00:00Z"}
```

...sets `custom_smtp_verified=True` without ever proving the credentials work, and without
`custom_smtp_password` ever being supplied through this path (it's correctly excluded, so it stays
whatever it was — typically empty for an account that never used `smtp/save/`).

**Impact today:** since `custom_smtp_password` can't be smuggled in through this same path, an
attacker can't achieve working mail relay through someone else's account this way — the practical
consequence right now is a user marking their *own* unverified/nonfunctional SMTP config as
"verified," which would only surface once the Invoices module (not yet built) tries to send a
client email through it, fails silently at that point, and falls back to Resend per the documented
fallback behavior. **Impact once Invoices/Proposals/Contracts ship:** any inconsistency between
"the UI says verified" and "it was never actually tested" becomes user-facing (broken client email
delivery that *looks* like it should have worked), and the false `custom_smtp_verified_at` timestamp
pollutes anything that trusts it for support/audit purposes.

**Fix:** Same as C1 — exclude/`read_only=True` all `custom_smtp_*` fields on
`FreelancerProfileSerializer`; the only legitimate writers are `save_custom_smtp` and
`disable_custom_smtp`, which already update these fields directly on the model, not through this
serializer.

---

## Medium

### M1. TOCTOU race on the 3-session cap: concurrent logins can produce 4+ sessions
**File:** [apps/users/models.py:531-549](apps/users/models.py#L531-L549)

```python
@classmethod
def create_for_user(cls, user, raw_token, device_name, ip_address, lifetime_days):
    active = cls.objects.filter(user=user, expires_at__gt=timezone.now())
    if active.count() >= cls.MAX_SESSIONS_PER_USER:
        oldest = active.order_by('last_used_at').first()
        if oldest:
            oldest.delete()

    return cls.objects.create(...)
```

No `transaction.atomic()`, no `select_for_update()`. Nothing serializes concurrent calls to this
method for the same user — under Django's default autocommit mode, the `count()`, the `order_by().first()`,
the `delete()`, and the final `create()` are four independent, separately-committed statements with
no lock held across them. If two logins for the same user race (two devices logging in within
milliseconds of each other — e.g., a user opening the app on phone and laptop at the same moment,
or an attacker deliberately firing concurrent login requests), the sequence:

1. Request A reads `active.count()` == 3 (at cap) → decides to evict.
2. Request B reads `active.count()` == 3 (before A's delete is visible, or simply concurrently) → also decides to evict.
3. Both A and B query "oldest" — under READ COMMITTED (Postgres's default), if B's read happens
   before A's `DELETE` commits, both resolve to the *same* oldest row.
4. A deletes it. B's subsequent `delete()` on the same already-gone pk is a no-op (0 rows affected,
   no error).
5. Both A and B proceed to `create()` a brand-new session.

Net result: 3 existing − 1 actual eviction + 2 new creates = **4 live sessions**, one over the
documented cap. This isn't a full auth bypass (every session was created with valid credentials),
but it's a real, easily-triggered violation of a stated security invariant (CLAUDE.md: "Maximum 3
concurrent sessions per account... 4th login evicts the least-recently-used session"), and it
means the Sessions UI (`GET /api/auth/sessions/`) can show — and a user can genuinely have — more
live, valid refresh tokens outstanding than the product ever intended, quietly widening the
account's attack surface (more valid sessions to steal/replay) without the user or the account
owner having any way to notice this happened.

**Fix:** Serialize per-user session creation. Cheapest correct fix: lock the `User` row for the
duration of the check-evict-create sequence:

```python
with transaction.atomic():
    User.objects.select_for_update().get(pk=user.pk)   # serializes concurrent calls for this user
    active = cls.objects.select_for_update().filter(user=user, expires_at__gt=timezone.now())
    if active.count() >= cls.MAX_SESSIONS_PER_USER:
        oldest = active.order_by('last_used_at').first()
        if oldest:
            oldest.delete()
    return cls.objects.create(...)
```

---

### M2. `forgot_password` has no per-email throttle — only per-IP — enabling inbox-bombing and a response-time enumeration oracle
**File:** [apps/users/views/auth.py:624-655](apps/users/views/auth.py#L624-L655)

```python
ip = get_client_ip(request)
key = f'forgot_pw_{ip}'
count = cache.get(key, 0)
if count >= 5:
    return Response({'error': 'Too many requests...'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
cache.set(key, count + 1, timeout=3600)
```

This is the *only* throttle on this endpoint, and it's keyed purely on `get_client_ip(request)` —
which pass 1's H1 already established is spoofable via `X-Forwarded-For`. Even setting that bug
aside, a genuinely distributed attacker (or a small botnet, or just several real IPs) requesting a
reset for the *same target email* faces no per-target backstop at all. Compare this to
`resend_verification` (auth.py:601-605), `initiate_deletion` (deletion.py:39-43), and
`request_email_change` (security.py:191-195) — all three correctly key their throttle on the user
or email, in addition to (or instead of) IP. `forgot_password` is the one outlier that doesn't,
which reads as an oversight rather than a deliberate choice given the pattern used everywhere else
in this same file.

**Compounding issue — a genuine response-time oracle, not just a spam vector:** the existing-email
branch calls `send_password_reset_email(user, token, uid)` synchronously, inline in the request
(auth.py:648-650), which calls `core.email.send_email()` → a blocking `requests.post()` to the
Resend HTTP API with a 10-second timeout (core/email.py:47-53). There is no Celery task, no
`.delay()`, anywhere in `apps/users` — every email send blocks the request thread on a real
outbound HTTPS call. The non-existent-email branch does nothing but a cache write and returns
immediately. This means `forgot_password` (and `resend_verification`, which has the same shape) has
a *much larger* and more universally exploitable timing gap than the Argon2-vs-no-hash gap in H2 —
tens to hundreds of milliseconds of a real network round-trip to a third-party API, versus Argon2's
single-digit-to-tens of milliseconds of local CPU work. Both endpoints already claim to give a
uniform, identity-hiding response ("If an account with this email exists...") — that claim is only
true of the response *body*, not its timing.

**Fix:** Add a per-email cache key (`f'forgot_pw_email_{email}'`) alongside the existing per-IP one,
matching the pattern already used elsewhere in this file. Separately, move `send_email()` calls
(at minimum for `forgot_password` and `resend_verification`, ideally all of them) onto a Celery
task so the HTTP response no longer waits on — and therefore no longer leaks timing from — the
outbound email call. This second fix also improves resilience (a slow/down Resend no longer holds
the request thread for up to 10 seconds).

---

### M3. `pseb_registered` is self-declarable via `PUT /api/auth/profile/` with no corroborating check
**File:** [apps/users/models.py:323](apps/users/models.py#L323), [apps/users/serializers.py:292-300](apps/users/serializers.py#L292-L300)

Same `exclude`-list root cause as C1/H3, smaller blast radius. `pseb_registered` (a plain boolean,
distinct from the actual encrypted PSEB number) is not excluded, so a user can set it `true`
directly without ever having a validated `pseb_encrypted` value on file (`set_pseb()` — the only
code path that validates and stores an actual PSEB number — never touches `pseb_registered` at
all; the two fields are entirely decoupled today). No consumer reads this field yet (the Tax module,
which is where SRO 586 eligibility — "requires... PSEB registration number in profile" per
CLAUDE.md — is specced, is listed as "Not started"), so there's no live exploit yet, but it's the
same class of bug as C1/H3 and should be closed by the same serializer fix before the Tax module
ships and starts trusting this flag for a real tax-exemption determination.

**Fix:** Fold into the C1/H3 fix — either exclude `pseb_registered` from client writes entirely and
derive it server-side from "does `pseb_hash` exist," or make it `read_only=True` and set it only
inside `set_pseb()`.

---

## Low / Confirmed-Not-Exploitable

### L1. Host header poisoning in reset/verification links — **checked, not exploitable**
**File:** [apps/users/emails.py:18-20](apps/users/emails.py#L18-L20)

```python
def _frontend_url(path: str) -> str:
    base = getattr(settings, 'FRONTEND_URL', 'http://localhost:5173').rstrip('/')
    return f'{base}{path}'
```

Every email-template URL builder in `emails.py` (`send_verification_email`, `send_password_reset_email`,
`send_email_change_step1_email`, `send_email_change_step2_email`, `send_welcome_email`) routes
through this one helper, which reads `settings.FRONTEND_URL` — a fixed, server-side environment
variable — and never calls `request.get_host()` or `request.build_absolute_uri()` anywhere. There
is no code path in this app where a client-supplied `Host` header influences the domain in any
outbound security email. Confirmed clear.

### L2. Open redirect via `location.state?.from` — **not exploitable today, one hardening gap worth closing**
**Files:** [frontend/src/lib/api.js:62-83](frontend/src/lib/api.js#L62-L83), [frontend/src/pages/Login.jsx:83-84](frontend/src/pages/Login.jsx#L83-L84)

`location.state.from` only ever originates from `PrivateRoute.jsx`'s own
`<Navigate to="/login" state={{ from: location.pathname }} />` — `location.pathname` is React
Router's parsed path component of the current URL, which can never contain an absolute or
protocol-relative URL (the browser itself splits the URL into origin/path/query/hash before
React Router ever sees it) — so this specific call site can't be attacker-influenced via the
address bar, query string, or hash.

`setRedirectPath`/`getRedirectPath` (api.js:62-77) do reject anything not starting with `/` and
explicitly reject `/login`, `/register`, `/`. One gap: `'//evil.com'.startsWith('/')` is `true` in
JavaScript, so the string `//evil.com` (a protocol-relative URL) would pass this check. However,
every single consumer of `getRedirectPath()` in the codebase (`Login.jsx`, `TwoFAVerify.jsx`) calls
it exclusively as `navigate(getRedirectPath(), { replace: true })` via React Router — never
`window.location.href = ...` or a raw `<a href>`. React Router's `navigate()` uses the History API
internally, which enforces same-origin URLs and does not perform a real browser-level navigation
to an external host even if handed a protocol-relative string — so there is no live open-redirect
today. Still worth tightening `setRedirectPath`'s validation (reject anything starting with `//`
in addition to requiring a leading `/`) as defense-in-depth, since both helper functions are
exported and nothing stops a future code path from using one of them with `window.location`
directly.

### L3. JWT algorithm — **not a vulnerability, but implicit rather than explicit**
**File:** [config/settings.py:208-217](config/settings.py#L208-L217)

`SIMPLE_JWT` does not set `'ALGORITHM'` explicitly. `djangorestframework-simplejwt` defaults this
to `'HS256'` internally and — critically for algorithm-confusion attacks — always calls PyJWT's
`jwt.decode(token, key, algorithms=[api_settings.ALGORITHM])` with an explicit, server-controlled
`algorithms` allowlist; it never derives the accepted algorithm from the token's own header. This
closes the classic "attacker sets `alg: none`" or "RS256/HS256 key-confusion" attack regardless of
what this app's settings say, so there's no live vulnerability. The only recommendation is
hygiene: add `'ALGORITHM': 'HS256'` explicitly to `SIMPLE_JWT` in settings.py so this is
self-documenting and doesn't depend on a future editor knowing simplejwt's default, particularly
if someone later adds asymmetric-key support (`RS256`/`ES256`) for a future service-to-service
integration without understanding the signing/verifying-key split that requires.

### L4. Cloudinary `public_id` predictability — **checked, not exploitable**
**File:** [apps/users/views/profile.py:122-129](apps/users/views/profile.py#L122-L129)

```python
result = cloudinary.uploader.upload(file, folder='lanceraos/logos', resource_type='image')
...
prof.logo_public_id = result.get('public_id', '')
```

No `public_id` parameter is passed to `cloudinary.uploader.upload()`, so Cloudinary generates a
random unique identifier server-side — it is not derived from the user's ID, a sequential counter,
or the original filename, and is not guessable. The pre-upload `cloudinary.uploader.destroy(prof.logo_public_id)`
call (profile.py:116-120) only ever operates on the requesting user's own stored `logo_public_id`
value, so there's no cross-user overwrite path either. Confirmed clear.

---

## Prioritized action list (merged with pass 1)

Pass 2 surfaced one finding that outranks everything in pass 1, and a couple that sit comfortably
alongside the existing High-severity items. Revised overall order:

1. **C1 (new) — fix the `FreelancerProfileSerializer` mass-assignment hole.** This jumps to the
   very top of the combined list, ahead of pass 1's H1 (IP spoofing) and H2 (admin brute-force). It
   bypasses a legally-relevant age-verification control in one API call with no special conditions
   — the highest-confidence, lowest-effort-to-exploit finding across both passes. Fixing the
   serializer (switch to an explicit `fields` allowlist, mark `onboarding_completed`,
   `custom_smtp_*`, and `pseb_registered` read-only) closes C1, H3, and M3 simultaneously in one
   change.
2. **H1 (new) — escape `ip_address`/`user_agent` before they reach the new-device-login email**, or
   switch to the already-sanitized `ua_normalized`. Small, mechanical fix; closes a real phishing
   vector inside a trusted security-alert channel.
3. **Pass 1 H1 — fix `get_client_ip()`'s blind trust of `X-Forwarded-For`.** Still stands as-is;
   note that it also makes H1 (this pass) worse (spoofable IP is one of the two injected values)
   and directly enables the "distributed" half of M2 (new, this pass).
4. **H2 (new) — dummy-hash the "user not found" login path** to close the timing side-channel.
   Small, mechanical fix, same spirit as pass 1's M2 (constant-time token comparison) — do both in
   the same pass since they're the same category of bug (timing side-channels) and both are cheap.
5. **Pass 1 H2 — Django admin brute-force protection.** Unchanged from pass 1; still worth doing
   before this ships, but no longer the single highest-priority item.
6. **M1 (new) — serialize `Session.create_for_user`** with `select_for_update()`. Real but bounded
   impact (extra valid sessions, not a compromise by itself); fine to schedule after the above.
7. **M2 (new) — add a per-email throttle to `forgot_password`, and move email sending off the
   request thread (Celery) for at least `forgot_password`/`resend_verification`.** The per-email
   throttle is a five-minute fix matching an existing pattern already used elsewhere in the same
   file; the Celery move is more work but also fixes the timing-oracle half of this finding and is
   worth scoping regardless once real email volume matters.
8. Everything else from pass 1 (M3–M6, L1–L4) stands as previously prioritized, now after the above.
