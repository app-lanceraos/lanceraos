# Sample exports for the payment import engine

**Every file here is SYNTHETIC.** None is a real export from any provider. They exist so the import engine, its tests
and the future import screens have realistic input without anyone's real financial data in the repository.

| File | Written from | What it exercises |
|------|--------------|-------------------|
| `wise_statement.csv` | The Wise statement header documented by an open-source importer and an accounting integration (`TransferWise ID, Date, Amount, Currency, Description, Payment Reference, Running Balance, Exchange From, Exchange To, Exchange Rate, Payer Name, Payee Name, Payee Account Number, Merchant, Card Last Four Digits, Card Holder Full Name, Attachment, Note, Total fees`). Day-first dates, outgoing amounts negative. **The wording of the `Description` column is a best guess**, not copied from a real file. | Incoming payments with a payer, card/outgoing rows, a currency-conversion pair, top-ups, a fee and a fee adjustment, a refund, positive rows with no payer (unsure), one row with Exchange From/To filled, and one transaction id that appears twice. Dates include a day above 12 (14-09-2026). |
| `generic_semicolon_signed.csv` | An invented spreadsheet layout | `;` delimiter, ISO dates, signed amounts, a currency column. |
| `generic_credit_debit.csv` | An invented bank-style layout | Separate Credit / Debit columns, `05 Oct 2026` dates, thousands separators, a `0.00` in the unused column, one row with both filled. |
| `generic_all_income_symbols.csv` | An invented layout | `$1,234.50`, `€980.00`, `£760.25`, `(50.00)` (a negative in parentheses). |
| `generic_ambiguous_dates.csv` | An invented layout | Every date has both parts <= 12, so the order is unknowable: the engine must ask, not guess. |
| `generic_payoneer_like.csv` | **Invented headers** (`Date, Description, Amount, Currency, Status, Reference ID`). Payoneer does not publish its CSV columns; only `Source`, `Target`, `Reference ID`, `Store Name` and `Additional Description` are documented anywhere, and nothing here claims to be Payoneer's real layout. | A status column (completed / pending / cancelled / unknown), a reference id column, a withdrawal. |
| `broken_formulas_and_bidi.csv` | Hand-made hostile input | Cells starting with `=`, `+`, `@`, `-`; a right-to-left override, zero-width and BOM characters; a newline and a tab inside a quoted cell. |
| `excel_damaged_ids.csv` | Hand-made | Transaction ids Excel has turned into scientific notation (`1.23457E+15`) next to a good one. |

The Wise sample assumes the engine's test snapshots cover USD, EUR, GBP and PKR.
