# apps/tax/law.py
"""
The tax law the Tax module uses, in ONE file (decision T7). Every rate, band, date, source and fact sentence is
here; no view, service or template contains a tax number. TAX_LAW.md (repo root) is the human-readable twin of
this file and the two must agree. A change to the law is a change to both, with a new LAST_VERIFIED date.

Pure data and pure helpers: no Django, no apps.*. Types are named in each docstring.

Only what was verified is here (decision T1). A figure whose law is unverified is not computed: for tax year
2026 the surcharge rate is None, and the calculator refuses an income that would need it.
"""
from datetime import date
from decimal import Decimal

LAW_VERSION = '2026-11-09'
LAST_VERIFIED = date(2026, 11, 9)
SUPPORTED_TAX_YEARS = (2026, 2027)

# Section 154A, export of services. Rates card 2027: "export proceeds for tax years 2024 up to tax year 2029".
EXPORT_RATE_FIRST_YEAR, EXPORT_RATE_LAST_YEAR = 2024, 2029
EXPORT_RATE_PSEB_PERCENT = '0.25'     # PSEB-registered and certified IT / IT-enabled exporter
EXPORT_RATE_OTHER_PERCENT = '1'       # any other case

# Normal rates, non-salaried individuals and AOPs. Identical for tax years 2026 and 2027.
# (lower exclusive, upper inclusive or None, rate percent, fixed tax at the lower bound)
NON_SALARIED_BANDS = (
    (0,         600_000,   '0',  0),
    (600_000,   1_200_000, '15', 0),
    (1_200_000, 1_600_000, '20', 90_000),
    (1_600_000, 3_200_000, '30', 170_000),
    (3_200_000, 5_600_000, '40', 650_000),
    (5_600_000, None,      '45', 1_610_000),
)
SURCHARGE_THRESHOLD = 10_000_000       # taxable income ABOVE this
SURCHARGE = {2027: '10', 2026: None}   # percent of the tax; None = rate not verified, so not calculated
CALCULATOR_MAX_INCOME = 1_000_000_000_000

RETURN_DUE_MONTH, RETURN_DUE_DAY = 9, 30   # 30 September after the tax year ends

LINKS = {
    'fbr_iris': 'https://iris.fbr.gov.pk',
    'pseb': 'https://www.pseb.org.pk',
    'fbr': 'https://www.fbr.gov.pk',
}

CONFIDENCE_HIGH = 'high'
CONFIDENCE_MEDIUM_HIGH = 'medium_high'
CONFIDENCE_MEDIUM = 'medium'

SOURCES = (
    {'key': 'fbr_rates_card_2027', 'label': 'FBR Withholding Tax Rates Card 2027 (updated up to 30 June 2026)',
     'url': 'https://download1.fbr.gov.pk/Docs/202681113864992WithholdingTaxRatesCard2027.pdf', 'kind': 'fbr'},
    {'key': 'fbr_circular_2026_27', 'label': 'FBR Circular No. 02 of 2026-27 on the Finance Act 2026 (8 September 2026)',
     'url': 'https://download1.fbr.gov.pk/Docs/202698139527880CircularNo.2of2026-27.pdf', 'kind': 'fbr'},
    {'key': 'ito_154a_text_1', 'label': 'Text of section 154A of the Income Tax Ordinance, 2001 (as amended by the Finance Act 2022)',
     'url': 'https://pakarbiter.com/laws-in-pakistan/income-tax-ordinance-2001/ito-section-154a/export-of-services', 'kind': 'law_text'},
    {'key': 'ito_154a_text_2', 'label': 'Text of section 154A, second copy',
     'url': 'https://www.thebscon.com/export-of-services-including-it-services-section-154a/', 'kind': 'law_text'},
    {'key': 'slabs_pkrevenue_2027', 'label': 'Rates for business individuals and AOPs, tax year 2027 (Pakistan Revenue, 28 July 2026)',
     'url': 'https://pkrevenue.com/fbr-notifies-tax-rates-for-business-individuals-aops-for-tax-year-2027/', 'kind': 'secondary'},
    {'key': 'slabs_taxwizard', 'label': 'Income tax slabs 2026-27 (TaxWizard)',
     'url': 'https://taxwizard.pk/tax-slabs/', 'kind': 'secondary'},
    {'key': 'fbr_ordinance', 'label': 'Income Tax Ordinance, 2001, FBR consolidated text up to 30 June 2026',
     'url': 'https://download1.fbr.gov.pk/Docs/2026724177725705IncomeTaxOrdinanace2001.pdf', 'kind': 'fbr'},
    {'key': 'fbr_site', 'label': 'FBR website', 'url': 'https://www.fbr.gov.pk', 'kind': 'fbr'},
)

