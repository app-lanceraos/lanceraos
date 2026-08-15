# apps/invoices/notifications.py
"""
Event handlers — the "plain functions living next to the code they
affect" pattern INVOICES_CLIENTS_TECHNICAL_SPEC.md's Business Event
System section describes, e.g. "a handler in apps/invoices/
notifications.py that turns InvoicePaid into an AuditLog write". This is
the first module to actually add one: InvoiceSent has been emitted since
Step 1 with zero registered handlers (confirmed directly — grepping for
`@on(` anywhere in the codebase before this file existed returned
nothing), and CustomSmtpFailed (email_service.py, this step) is a new
emit with nowhere to go without this file either.

Registered via apps/invoices/apps.py's InvoicesConfig.ready() — importing
this module is what runs its @on(...) decorators; nothing else imports it.

WebSocket push for the bell itself (core/notifications.py's
list_notifications) still isn't built — that endpoint reads AuditLog via
polling. Step 13 DOES add a real WebSocket push, but for a narrower
purpose (apps.invoices.comments.broadcast_comment, invoice-thread comment
delivery only) — not a generalization of this bell.
"""
import logging

from core.events import on
from core.observability import log_event

logger = logging.getLogger(__name__)


@on('InvoiceSent')
def _record_invoice_sent(invoice_id, user_id, via, **_extra):
    """
    AuditLog write for both the real send (via='platform') and the
    manual mark-sent flip (via='manual', already emitted by
    invoice_mark_sent since before this file existed) — this is simply
    the first handler that ever consumes it. Not added to
    core/notifications.py's NOTIFICATION_EVENTS allowlist: an "invoice
    sent" ping to the freelancer who just clicked Send themselves isn't
    information they don't already have, unlike custom_smtp_failed
    below, which tells them something they couldn't otherwise know
    happened.
    """
    from apps.users.models import User

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning('[INVOICES] InvoiceSent handler: user_id=%s not found.', user_id)
        return

    log_event('invoice_sent', user=user, metadata={'invoice_id': invoice_id, 'via': via})


@on('CustomSmtpFailed')
def _record_custom_smtp_failed(user_id, recipient_email, smtp_host, error_message,
                                recipient_name=None, context_type=None, context_id=None, **_extra):
    """
    The in-app notification CLAUDE.md's Custom Email Rule 4 requires,
    with its exact specified copy — this AuditLog write is what
    core/notifications.py's list_notifications endpoint (the bell) reads
    once 'custom_smtp_failed' is added to its NOTIFICATION_EVENTS/
    EVENT_TITLES/EVENT_ACTION_URLS dicts (done in that file, Step 10).

    core.email.send_client_facing_email (promoted out of this app's own
    email_service.py this pass, Step 11) emits this event with generic
    recipient_name/recipient_email/context_type/context_id kwargs now,
    since it's no longer invoice-only — a client-portal magic-link resend
    (apps.clients) can trigger the exact same failure/fallback and this
    same handler processes it identically, with no import needed in
    either direction (core/events.py's bus is app-agnostic by design).
    This handler still writes the same AuditLog metadata SHAPE the
    invoice call site always has (`invoice_id`/`client_name`/
    `client_email` keys), preserved by construction rather than by
    coincidence: apps/invoices/email_service.py's wrapper always passes
    context_type='invoice', context_id=str(invoice.pk),
    recipient_name=invoice.client_name — this handler maps context_id to
    the `invoice_id` key only when context_type == 'invoice', so a
    non-invoice caller's metadata simply omits it rather than storing a
    misleading value.
    user_id/smtp_host/error_message/fallback_used=True/timestamp are all
    captured here — timestamp is AuditLog.created_at itself, not a
    separate field.
    """
    from apps.users.models import User

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning('[INVOICES] CustomSmtpFailed handler: user_id=%s not found.', user_id)
        return

    log_event('custom_smtp_failed', user=user, metadata={
        'invoice_id': context_id if context_type == 'invoice' else None,
        'client_name': recipient_name,
        'client_email': recipient_email,
        'smtp_host': smtp_host,
        'error_message': error_message,
        'fallback_used': True,
    })


