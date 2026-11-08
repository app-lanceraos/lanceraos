# Payments test fixtures

Tracked on purpose (the `*.test.*` files are gitignored). Every file here was **generated from the real views and
serializers**, not typed by hand: a throwaway user was created inside one database transaction, the real endpoints were
called through Django's test client with a real minted access cookie, the responses were saved, and the transaction was
rolled back (nothing was left in the database).

| File | Endpoint | What it holds |
|------|----------|---------------|
| `list.sample.json` | `GET /api/payments/` | Four payments: a free manual one, a partly linked one (USD 400 of 1,000), an invoice-origin fully linked one, and one with `rate_basis: "estimated"` (PKR) |
| `summary.sample.json` | `GET /api/payments/summary/` | The headline numbers, 12 months, by source, `month_change_pct`, `estimated_count` |
| `candidates.sample.json` | `GET /api/payments/<id>/link-candidates/` | Two open USD invoices for the partly linked payment; the first one's balance equals what is left of it (the "Exact match") |
| `duplicates.sample.json` | `POST /api/payments/` | A create response that carries `possible_duplicates` |
| `currencies.sample.json` | `GET /api/payments/currencies/` | The distinct currencies the throwaway user had |
| `detail.sample.json` | `GET /api/payments/<id>/` | The partly linked payment with its `invoices[]` |
| `imported-payment.sample.json` | `GET /api/payments/<id>/` | A payment created by an import: non-empty `external_id` and `imported_from` (`{id, file_name, imported_at}`) |
| `import-preview-wise.sample.json` | `POST /api/payments/import/preview/` | `apps/payments/sample_exports/wise_statement.csv` previewed with one earlier import (`TRANSFER-1002`) and one manual USD 500 already in the ledger: `duplicate_exact` (already imported, and the id repeated inside the file), `duplicate_probable` (with `matches[]`), `unsure`, `not_income` rows, the summary and the `plan_fingerprint` |
| `import-preview-needs-mapping.sample.json` | `POST /api/payments/import/preview/` | `generic_ambiguous_dates.csv`: `needs_mapping: true`, `reasons: ["date_format_ambiguous"]`, `headers`, `sample_rows`, no rows and no fingerprint |
| `import-preview-credit-debit.sample.json` | `POST /api/payments/import/preview/` | `generic_credit_debit.csv` with source `bank` (Prompt 13): separate Credit / Debit columns detected by name, a `0.00` in the unused column, two `not_income` rows (money out) and one `invalid` row ("Both money in and money out are filled.") |
| `import-preview-payoneer-like.sample.json` | `POST /api/payments/import/preview/` | `generic_payoneer_like.csv` with source `payoneer` (Prompt 13): a status column; `not_income` for pending, cancelled and withdrawal rows, `unsure` for "Held for review", `new` for completed ones |
| `import-commit.sample.json` | `POST /api/payments/import/` | The 201 body after committing the default selection of the Wise preview: `{batch}` |
| `import-batches.sample.json` | `GET /api/payments/import/batches/` | The import history with the live `remaining` count |

The import fixtures (and the two added in Prompt 13) were generated the same way (a throwaway user, real endpoints, rolled back); the Wise preview shows file name `wise-statement-q3.csv`. `list.sample.json` and `detail.sample.json` were regenerated on 8 November 2026 (Prompt 12) for the two new read fields `external_id` and `imported_from`; the data is the same four payments, with new ids and timestamps.

Dates are absolute calendar strings from the day they were generated (8 November 2026). Tests that need "today" must
not rely on them; they use the values only for shape, ordering and money.

To regenerate: re-run the generator (a Django `shell` script that builds the same data inside `transaction.atomic()` and
raises to roll back), then review the diff. Do not edit these files by hand.
