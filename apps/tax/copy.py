# apps/tax/copy.py
"""
Every sentence the Tax module shows, built from law.py constants and the person's own numbers. Pure: no Django,
no apps.*. English only. Each sentence says "estimate" where it is one and none tells a person what to choose
(decision T12). The overview, the PDF and the calculator all take their words from here, so they cannot disagree.
"""
from . import law

MONTH_NAMES = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')

RATE_SAVED = (
    'Your PSEB registration number is saved, so this estimate uses 0.25%, the rate for IT exporters registered with '
    'and certified by PSEB. LanceraOS cannot check that your certificate is current.'
)
RATE_NOT_SAVED = (
    'No PSEB registration number is saved, so this estimate uses 1%, the rate for everyone else. If you are registered '
    'with PSEB, save your number in Settings, then Tax and PSEB, and the estimate will use 0.25%.'
)
RATE_MARKED_WITHOUT_NUMBER = (
    'You marked yourself as registered with PSEB but no number is saved, so this estimate uses 1%. Save your number in '
    'Settings, then Tax and PSEB.'
)


def fmt_date(value):
    """08 Nov 2026 (a fixed English table, never locale strftime)."""
    return f'{value.day:02d} {MONTH_NAMES[value.month - 1]} {value.year}'


def fmt_number_with_commas(value):
    return f'{value:,}'


def _plural(n, one, many):
    return f'{n} {one if n == 1 else many}'


def rate_sentence(has_pseb_number, pseb_marked):
    if has_pseb_number:
        return RATE_SAVED
    return RATE_MARKED_WITHOUT_NUMBER if pseb_marked else RATE_NOT_SAVED


def rate_basis(has_pseb_number):
    return 'pseb_number_saved' if has_pseb_number else 'no_pseb_number'


def return_sentence(tax_year, today):
    due = law.return_due(tax_year)
    if due >= today:
        return (
            f'The income tax return for tax year {tax_year} is due by {fmt_date(due)}. FBR has moved this date in past '
            'years, so check FBR for the current date.'
        )
    return (
        f'The usual due date for the tax year {tax_year} return, {fmt_date(due)}, has passed. FBR often moves this date, '
        'so check FBR for the current last date.'
    )


def overview_notes(*, unconverted_count, estimated_count, in_progress, start, counted_to, stale_law, current_year, used_year):
    notes = [
        "These figures are estimates built from the payments you recorded in LanceraOS. Your bank's own records show the "
        'tax it actually took.',
        'A payment in a currency other than PKR is treated as money earned from outside Pakistan. A payment in PKR is '
        'treated as a local payment, and no bank deduction is estimated for it.',
        'The estimate applies one rate, the one for your PSEB status today, to every payment in the tax year, including '
        'payments from before your PSEB registration.',
        'The bank takes the tax when the money reaches your bank account in Pakistan. LanceraOS uses the date you '
        'recorded for each payment, so money that stayed in a Payoneer or Wise balance for a while may be taxed in a '
        'later month.',
    ]
    if unconverted_count:
        one = unconverted_count == 1
        notes.append(
            f"{_plural(unconverted_count, 'payment', 'payments')} could not be converted because no exchange rate was "
            f"saved for {'it' if one else 'them'}. {'It is' if one else 'They are'} left out of every figure here."
        )
    if estimated_count:
        notes.append(
            f"{_plural(estimated_count, 'payment uses', 'payments use')} an estimated exchange rate (the closest day "
            'available), so the figures are approximate.'
        )
    if in_progress:
        notes.append(f'This tax year is not over. The figures cover {fmt_date(start)} to {fmt_date(counted_to)}.')
    if stale_law:
        notes.append(
            f'The tax rules for tax year {current_year} are not loaded yet. The figures use the rules for tax year {used_year}.'
        )
    return notes


def checklist(*, has_ntn, has_pseb_number, pseb_marked, tax_year):
    items = [
        {'key': 'ntn', 'status': 'done' if has_ntn else 'todo',
         'text': 'Your NTN is saved.' if has_ntn else 'Save your NTN in Settings, then Tax and PSEB.'},
    ]
    if has_pseb_number:
        items.append({'key': 'pseb', 'status': 'done', 'text': 'Your PSEB registration number is saved.'})
    elif pseb_marked:
        items.append({
            'key': 'pseb', 'status': 'todo',
            'text': 'You marked yourself as registered with PSEB. Save your number in Settings, then Tax and PSEB, to be '
                    'counted at 0.25%.',
        })
    else:
        items.append({
            'key': 'pseb', 'status': 'check',
            'text': 'If you can register with PSEB, registered and certified IT exporters pay 0.25% instead of 1%.',
        })
    items.append({
        'key': 'return', 'status': 'check',
        'text': f'File your income tax return for tax year {tax_year}. The tax your bank took is a final tax only if you file.',
    })
    items.append({'key': 'statements', 'status': 'check', 'text': 'File your withholding tax statements if you are required to.'})
    if not has_pseb_number:
        items.append({
            'key': 'sales_tax', 'status': 'check',
            'text': 'File your sales tax returns if you are required to. PSEB-registered IT exporters do not need them for '
                    'this purpose.',
        })
    items.append({
        'key': 'bank', 'status': 'check',
        'text': 'Ask your bank for the tax it took from each foreign payment and compare it with this estimate.',
    })
    return items


def calculator_notes(tax_year, surcharge_applies):
    notes = [
        f'This is the tax on the taxable income you typed, at the normal rates for non-salaried individuals for tax year '
        f'{tax_year}. It is an estimate.',
        'It does not subtract tax already taken by a bank, and it does not apply the final tax on money from abroad.',
    ]
    if surcharge_applies:
        notes.append(
            f'A {law.surcharge_percent(tax_year)}% surcharge is added because the taxable income is above Rs '
            f'{fmt_number_with_commas(law.SURCHARGE_THRESHOLD)}.'
        )
    return notes
