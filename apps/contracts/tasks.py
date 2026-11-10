# apps/contracts/tasks.py
"""
Celery tasks for Contracts (Prompt 22, decision K13).

send_signed_copies renders the signed PDF and emails it to the client (a client-facing email, so the freelancer's
custom SMTP is used when set) and to the freelancer (a platform email, only when their "Client Messages" toggle is
on). It runs in a worker, never inside the client's signing request. `signed_copies_sent_at` makes it idempotent.
"""
import logging

from celery import shared_task
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone

from core.email import pdf_bytes_to_attachment, send_client_facing_email, send_email_detailed

from .emails import build_contract_signed_client_email, build_contract_signed_owner_email
from .models import Contract

logger = logging.getLogger(__name__)


def _valid_email(value):
    try:
        validate_email((value or '').strip())
    except DjangoValidationError:
        return False
    return True


@shared_task(bind=True, name='apps.contracts.tasks.send_signed_copies', max_retries=3, default_retry_delay=120)
def send_signed_copies(self, contract_id):
    """
    Emails the signed contract (PDF attached) to the client and to the freelancer, once.

    The contract row is locked for the whole run, so two copies of this task (a retried delivery, a double enqueue)
    cannot both send. Returns at once if the contract is gone, is not `signed`, or already has `signed_copies_sent_at`.
    `signed_copies_sent_at` is set only if at least one email was sent or none was due; if sends were due and none
    succeeded, the task retries. A render failure is logged and retried and never touches the signed record.
    """
    failure = None
    with transaction.atomic():
        contract = Contract.objects.select_for_update(of=('self',)).filter(pk=contract_id).first()
        if contract is None or contract.status != 'signed' or contract.signed_copies_sent_at is not None:
            return {'status': 'skipped'}

        try:
            from apps.invoices.contract_pdf import attachment_filename, build_contract_context, render_contract_pdf

            pdf_bytes = render_contract_pdf(build_contract_context(contract))
            attachment = pdf_bytes_to_attachment(attachment_filename(contract), pdf_bytes)
        except Exception as exc:
            logger.exception('[CONTRACTS] Signed-copy PDF render failed for contract %s.', contract_id)
            failure = exc
        else:
            user = contract.user
            profile = getattr(user, 'profile', None)
            due = 0
            sent = 0

            if _valid_email(contract.client_email):
                due += 1
                subject, html_body, text_body = build_contract_signed_client_email(contract)
                result = send_client_facing_email(
                    user, contract.client_email.strip(), subject, html_body, text_body,
                    reply_to=user.email, attachments=[attachment], recipient_name=contract.client_name,
                    context_type='contract', context_id=str(contract.pk),
                )
                if result['sent']:
                    sent += 1
                else:
                    logger.error('[CONTRACTS] Signed copy to the client failed for contract %s: %s',
                                 contract_id, result.get('error'))

            if profile is None or profile.notif_client_messages:
                due += 1
                subject, html_body, text_body = build_contract_signed_owner_email(contract)
                result = send_email_detailed(user.email, subject, html_body, text_body, attachments=[attachment])
                if result['sent']:
                    sent += 1
                else:
                    logger.error('[CONTRACTS] Signed copy to the freelancer failed for contract %s: %s',
                                 contract_id, result.get('error'))

            if sent or not due:
                contract.signed_copies_sent_at = timezone.now()
                contract.save(update_fields=['signed_copies_sent_at', 'updated_at'])
                logger.info('[CONTRACTS] Signed copies sent for contract %s (%s of %s).', contract_id, sent, due)
                return {'status': 'sent', 'sent': sent, 'due': due}
            failure = RuntimeError('No signed copy could be sent.')

    raise self.retry(exc=failure)
