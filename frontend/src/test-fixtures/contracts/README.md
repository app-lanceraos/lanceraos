# Contracts test fixtures (Prompt 23)

Tracked on purpose (the `*.test.*` files are gitignored). Every `.json` file here was **generated from the real endpoints**
by `python manage.py export_contract_fixtures --out frontend/src/test-fixtures/contracts`, not typed by hand. Do not edit them
by hand; re-run the command and review the diff.

## How the command works

* It refuses to run unless `DEBUG` is true (it prints a plain sentence and exits non-zero otherwise).
* It does all its work inside **one database transaction that is rolled back at the end**. It creates a throwaway user and
  profile, a client, an accepted proposal and a draft proposal, then drives the real owner and public views with Django's test
  client (`force_authenticate` for the owner; the owner's real minted access cookie only for the "owner opens their own link"
  cases; no cookies for the visitor). It never touches a real account.
* **Nothing is sent and nothing is queued.** For the duration of the run, these are replaced (`unittest.mock.patch`):
  `apps.contracts.views.send_client_facing_email` (the "sent by email" contract gets a stub reply), `core.email.send_email` (the
  freelancer's "declined" notice), `apps.contracts.tasks.send_signed_copies.delay` (the signed-copy task), and
  `core.email.requests.post` (set to raise, so any real mail call would fail the run). Calls to the stubs were: 1 client email,
  1 freelancer notice, 0 queued tasks.
* The clock is frozen inside the command only (`django.utils.timezone.now` returns 2026-11-10 12:00:00 plus one second per
  call), so times are ordered and the output is byte-stable between runs. The sign-by dates are relative to that frozen day.
* The rate-limit counters the run touches (the fake IPs and the throwaway user's keys) are deleted before and after.
* Contract, client, proposal and user ids are replaced by sequential fake UUIDs (`00000000-0000-4000-8000-0000000000NN`, in
  order of first appearance). Every secret link appears only inside `public_url` as `TOKEN_FIXTURE_000000NN`, padded to the real
  token's length. The two IP addresses in the data are the documented fakes `203.0.113.9` (the freelancer) and `198.51.100.7`
  (the client); browsers are `FixtureOwnerBrowser/1.0` and `FixtureClientBrowser/1.0`.

## Rows left behind: none

Counts taken before and after the run were identical: `contracts 0, proposals 7, clients 27, users 29`.

## Assertions the generator makes before writing

No file contains the throwaway user's email (`fixture-owner@example.invalid`), a real view token, a `gsk_` or `re_` key, or an
IP address other than the two documented fakes; and no public payload shows an IP address at all.

## Files

| File | Source |
|------|--------|
| `templates`, `limits` | `GET /api/contracts/templates/`; the constants in `apps/contracts/constants.py` plus the Proposals `MAX_AMOUNT` |
| `list`, `list-empty` | `GET /api/contracts/` (nine rows: a viewed-and-expired one, withdrawn, declined, signed, viewed, sent, two drafts, and one more viewed) / the same with none |
| `detail-draft`, `detail-draft-from-proposal` | `POST /api/contracts/` (the second from an accepted proposal, with `notices`) |
| `detail-sent-link`, `detail-sent-email`, `detail-viewed`, `detail-signed` (with `signature_record`), `detail-declined`, `detail-withdrawn`, `detail-expired` | `GET /api/contracts/<id>/` after the real send / view / sign / decline / withdraw. The expired one had its `valid_until` moved into the past with a direct `update()` on the throwaway row |
| `send-check-ready-email`, `send-check-ready-link` | `GET /api/contracts/<id>/send-check/?method=` on a sendable draft |
| `send-check-<id>` for `title`, `client_name`, `sections`, `placeholders`, `fee`, `sign_by`, `client_email`, and `send-check-warning` | the same endpoint on a draft failing exactly that check (set directly on the throwaway row where the API would refuse to save such a state) |
| `public-open`, `public-open-preview` (the owner's own link, `preview: true`), `public-expired`, `public-signed`, `public-declined`, `public-withdrawn` | `GET /api/contracts/public/<token>/` (and the sign / decline responses) |
| `errors` | the real `{status, body}` of the refused requests: create 409, PATCH 403 / 400 (template_key, field errors, sign-by in the past, too many sections), DELETE 403, send 400 / 409, send-check 409, withdraw 409, public sign 403 / 400 / 409 (already answered, expired, withdrawn, integrity), public decline 400, public PDF 409, public 404. The 429 bodies are not captured (they would need to exhaust the limits); their sentences are in `sentences` |
| `sentences`, `banned-words` | `apps/contracts/copy.py`: the shared sentences the frontend mirrors and the K16 word lists |
| `signer-name-cases` | the real `clean_signer_name` run over 48 inputs (astral-plane, Urdu, accented, control-character, over-length, digits-only) |
| `index.js` | the loader |

Note on the owner PDF: not captured here (binary); the frontend tests mock the blob.
