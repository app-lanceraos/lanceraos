# apps/health/domain.py
"""
The plain data the Health Score is made of. Pure: no Django, no apps.*, so scoring.py, tips.py and copy.py can
use these types without importing anything that touches the database.
"""
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class Facts:
    """
    Everything the score reads, already converted into one currency. Each area reads its own inputs, so a "what if"
    on one area (tips.py) changes only the facts that area looks at:
      consistency  -> income_months
      margin       -> income_total, expense_total, expense_count
      tax          -> has_ntn, has_pseb, recent_payment, recent_expense
      growth       -> recent_total, income_months (its length), earlier_months, earlier_total
      diversity    -> payers, unnamed_total, income_total
    `income_total` and `recent_total` are the same number when the facts are gathered.
    """
    currency: str
    months: int
    window_start: date
    window_end: date
    earlier_start: date
    earlier_end: date
    income_months: tuple          # ((YYYY-MM, Decimal), ...) effective months of the window, oldest first, zero-filled
    income_total: Decimal
    income_count: int
    recent_total: Decimal
    expense_total: Decimal
    expense_count: int
    expense_top: tuple | None     # (category key, label, Decimal) | None
    earlier_months: int
    earlier_total: Decimal
    payers: tuple                 # ((display name, Decimal), ...) named only, largest first
    unnamed_total: Decimal
    has_ntn: bool
    has_pseb: bool
    recent_payment: bool
    recent_expense: bool
    ever_paid: bool
    unconverted_payments: int
    unconverted_expenses: int


@dataclass(frozen=True)
class AreaResult:
    key: str
    status: str                   # 'scored' | 'not_enough_data'
    reason: str | None
    points: int | None
    max_points: int
    details: dict = field(default_factory=dict)

    @property
    def scored(self):
        return self.status == 'scored'


@dataclass(frozen=True)
class Overall:
    earned: int
    available: int
    score: int | None
    grade: str | None
    grade_label: str | None
    partial: bool


@dataclass(frozen=True)
class Action:
    dimension: str
    kind: str                     # 'improve' | 'record'
    text_key: str
    numbers: dict
    gain: int | None