@on('CommentPosted')
def _record_comment_posted(invoice_id, user_id, comment_id, author_type, **_extra):
    """
    The immediate in-app bell notification CLAUDE.md's Client Messaging
    section requires: "When client sends a message: immediate in-app
    notification to freelancer." Deliberately CLIENT-authored comments
    only — a freelancer posting their own comment doesn't need a bell
    ping about their own action, the same reasoning _record_invoice_sent
    above already established for a self-triggered send.

    Respects the recipient's notif_client_messages toggle (CLAUDE.md:
    "comment_posted maps to notif_client_messages") at the write layer,
    not just filtered out of the response later — every notification a
    user receives beyond security alerts is one they've explicitly
    enabled, so an opted-out freelancer should never even get the
    AuditLog row written, matching this project's established
    opt-out-means-truly-no-notification convention.

    The batched unread-after-1hr email (apps/invoices/tasks.py's
    notify_unread_comments) is a SEPARATE mechanism from this immediate
    ping — this handler fires once, right away, regardless of whether
    the freelancer ever reads it; the batch task is what covers "still
    unread an hour later."
    """
    if author_type != 'client':
        return

    from .models import Invoice
    from apps.users.models import User

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning('[INVOICES] CommentPosted handler: user_id=%s not found.', user_id)
        return

    try:
        profile = user.profile
    except Exception:
        profile = None
    if profile is not None and not profile.notif_client_messages:
        return

    invoice = Invoice.objects.filter(pk=invoice_id).first()

    log_event('comment_posted', user=user, metadata={
        'invoice_id': invoice_id,
        'comment_id': comment_id,
        'client_name': invoice.client_name if invoice else None,
        'invoice_number': invoice.invoice_number if invoice else None,
    })


@on('PaymentClaimSubmitted')
def _notify_payment_claim_submitted(invoice_id, user_id, claim_id, **_extra):
    """
    Section 6's 'In-app + immediate' tier for payment_claim_submitted:
    both the bell (AuditLog write, read by core/notifications.py's
    list_notifications) and a real, immediate email to the freelancer —
    unlike comment_posted's bell-only-now/email-batched-later split,
    this event's own table row lists 'Email? Yes' with no batching
    caveat, so both fire from the same handler, gated together behind
    one notif_payments check (CLAUDE.md: "payment-related events" map to
    notif_payments, not notif_client_messages, even though the claim
    itself arrives via the client portal).
    """
    from apps.users.models import User
    from core.email import send_email

    from .email_service import build_payment_claim_submitted_email
    from .models import Invoice, PaymentClaim

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning('[INVOICES] PaymentClaimSubmitted handler: user_id=%s not found.', user_id)
        return

    try:
        profile = user.profile
    except Exception:
        profile = None
    if profile is not None and not profile.notif_payments:
        return

    invoice = Invoice.objects.filter(pk=invoice_id).first()
    claim = PaymentClaim.objects.filter(pk=claim_id).first()
    if invoice is None or claim is None:
        return

    log_event('payment_claim_submitted', user=user, metadata={
        'invoice_id': invoice_id,
        'claim_id': claim_id,
        'client_name': claim.client_name,
        'invoice_number': invoice.invoice_number,
        'amount_claimed': str(claim.amount_claimed),
        'currency': claim.currency,
    })

    subject, html_body, plain_body = build_payment_claim_submitted_email(invoice, claim)
    send_email(user.email, subject, html_body, plain_body)


@on('PaymentClaimConfirmed')
def _notify_payment_claim_confirmed(invoice_id, claim_id, **_extra):
    """
    Section 6's payment_claim_confirmed: email to the CLIENT (a separate
    "thanks, confirmed" template), routed through
    core.email.send_client_facing_email — the standard client-facing
    chain, per CLAUDE.md's Custom Email Rule 2. No AuditLog/bell entry
    here: the freelancer triggered this themselves by clicking Confirm
    (same self-trigger exclusion InvoiceSent/CommentPosted already
    establish elsewhere in this file), and there's no client-side bell
    to notify into.
    """
    from core.email import send_client_facing_email

    from .email_service import build_payment_claim_confirmed_email
    from .models import Invoice, PaymentClaim

    invoice = Invoice.objects.filter(pk=invoice_id).first()
    claim = PaymentClaim.objects.filter(pk=claim_id).first()
    if invoice is None or claim is None:
        return
    if not invoice.client_email:
        return  # a one-time client with no email on record — nothing to notify

    subject, html_body, plain_body = build_payment_claim_confirmed_email(invoice, claim)
    send_client_facing_email(
        invoice.user, invoice.client_email, subject, html_body, plain_body,
        recipient_name=invoice.client_name, context_type='invoice', context_id=str(invoice.pk),
    )
