# Tax test fixtures (Prompt 21)

Tracked on purpose (the `*.test.*` files are gitignored). Every file here was **generated from the real endpoints**, not typed
by hand: throwaway users were created inside one database transaction, their payments were created through the real service
(`services.create_payment`, so every rate is frozen exactly as in production), the NTN and PSEB numbers were saved through the real
profile methods (`set_ntn`, `set_pseb`), `GET /api/tax/overview/`, `GET /api/tax/law/` and `POST /api/tax/calculator/` (and the two
refused PDF requests) were called through Django's test client with a real minted access cookie, the responses were saved, and the
transaction was rolled back. This was done after the Prompt 21 sentence change to overview note 3.

**Rows left behind: none.** Counts taken before and after the run were identical:
`payments 20, expenses 1, users 29, sessions 3, audit rows 1686, request-log rows 53154, exchange-rate snapshots 33`.
(The rate-limit counters the calls touched live in the cache under the throwaway users' ids and expire on their own.)

**The NTN / PSEB assertion.** Six invented NTNs (`7660001-9` to `7660006-9`) and three invented PSEB numbers (`8870011`,
`8870012`, `8870013`) were saved on the throwaway profiles. Before any file was written the generator asserted that **no file's
text contains any of them**, with or without the hyphen, and not even the seven-digit part (27 needles checked against 21 files).
The Tax payloads never carry an NTN or a PSEB number (they only say whether one is saved).

**The dates are absolute.** The files were generated on **2026-11-10**, so the current tax year is 2027 (`2026-07-01` to
`2027-06-30`, counted to `2026-11-10`). Tests use these files only for shape, order, text and numbers, never for "today".
Payments are in USD, GBP and PKR across both tax years. Exchange-rate snapshots for the payment days were created inside the
rolled-back transaction (a flat table: USD 1, PKR 0.0040, GBP 1.5), so the figures are exact.

`PAYMENT_COUNTS` in `index.js` is the number of payments the generator created inside each overview file's tax year, counted
from the database. The drift test requires `paymentTotal(data)` (export + local + unconverted) to equal it.

| File | Source | What it holds | Payments in the year |
|------|--------|---------------|----------------------|
| `overview-pseb` | `GET /api/tax/overview/` (no parameter: the current year) | PSEB number and NTN saved; USD, GBP and PKR payments; 2027, `in_progress`, rate `0.25` | 5 |
| `overview-pseb-2026` | same user, `?tax_year=2026` | `complete`, 12 months, a payment on 30 June | 5 |
| `overview-nopseb` | | No PSEB number, not marked: rate `1`, the `pseb` checklist item has status `check` | 2 |
| `overview-marked` | | `pseb_registered` true, no number: `rate.pseb_marked_without_number` true, the `pseb` item is `todo` | 2 |
| `overview-empty` | | A new user: zero counts, a row of zeros per month, `by_currency: []` | 0 |
| `overview-local` | | PKR payments only: `export.count` 0, `local.count` 2, `by_currency: []` | 2 |
| `overview-unconverted` | | One USD and one GBP payment; the GBP one was `update()`d inside the transaction to `rate_to_usd=None, rate_basis='none', exchange_rate_snapshot=None` (a valid stored state the API cannot create): `unconverted_count` 1 and its note present | 2 |
| `overview-estimated` | `?tax_year=2026` | A payment dated 2025-07-03, before the earliest real snapshot, so its rate basis is `estimated`: `estimated_count` 1 | 1 |
| `overview-stale` | `today` patched to `2027-07-02` for this call | `stale_law` true, `tax_year` 2027, `status` `complete` | 5 |
| `overview-no-ntn` | | Payments and no NTN: `has_ntn` false, the `ntn` checklist item is `todo` | 2 |
| `law.sample.json` | `GET /api/tax/law/` | The real law payload: version, `tax_years`, 8 facts, sources, links | |
| `calculator-*.sample.json` | `POST /api/tax/calculator/` | `{ request, status, body }` for 1500000 (2027), 0, 600000, 10000000 (no surcharge), 10000001 (surcharge), 12345678.90, 100000000 (the open band), 1500000 with no `tax_year`, and `12000000-2026` (status 400, the surcharge refusal) | |
| `errors.sample.json` | the real 400 bodies' `error` strings | overview bad year, overview "not started" (`today` patched to 2026-06-30), calculator: required, unparsable, negative, too big, bad year; PDF: no payments, no NTN | |

Files that needed `today` patched (`apps.tax.facts.today`): `overview-stale` and `errors.overview_not_started_400`.

To regenerate: run the generator (a Django shell script kept outside the repo that builds the same data inside
`transaction.atomic()` and raises to roll back), then review the diff. Do not edit these files by hand.
