# apps/invoices/payment_details.py
"""
Builds the public payment-details payload for one invoice — the data
behind the frontend's `/invoice/<token>/pay` page, the destination of
`Invoice.payment_page_url` (the PDF's QR code and "Pay online" link).

Reads the freelancer's CURRENT FreelancerProfile on purpose, never a
frozen copy. This is a deliberate contrast with the invoice document
itself: the PDF is frozen at finalise so a later profile edit can never
silently change a legal document a client already received, but payment
INSTRUCTIONS are the opposite kind of data — if the freelancer changes
their bank account tomorrow, every still-unpaid invoice should send money
to the new one, not to an account they may have closed. See DECISIONS.md
(21 September 2026, "Public payment-details page").

Only methods the freelancer has genuinely configured are returned — a
method with nothing set is omitted entirely, never an empty row. Every
credential-shaped field (wise_access_token / wise_refresh_token, SMTP
password, encrypted CNIC/NTN) is out of reach by construction: the
allowlist below names each field it reads explicitly, nothing iterates
the profile's own fields.
"""

# 'created' (finalised, not yet sent) is payable on purpose: the PDF and
# its QR code exist from finalise onward, and a freelancer can hand that
# PDF over directly without ever pressing Send.
PAYABLE_STATUSES = ('created', 'sent', 'viewed', 'partially_paid')

# (method key, display label, [(profile attribute, row label), ...]) —
# one entry per payment method. Order is the display order. A method
# appears iff at least one of its attributes is non-blank; within a
# method, only the non-blank attributes become rows (a bank name with no
# account number yields a Bank row alone rather than an empty
# "Account number").
PAYMENT_METHOD_SPECS = (
    ('bank_transfer', 'Bank transfer', (
        ('bank_name', 'Bank'),
        ('bank_account_number', 'Account number'),
    )),
    ('payoneer', 'Payoneer', (
        ('payoneer_email', 'Payoneer email'),
    )),
    ('jazzcash', 'JazzCash', (
        ('jazzcash_number', 'JazzCash number'),
    )),
    ('easypaisa', 'Easypaisa', (
        ('easypaisa_number', 'Easypaisa number'),
    )),
    # wise_profile_id is the one non-secret Wise field on the profile; the
    # sibling wise_access_token/wise_refresh_token are OAuth credentials
    # and are never read here — see apps/invoices/templates/invoices/
    # _partials/payment_block.html for the same rule on the PDF side.
    ('wise', 'Wise', (
        ('wise_profile_id', 'Wise profile'),
    )),
)


def build_payment_methods(profile):
    """The configured payment methods for one FreelancerProfile, in display order."""
    methods = []
    for key, label, field_specs in PAYMENT_METHOD_SPECS:
        fields = [
            {'label': row_label, 'value': value}
            for attr, row_label in field_specs
            if (value := (getattr(profile, attr) or '').strip())
        ]
        if fields:
            methods.append({'key': key, 'label': label, 'fields': fields})
    return methods


def build_payment_details(invoice):
    """
    The full public payload for GET /api/invoices/portal/view/<token>/payment-details/.

    `accepts_payment` is False for a paid/cancelled/refunded/bad-debt
    invoice (and a created-but-unsent one is treated as payable, since its
    QR code may already be in a client's hands) — in that case
    `payment_methods` is empty rather than merely hidden client-side, so
    a settled invoice's link never keeps advertising bank details nobody
    owes money to anymore.
    """
    profile = invoice.user.profile
    accepts_payment = invoice.status in PAYABLE_STATUSES and invoice.outstanding_amount > 0
    return {
        'business_name': profile.business_name or profile.display_name,
        'invoice_number': invoice.invoice_number,
        'status': invoice.status,
        'currency': invoice.currency,
        'total': str(invoice.total),
        'outstanding_amount': str(invoice.outstanding_amount),
        'accepts_payment': accepts_payment,
        'payment_methods': build_payment_methods(profile) if accepts_payment else [],
    }
