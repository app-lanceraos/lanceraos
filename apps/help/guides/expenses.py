# apps/help/guides/expenses.py
"""Guides: expenses."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'record-an-expense', 'Record an expense', 'expenses',
        'Add what you spend on your business, pick a category, and mark what you consider a business cost.',
        ['spending', 'cost', 'laptop', 'software', 'internet bill', 'equipment', 'category', 'deductible', 'fees', 'duplicate expense', 'delete expense'],
        [
            p('Open Expenses in the sidebar. The page lists what you spend on your business, so you can see what you actually keep.'),
            steps(
                'Press "Add expense".',
                'Fill in the "Amount", the "Currency" and the "Date spent".',
                'Choose a "Category". There is no default, so you pick one yourself.',
                'If you want, add who you paid in "Paid to" and "What it was for".',
                'Tick "Deductible business cost" if you want it counted in the deductible total, then save.',
            ),
            p('In the list, the menu on each row has "Edit", "Duplicate" and "Delete". If LanceraOS finds a similar expense, it shows "Possible duplicate" so you can check.'),
            note('The deductible box is your own note for tax time. LanceraOS only adds these up. Whether an expense can reduce your tax depends on your situation.'),
            note('Only add a fee here if you recorded the full amount your client paid as income. If you recorded the smaller amount that reached you after the fee, the fee is already out of your income, and adding it here would count it twice.'),
            link('Open Expenses', '/expenses'),
        ],
        related=['profit-and-loss', 'record-a-payment', 'exchange-rates-and-converted-amounts', 'the-tax-page'],
        ui_labels=['Add expense', 'Amount', 'Currency', 'Date spent', 'Category', 'Paid to', 'What it was for', 'Deductible business cost', 'Edit', 'Duplicate', 'Delete', 'Possible duplicate'],
        sources=['frontend/src/pages/Expenses.jsx', 'frontend/src/components/ExpenseFormModal.jsx', 'frontend/src/components/ExpenseTable.jsx', 'frontend/src/pages/expensesHelpers.js'],
        checked_on=TODAY),
)
