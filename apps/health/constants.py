# apps/health/constants.py
"""
Every number the Health Score uses, named once. The sentences in copy.py are built from these constants, so
the text a person reads can never disagree with the formula that scored them. Pure: no Django, no apps.*.
"""
from decimal import Decimal

WINDOWS = (3, 6, 12, 24)
DEFAULT_WINDOW = 12
MIN_MONTHS = 3
RECENT_DAYS = 90
PAYER_COVERAGE_MIN = Decimal('0.70')
OVERALL_MIN_POINTS = 50
TIP_LIMIT = 5
PAYER_NAME_LIMIT = 60

# The five areas, in the order they are always listed.
INCOME_CONSISTENCY = 'income_consistency'
PROFIT_MARGIN = 'profit_margin'
TAX_COMPLIANCE = 'tax_compliance'
INCOME_GROWTH = 'income_growth'
CLIENT_DIVERSITY = 'client_diversity'

AREAS = (
    (INCOME_CONSISTENCY, 'Income consistency', 25),
    (PROFIT_MARGIN, 'Profit margin', 20),
    (TAX_COMPLIANCE, 'Tax compliance', 20),
    (INCOME_GROWTH, 'Income growth', 20),
    (CLIENT_DIVERSITY, 'Client diversity', 15),
)
AREA_KEYS = tuple(key for key, _label, _max in AREAS)
AREA_LABELS = {key: label for key, label, _max in AREAS}
AREA_MAX = {key: maximum for key, _label, maximum in AREAS}
TOTAL_POINTS = sum(AREA_MAX.values())

# Linear scales: (value that scores zero, value that scores full marks).
CONSISTENCY_ZERO_AT = Decimal('1.00')   # a swing of 100% or more
CONSISTENCY_FULL_AT = Decimal('0.15')   # a swing of 15% or less
MARGIN_ZERO_AT = Decimal('0')           # nothing kept
MARGIN_FULL_AT = Decimal('0.60')        # 60% kept
GROWTH_ZERO_AT = Decimal('-0.30')       # a fall of 30%
GROWTH_FULL_AT = Decimal('0.30')        # growth of 30%
SHARE_ZERO_AT = Decimal('0.80')         # the biggest payer is 80% of named income
SHARE_FULL_AT = Decimal('0.30')         # 30% or less

# Tax compliance: four checks, in this order.
TAX_CHECKS = (
    ('ntn', 'NTN saved', 8),
    ('pseb', 'PSEB registration marked', 4),
    ('recent_payment', 'Payment recorded in the last 90 days', 4),
    ('recent_expense', 'Expense recorded in the last 90 days', 4),
)
TAX_POINTS = {key: points for key, _label, points in TAX_CHECKS}

# What-if figures used by the improvement steps.
WEAK_MONTH_RATIO = Decimal('0.5')       # a month below half of a typical month is "weak"
MARGIN_STEP = Decimal('0.10')           # costs counterfactual: expenses lowered by 10% of income
GROWTH_TARGET = Decimal('0.10')         # growth counterfactual: 10% above the earlier months
GROWTH_TIP_BELOW = Decimal('0.10')      # the growth step is offered below this growth
SPREAD_TARGET = Decimal('0.50')         # diversity counterfactual: the biggest payer at 50%
SPREAD_TIP_ABOVE = Decimal('0.50')      # the spread step is offered above this share

GRADES = (
    (80, 'excellent', 'Excellent'),
    (60, 'good', 'Good'),
    (40, 'fair', 'Fair'),
    (0, 'poor', 'Poor'),
)

REASON_NO_PAYMENTS = 'no_payments'
REASON_TOO_FEW_MONTHS = 'too_few_months'
REASON_NO_INCOME = 'no_income'
REASON_NO_EXPENSES = 'no_expenses'
REASON_TOO_LITTLE_HISTORY = 'too_little_history'
REASON_NO_EARLIER_INCOME = 'no_earlier_income'
REASON_FEW_PAYER_NAMES = 'few_payer_names'
