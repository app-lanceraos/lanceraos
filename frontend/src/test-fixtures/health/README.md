# Health Score test fixtures (Prompt 19)

Tracked on purpose (the `*.test.*` files are gitignored). Every file here was **generated from the real endpoints**, not typed
by hand: throwaway users were created inside one database transaction, their payments and expenses were created through the
real services (`services.create_payment` with the `counterparty` argument, which is the "Received from" name, and
`expense_services.create_expense`, so every rate is frozen exactly as in production), the NTN and PSEB were saved through the
real profile methods, `GET /api/health/score/` and `GET /api/health/mini/` were called through Django's test client with a real
minted access cookie, the responses were saved, and the transaction was rolled back.

**Rows left behind: none.** Counts taken before and after the run were identical:
`payments 20, expenses 1, users 29, sessions 3, audit rows 1670, request-log rows 52353, exchange-rate snapshots 32`.

**The NTN assertion.** Seven invented NTNs (`7650001-9` to `7650007-9`, one per persona that has one: an NTN is unique per
account) were saved on the throwaway profiles. Before each file was written, the generator asserted that the file's text
contains none of them, with or without the hyphen and not even the seven-digit part. The Health payload must never carry an NTN,
and it does not (it only knows *whether* one is saved).

**The dates are absolute.** The files were generated on **2026-11-09**, so a 12-month window is `2025-11-01` to `2026-10-31`
(its earlier window `2024-11-01` to `2025-10-31`). Tests use these files only for shape, order, text and numbers, never for
"today". Every persona's profile currency is USD and every payment is in USD, so the figures are exact (no conversion noise);
the only exception is the deliberately unconverted GBP pair in `score-unconverted`.

| File | Source | What it holds |
|------|--------|---------------|
| `score-rich.sample.json` | `GET /api/health/score/?months=12` | Excellent, 97: 18 steady months, four payers none above 28%, expenses 30% of income, NTN saved, PSEB marked, records in the last 90 days, growth +20%. `tips` is empty (the only step is worth under one point) |
| `score-rich-3`, `-6`, `-24` | same, `months=3` / `6` / `24` | The same user at other windows: different `window` dates. At 24 months Income growth is `not_enough_data` (nothing recorded in the earlier window), so it is `partial: true` with a score of 100 |
| `score-mixed.sample.json` | same | Good, 65: one month with no payment, margin 45%, growth -8%, the top payer at 60% of named income, NTN saved and PSEB not marked. Five `improve` tips (growth, weakest month, PSEB, costs, payer spread); the "no payment in 1 month" `record` step is NOT in `tips` (it is in the Income consistency `steps`), which is what the "More steps for this area" rule needs |
| `score-partial.sample.json` | same | A score that is not null with `partial: true` (94, counted over 65 of 100 points): 8 months, most income without a "Received from" name; Client diversity (`few_payer_names`) and Income growth (`too_little_history`) are `not_enough_data`; `notes` includes the partial note |
| `score-none.sample.json` | same | A new user with nothing: `score: null`, `grade: null`, the `message`, five `record` tips, Tax compliance scored at 0 |
| `score-short.sample.json` | same | 2 months of payments, no expenses: `score: null`; Tax compliance 12 of 20, Client diversity scored at 0 |
| `score-poor.sample.json` | same | Poor, 4: one payer, long gaps, expenses above income, no NTN, nothing in the last 90 days |
| `score-unconverted.sample.json` | same | The mixed user plus one GBP payment and one GBP expense for which no rate exists (created normally, then `update()`d to `rate_to_usd=None, rate_basis='none', exchange_rate_snapshot=None`, a valid stored state the API cannot create): `counts.unconverted_*` is 1 and the "could not be converted" note is present |
| `score-hostile.sample.json` | same | Good, 78: the biggest payer is named `<img src=x onerror=alert(1)> & Co`; the name appears inside the Client diversity `measure` and in the top tip |
| `score-perfect.sample.json` | same | Every area at full marks: 100, `tips: []`, earlier window flat at 100,000 a month and the recent window flat at 130,000 |
| `mini-rich`, `mini-mixed`, `mini-partial`, `mini-none`, `mini-poor`, `mini-hostile`, `mini-perfect` | `GET /api/health/mini/` | The same persona as the score file of the same name. `mini-perfect` has `top_tip: null` with a score; `mini-none` has `score: null` and a `record` top tip; `mini-hostile`'s top tip carries the hostile name |
| `errors.sample.json` | the 400 body of `GET /api/health/score/?months=7` | `{ "months_400": "months must be 3, 6, 12 or 24." }` |

To regenerate: run the generator (a Django shell script that builds the same data inside `transaction.atomic()` and raises to
roll back), then review the diff. Do not edit these files by hand.
