# core/ai.py
"""
Every AI call in LanceraOS goes through call_groq() — never call the Groq
API directly from a view or another module (CLAUDE.md rule 4). Genuinely
new: apps.invoices' AI-seeded design classification (apps/invoices/
ai_design.py) is the first real consumer of this module and of
GROQ_MODEL_VISION — GROQ_API_KEY/GROQ_MODEL_FAST/GROQ_MODEL_QUALITY have
existed in config/settings.py since the Users/Auth build but nothing had
called Groq for real yet.

Retry-with-backoff on 429s is ported directly from the real, working POC
(~/Downloads/invoice_template_poc/backend/main.py's call_groq) — it parses
Groq's own "try again in Ns" message out of the real error body rather than
guessing a fixed sleep, which matters because Groq's actual backoff window
varies with account tier/current load.
"""
import logging
import re
import time

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
REQUEST_TIMEOUT_SECONDS = 90
DEFAULT_MAX_RETRIES = 2

_RETRY_WAIT_RE = re.compile(r'try again in ([\d.]+)s', re.IGNORECASE)


def call_groq(messages, model, max_tokens=1500, max_retries=DEFAULT_MAX_RETRIES):
    """
    One chat-completion call against Groq. Returns the raw string content of
    the model's reply. Raises RuntimeError with a clear, specific message on
    any failure (missing key, exhausted retries, non-200 response) — callers
    decide how to translate that into a user-facing error; this function
    itself never swallows a failure into a silent None/False the way
    core.email.send_email() does, since a design/document AI call has no
    safe "just skip it" fallback the way a notification email does.
    """
    api_key = getattr(settings, 'GROQ_API_KEY', '')
    if not api_key:
        raise RuntimeError('GROQ_API_KEY is not configured.')

    attempt = 0
    while True:
        try:
            resp = requests.post(
                GROQ_URL,
                headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                json={'model': model, 'messages': messages, 'max_tokens': max_tokens},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            raise RuntimeError(f'Groq API request failed: {exc}') from exc

        if resp.status_code == 200:
            try:
                return resp.json()['choices'][0]['message']['content']
            except (KeyError, IndexError, ValueError) as exc:
                raise RuntimeError(f'Groq API returned an unexpected response shape: {exc}') from exc

        if resp.status_code == 429 and attempt < max_retries:
            match = _RETRY_WAIT_RE.search(resp.text)
            wait_s = float(match.group(1)) + 1.0 if match else 15.0
            logger.warning('Groq API rate-limited (attempt %s/%s) — waiting %.1fs.', attempt + 1, max_retries, wait_s)
            time.sleep(wait_s)
            attempt += 1
            continue

        logger.error('Groq API error %s: %s', resp.status_code, resp.text[:500])
        raise RuntimeError(f'Groq API error {resp.status_code}: {resp.text[:500]}')


def strip_model_reply_wrapper(text):
    """
    Real model replies frequently come wrapped in a <think>...</think>
    reasoning block and/or a ```json fence — ported directly from the POC's
    strip_fences(), which exists specifically because raw replies failed
    json.loads() without it.
    """
    text = text.strip()
    text = re.sub(r'^<think>.*?</think>\s*', '', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'^```(json|html)?\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'```\s*$', '', text)
    return text.strip()
