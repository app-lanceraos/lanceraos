# apps/proposals/notifications.py
"""
Event handlers: every state change on a proposal writes a core.AuditLog row
(CLAUDE.md rule 10) through the core.events registry, the same shape as
apps/invoices/notifications.py. Registered by ProposalsConfig.ready().

Two kinds of handler, kept deliberately separate:

* AUDIT handlers write `proposal_*` rows ALWAYS. An audit row must not depend
  on a notification toggle: invoices once had a whole class of lifecycle
  events with no audit row at all (production audit finding INV-002), and a
  freelancer who switches "Client Messages" off must not erase the record of
  who accepted what, from which address, when. None of these events is in
  core/notifications.py's NOTIFICATION_EVENTS, so none shows in the bell.
* NOTICE handlers (the client answered) write a SECOND, differently-named row
  (`proposal_accepted_notice` / `proposal_declined_notice`, which ARE in the
  bell allowlist) and send the freelancer an email, both only when the
  freelancer's notif_client_messages toggle is on.

Metadata carries ids, numbers, method and counts only — NEVER proposal text,
the job post, the freelancer's experience or the client's message.
"""
import logging

from core.events import on
from core.observability import log_event

logger = logging.getLogger(__name__)


def _user_or_none(user_id, event_name):
    from apps.users.models import User

    try:
        return User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning('[PROPOSALS] %s handler: user_id=%s not found.', event_name, user_id)
        return None


@on('ProposalCreated')
def _record_proposal_created(proposal_id, user_id, duplicated_from=None, **_extra):
    user = _user_or_none(user_id, 'ProposalCreated')
    if user is not None:
        metadata = {'proposal_id': proposal_id}
        if duplicated_from is not None:
            metadata['duplicated_from'] = duplicated_from
        log_event('proposal_created', user=user, metadata=metadata)


@on('ProposalDeleted')
def _record_proposal_deleted(proposal_id, user_id, **_extra):
    user = _user_or_none(user_id, 'ProposalDeleted')
    if user is not None:
        log_event('proposal_deleted', user=user, metadata={'proposal_id': proposal_id})


@on('ProposalAiGenerated')
def _record_proposal_ai_generated(proposal_id, user_id, tone, model, regenerated=False, **_extra):
    user = _user_or_none(user_id, 'ProposalAiGenerated')
    if user is not None:
        log_event('proposal_ai_generated', user=user, metadata={
            'proposal_id': proposal_id, 'tone': tone, 'model': model, 'regenerated': regenerated,
        })


@on('ProposalSent')
def _record_proposal_sent(proposal_id, user_id, method, sent_via=None, fallback_used=False,
                          proposal_number=None, **_extra):
    """`method` is what the freelancer chose (email/link); `sent_via` is what actually carried it (custom_smtp/resend/link)."""
    user = _user_or_none(user_id, 'ProposalSent')
    if user is not None:
        log_event('proposal_sent', user=user, metadata={
            'proposal_id': proposal_id, 'proposal_number': proposal_number, 'method': method,
            'sent_via': sent_via, 'fallback_used': fallback_used,
        })


@on('ProposalViewed')
def _record_proposal_viewed(proposal_id, user_id, proposal_number=None, **_extra):
    """The first client view. No IP or user agent: those are stored only when the client ANSWERS."""
    user = _user_or_none(user_id, 'ProposalViewed')
    if user is not None:
        log_event('proposal_viewed', user=user, metadata={
            'proposal_id': proposal_id, 'proposal_number': proposal_number,
        })


@on('ProposalWithdrawn')
def _record_proposal_withdrawn(proposal_id, user_id, proposal_number=None, **_extra):
    user = _user_or_none(user_id, 'ProposalWithdrawn')
    if user is not None:
        log_event('proposal_withdrawn', user=user, metadata={
            'proposal_id': proposal_id, 'proposal_number': proposal_number,
        })


@on('ProposalConverted')
def _record_proposal_converted(proposal_id, user_id, invoice_id, client_created=False, **_extra):
    user = _user_or_none(user_id, 'ProposalConverted')
    if user is not None:
        log_event('proposal_converted', user=user, metadata={
            'proposal_id': proposal_id, 'invoice_id': invoice_id, 'client_created': client_created,
        })


@on('ProposalAnswered')
def _record_proposal_answered(proposal_id, user_id, decision, message_length=0, ip=None, user_agent='',
                              proposal_number=None, **_extra):
    """
    The audit row for an accept/decline. `ip` is the already-validated client
    address (or None) and, with `user_agent`, becomes the row's own request
    metadata — the evidence of who answered. Always written, regardless of the
    notification toggle (see the module docstring).
    """
    user = _user_or_none(user_id, 'ProposalAnswered')
    if user is None:
        return
    event = 'proposal_accepted' if decision == 'accept' else 'proposal_declined'
    log_event(event, user=user, ip_address=ip, user_agent=user_agent, metadata={
        'proposal_id': proposal_id, 'proposal_number': proposal_number, 'message_length': message_length,
    })


@on('ProposalAnswered')
def _notify_proposal_answered(proposal_id, user_id, decision, **_extra):
    """
    Bell + email to the freelancer, gated by their "Client Messages" toggle
    (notif_client_messages — a client's answer is a client communication; no
    new setting). Toggle off = no bell row and no email at all, the same
    convention as CommentPosted. Uses its own `*_notice` event names, separate
    from the audit rows written by _record_proposal_answered, precisely so
    that switching the toggle off removes the bell entry but never the audit
    row. The bell row is written first so a failing email cannot lose it.
    """
    from apps.users.models import User

    from core.email import send_email

    from .emails import build_proposal_answered_email
    from .models import Proposal

    try:
        user = User.objects.select_related('profile').get(pk=user_id)
    except User.DoesNotExist:
        logger.warning('[PROPOSALS] ProposalAnswered notice: user_id=%s not found.', user_id)
        return
    profile = getattr(user, 'profile', None)
    if profile is not None and not profile.notif_client_messages:
        return

    proposal = Proposal.objects.filter(pk=proposal_id, user=user).first()
    if proposal is None:
        return

    accepted = decision == 'accept'
    log_event('proposal_accepted_notice' if accepted else 'proposal_declined_notice', user=user, metadata={
        'proposal_id': proposal_id, 'proposal_number': proposal.proposal_number,
        'client_name': proposal.client_name,
    })

    subject, html_body, plain_body = build_proposal_answered_email(proposal, 'accepted' if accepted else 'declined')
    send_email(user.email, subject, html_body, plain_body)
