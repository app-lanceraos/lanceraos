# Help test fixtures (Prompt 24; Prompt 25 added `guides-index-answers-on`)

Tracked on purpose (the `*.test.*` files are gitignored). Every `.json` file here was **generated from the real endpoints** by
`python manage.py export_help_fixtures --out frontend/src/test-fixtures/help`, not typed by hand. Do not edit them by hand;
re-run the command and review the diff. The output is byte-stable between runs (it holds slugs, sentences and the library
version, never an id or a time).

## How the command works

* It refuses to run unless `DEBUG` is true.
* It does all its work inside **one database transaction that is rolled back at the end**, with a throwaway user. It fails if the
  row counts (users, audit rows, AI call rows) differ afterwards.
* **No model request is ever made.** `core.ai.requests.post` is patched to raise. `apps.help.service.run_ai_task` is replaced by a
  stub that returns hand-written replies, and the REAL reply parser, the REAL guard and the REAL block builder run on them. The
  command counts the stubbed model calls and fails unless the number is exactly the one the run is built to make: this run made
  **6** stubbed calls and **0** real requests.
* It deletes the cache keys it touches (the throwaway user's rate-limit counters and the two answer-cache entries) before and after.
  It never clears the whole cache.

## Files (27 JSON files and this README, plus `index.js`)

| File | Source |
|------|--------|
| `guides-index`, `guides-index-answers-on` | `GET /api/help/guides/` with the default settings (`answers_enabled: false`), and with `HELP_AI_ENABLED` and `AI_ENABLED` both on (`true`) |
| `guide-create-an-invoice`, `guide-send-an-invoice`, `guide-the-tax-page` | `GET /api/help/guides/<slug>/` (the first has steps, a note and a link block) |
| `search-hit`, `search-empty` | `GET /api/help/search/?q=` |
| `ask-answered`, `ask-answered-cached` | `POST /api/help/ask/`: a stubbed model reply that passes the guard; then the same question served from the cache |
| `ask-guides-only-no-match`, `ask-guides-only-no-match-support-email` | the gate stays closed (no model call); the second with `SUPPORT_EMAIL` set to `help@example.com` |
| `ask-guides-only-not-covered`, `ask-off-topic` | the stubbed model answers `NOT_COVERED` / `OFF_TOPIC` |
| `ask-guides-only-ai-off` | `HELP_AI_ENABLED` switched off |
| `ask-guides-only-ai-unavailable` | the stubbed AI call fails (`timeout`) |
| `ask-guides-only-answer-rejected` | a stubbed answer containing a web address, rejected by the guard |
| `ask-guides-only-slow-down` | the soft per-minute limit |
| `ask-400-empty`, `ask-400-long`, `ask-429`, `guide-404`, `search-400`, `rate-400` | the real `{status, body}` of the refused requests |
| `rate-ok` | `POST /api/help/rate/` |
| `link-targets`, `topics` | `apps/help/links.py`, `apps/help/constants.py` |
| `constants` | `apps/help/constants.py`: `QUESTION_MIN_CHARS`, `QUESTION_MAX_CHARS`, `SEARCH_MIN_CHARS`, `SEARCH_MAX_CHARS`, `LIBRARY_VERSION`, `POPULAR_SLUGS`, `GUIDE_COUNT`, and (Prompt 26) `AI_TOTAL_BUDGET_SECONDS`, `BANNED_PHRASES`, `STYLE_WORDS` |

The Help page's tests (`frontend/src/pages/__tests__/Help*.test.jsx`, `helpDrift.test.js`) read these files; a limit, a banned word or a sentence that the
page mirrors must change here first (re-run the command), never in a test.
