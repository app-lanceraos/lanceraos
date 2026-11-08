# apps/payments/importing/__init__.py
"""
The payment import engine: reads a CSV exported from Wise, Payoneer or a spreadsheet, works out which
rows are real money received, finds rows the person already has, and (after they confirm) creates the
payments. Pure Python plus the ORM: nothing in this package knows about requests or responses.

Modules, one job each: errors, reader (bytes -> table), parsing (text -> amount/date/text), mapping
(which column is what), classify (what kind of row), plan (the full preview), commit (create/undo).
Inside this package, import with absolute `apps.payments...` paths: the app's dependency test forbids
relative imports that climb out of a module's own package level.
"""