FACTS = (
    {'id': 'export_rates', 'title': 'Tax your bank takes on money from abroad',
     'text': 'When money from a client abroad reaches your bank in Pakistan, the bank takes income tax from it under '
             'section 154A. The rate is 0.25% if you are an IT exporter registered with and certified by PSEB, and 1% '
             'for everyone else. These rates are set for tax years 2024 to 2029.',
     'confidence': CONFIDENCE_HIGH, 'sources': ['fbr_rates_card_2027', 'fbr_circular_2026_27']},
    {'id': 'no_atl_difference', 'title': 'Active Taxpayer List',
     'text': "For this tax, FBR's rate card shows the same rate whether or not you are on the Active Taxpayer List.",
     'confidence': CONFIDENCE_HIGH, 'sources': ['fbr_rates_card_2027']},
    {'id': 'final_tax', 'title': "When the bank's tax is final",
     'text': 'The tax the bank takes is a final tax on that income only if you file your income tax return, file your '
             'withholding tax statements if you are required to, and file sales tax returns if you are required to. '
             'PSEB-registered IT exporters do not need the sales tax returns for this purpose. No credit is given for '
             'tax paid in another country.',
     'confidence': CONFIDENCE_MEDIUM_HIGH, 'sources': ['ito_154a_text_1', 'ito_154a_text_2']},
    {'id': 'opt_out', 'title': 'Choosing not to be taxed this way',
     'text': 'You can choose each year, when you file your return, not to be taxed this way. LanceraOS cannot tell you '
             'what this does to the tax your bank already took. Ask a tax advisor before you choose.',
     'confidence': CONFIDENCE_MEDIUM_HIGH, 'sources': ['ito_154a_text_1', 'ito_154a_text_2']},
    {'id': 'no_expenses', 'title': 'Expenses',
     'text': "When the bank's tax is the final tax, it is a percentage of the money you received. Your business "
             'expenses do not reduce it.',
     'confidence': CONFIDENCE_MEDIUM, 'sources': ['ito_154a_text_1', 'ito_154a_text_2']},
    {'id': 'normal_rates', 'title': 'Normal rates',
     'text': 'Income that is not taxed this way is taxed at the normal rates for non-salaried people. For tax year 2027 '
             'nothing is payable up to Rs 600,000, then the rates step up to 15%, 20%, 30% and 40%, and 45% above '
             'Rs 5,600,000. A 10% surcharge on the tax applies when taxable income is above Rs 10,000,000.',
     'confidence': CONFIDENCE_MEDIUM_HIGH, 'sources': ['slabs_pkrevenue_2027', 'slabs_taxwizard', 'fbr_circular_2026_27']},
    {'id': 'tax_year', 'title': 'Tax year',
     'text': 'A tax year runs from 1 July to 30 June and is named for the year it ends in. Tax year 2027 is 1 July 2026 '
             'to 30 June 2027.',
     'confidence': CONFIDENCE_HIGH, 'sources': ['fbr_circular_2026_27']},
    {'id': 'return_due', 'title': 'Return due date',
     'text': 'The income tax return for a tax year is due by 30 September after the year ends. FBR has often moved this '
             'date, so check FBR for the current date.',
     'confidence': CONFIDENCE_MEDIUM, 'sources': ['fbr_site']},
)

NOT_COVERED = (
    'Tax on payments from clients inside Pakistan.',
    'Whether to choose not to be taxed this way for a year.',
    'Any older tax credit for IT exporters (section 65F). We could not confirm whether it still applies.',
    'Advance tax paid in instalments during the year.',
    'Sales tax on services, which the provinces collect.',
    'Income from salary, property, investments or the sale of assets.',
    'The tax your bank actually took. Only your bank\'s records show that.',
)


def tax_year_bounds(year):
    """(first day, last day) of tax year `year` as two dates: 1 July of the year before to 30 June of `year`."""
    return date(year - 1, 7, 1), date(year, 6, 30)


def tax_year_of(day):
    """The tax year (an int) a date falls in: from 1 July the year after the calendar year, else the calendar year."""
    return day.year + 1 if day.month >= 7 else day.year


def default_tax_year(today):
    """(year, stale) for a date. `stale` is True when the current tax year is not supported and the newest supported one is used."""
    current = tax_year_of(today)
    if current in SUPPORTED_TAX_YEARS:
        return current, False
    return max(SUPPORTED_TAX_YEARS), True


def export_rate_percent(has_pseb_number):
    """The section 154A rate as a percent string: '0.25' with a saved PSEB number, else '1'."""
    return EXPORT_RATE_PSEB_PERCENT if has_pseb_number else EXPORT_RATE_OTHER_PERCENT


def export_rate(has_pseb_number):
    """The section 154A rate as a Decimal fraction (0.0025 or 0.01)."""
    return Decimal(export_rate_percent(has_pseb_number)) / 100


def surcharge_percent(year):
    """The surcharge percent string for a tax year, or None when it is not verified."""
    return SURCHARGE.get(year)


def return_due(year):
    """The usual return due date for tax year `year` as a date: 30 September of `year`."""
    return date(year, RETURN_DUE_MONTH, RETURN_DUE_DAY)
