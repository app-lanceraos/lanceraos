# apps/contracts/notifications.py
"""
Event handlers: every state change on a contract writes a core.AuditLog row (CLAUDE.md rule 10) through the
core.events registry, the same shape as apps/proposals/notifications.py. Registered by ContractsConfig.ready().

Two kinds of handler, kept deliberately separate (decision K14):

* AUDIT handlers write `contract_*` rows ALWAYS. An audit row must not depend on a notification toggle: a freelancer
  who switches "Client Messages" off must not erase the record of who signed what, from which address, when. None of
  these events is in core/notifications.py's NOTIFICATION_EVENTS, so none shows in the bell.
* NOTICE handlers (the client signed / declined) write a SECOND, differently-named row (`contract_signed_notice` /
  `contract_declined_notice`, which ARE in the bell allowlist), only when the freelancer's notif_client_messages
  toggle is on. The "declined" notice also emails the freelancer. The "signed" notice sends NO email here: the signed
  copies (and the freelancer's email with the PDF) are sent by the Celery task apps.contracts.tasks.send_signed_copies,
  never inside the client's request.

Metadata carries ids, numbers, method, hashes and counts only - NEVER contract text, a typed name, the client's reason
or an email address. The one exception is the bell row's `client_name` (the name the freelancer typed for the client),
which the bell sentence "{client} signed your contract {number}." needs, exactly as the Proposals bell row does.
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
        logger.warning('[CONTRACTS] %s handler: user_id=%s not found.', event_name, user_id)
        return None


@on('ContractCreated')
def _record_contract_created(contract_id, user_id, template_key=None, duplicated_from=None, **_extra):
    user = _user_or_none(user_id, 'ContractCreated')
    if user is not None:
        metadata = {'contract_id': contract_id, 'template_key': template_key}
        if duplicated_from is not None:
            metadata['duplicated_from'] = duplicated_from
        log_event('contract_created', user=user, metadata=metadata)


@on('ContractDeleted')
def _record_contract_deleted(contract_id, user_id, **_extra):
    user = _user_or_none(user_id, 'ContractDeleted')
    if user is not None:
        log_event('contract_deleted', user=user, metadata={'contract_id': contract_id})


@on('ContractSent')
def _record_contract_sent(contract_id, user_id, method, sent_via=None, fallback_used=False, contract_number=None,
                          content_hash='', ip=None, user_agent='', **_extra):
    """
    `method` is what the freelancer chose (email/link); `sent_via` is what actually carried it (custom_smtp/resend/
    link). `ip` and `user_agent` are the freelancer's own, from the moment they signed by sending.
    """
    user = _user_or_none(user_id, 'ContractSent')
    if user is not None:
        log_event('contract_sent', user=user, ip_address=ip, user_agent=user_agent, metadata={
            'contract_id': contract_id, 'contract_number': contract_number, 'method': method,
            'sent_via': sent_via, 'fallback_used': fallback_used, 'content_hash': content_hash,
        })


@on('ContractViewed')
def _record_contract_viewed(contract_id, user_id, contract_number=None, **_extra):
    """The first client view. No IP or user agent: those are stored only when the client signs or declines."""
    user = _user_or_none(user_id, 'ContractViewed')
    if user is not None:
        log_event('contract_viewed', user=user, metadata={'contract_id': contract_id, 'contract_number': contract_number})


@on('ContractWithdrawn')
def _record_contract_withdrawn(contract_id, user_id, contract_number=None, **_extra):
    user = _user_or_none(user_id, 'ContractWithdrawn')
    if user is not None:
        log_event('contract_withdrawn', user=user, metadata={'contract_id': contract_id, 'contract_number': contract_number})


@on('ContractSigned')
def _record_contract_signed(contract_id, user_id, contract_number=None, content_hash='', ip=None, user_agent='', **_extra):
    """
    The audit row for a signature. `ip` is the already-validated client address (or None) and, with `user_agent`,
    becomes the row's own request metadata - the evidence of who signed. Always written, regardless of the
    notification toggle. The typed name is NOT in the metadata.
    """
    user = _user_or_none(user_id, 'ContractSigned')
    if user is not None:
        log_event('contract_signed', user=user, ip_address=ip, user_agent=user_agent, metadata={
            'contract_id': contract_id, 'contract_number': contract_number, 'content_hash': content_hash,
        })


@on('ContractDeclined')
def _record_contract_declined(contract_id, user_id, contract_number=None, reason_length=0, ip=None, user_agent='', **_extra):
    user = _user_or_none(user_id, 'ContractDeclined')
    if user is not None:
        log_event('contract_declined', user=user, ip_address=ip, user_agent=user_agent, metadata={
            'contract_id': contract_id, 'contract_number': contract_number, 'reason_length': reason_length,
        })


def _notice_context(user_id, contract_id, event_name):
    """(user, contract) when the freelancer wants client-communication notices and the contract exists, else None."""
    from apps.users.models import User

    from .models import Contract

    try:
        user = User.objects.select_related('profile').get(pk=user_id)
    except User.DoesNotExist:
        logger.warning('[CONTRACTS] %s notice: user_id=%s not found.', event_name, user_id)
        return None
    profile = getattr(user, 'profile', None)
    if profile is not None and not profile.notif_client_messages:
        return None
    contract = Contract.objects.filter(pk=contract_id, user=user).first()
    if contract is None:
        return None
    return user, contract


@on('ContractSigned')
def _notify_contract_signed(contract_id, user_id, **_extra):
    """The bell row, gated by "Client Messages". The email with the signed PDF is the Celery task's job."""
    found = _notice_context(user_id, contract_id, 'ContractSigned')
    if found is None:
        return
    user, contract = found
    log_event('contract_signed_notice', user=user, metadata={
        'contract_id': contract_id, 'contract_number': contract.contract_number, 'client_name': contract.client_name,
    })


@on('ContractDeclined')
def _notify_contract_declined(contract_id, user_id, **_extra):
    """Bell + email to the freelancer, gated by "Client Messages". The bell row is written first so a failing email cannot lose it."""
    from core.email import send_email

    from .emails import build_contract_declined_owner_email

    found = _notice_context(user_id, contract_id, 'ContractDeclined')
    if found is None:
        return
    user, contract = found
    log_event('contract_declined_notice', user=user, metadata={
        'contract_id': contract_id, 'contract_number': contract.contract_number, 'client_name': contract.client_name,
    })
    subject, html_body, plain_body = build_contract_declined_owner_email(contract)
    send_email(user.email, subject, html_body, plain_body)
