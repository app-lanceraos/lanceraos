# core/test_runner.py
"""
Custom Django test runner — a suite-wide safety net so no test can ever
reach the real Resend API.

core/email.py's send_email() calls requests.post() directly (Resend's
HTTP API, not Django's email backend — see CLAUDE.md rule 3), so
Django's usual test-mode email safety net (swapping EMAIL_BACKEND to
locmem) does nothing here — there's no Django mail backend in the loop
to swap out. Without a suite-level net, every test that touches an
email-sending code path has to remember to mock it itself, with zero
fallback if one is missed — which is exactly what happened: running the
full apps.users suite made real HTTP calls to Resend (logged as
repeated 422s) from tests that never mocked send_email/send_*_email at
all.

Patching core.email.send_email directly is NOT reliable here: every
app's emails.py does `from core.email import send_email`, which binds
its own local name in that module's namespace at import time. If that
import already happened before this patch is applied — order that
varies with Django's app/URL loading — the local name keeps pointing at
the real function. Patching requests.post instead is import-order-proof:
send_email() always reaches it via `requests.post(...)`, an attribute
lookup on the shared `requests` module at call time, never a cached
local reference, so it's intercepted no matter which app imported
send_email() or when.

Only .post is patched (not .get) — apps/users/oauth/{google,facebook}.py
verify tokens via requests.get, and those paths are unaffected by this
patch.
"""
from unittest.mock import MagicMock, patch

from django.test.runner import DiscoverRunner


class SafeTestRunner(DiscoverRunner):
    def setup_test_environment(self, **kwargs):
        super().setup_test_environment(**kwargs)
        fake_response = MagicMock(status_code=200, text='')
        self._requests_post_patcher = patch('requests.post', return_value=fake_response)
        self._requests_post_patcher.start()

    def teardown_test_environment(self, **kwargs):
        self._requests_post_patcher.stop()
        super().teardown_test_environment(**kwargs)
