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

Dates are absolute calendar strings from the day they were generated (8 November 2026). Tests that need "today" must
not rely on them; they use the values only for shape, ordering and money.

To regenerate: re-run the generator (a Django `shell` script that builds the same data inside `transaction.atomic()` and
raises to roll back), then review the diff. Do not edit these files by hand.
