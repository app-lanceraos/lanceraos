# apps/proposals/notifications.py
"""
Event handlers: every state change a freelancer makes on a proposal writes a
core.AuditLog row (CLAUDE.md rule 10) through the core.events registry, the
same shape as apps/invoices/notifications.py. Registered by
ProposalsConfig.ready().

Metadata carries ids, tone and model only — NEVER proposal text, the job post
or the freelancer's experience. Deliberately not in core/notifications.py's
NOTIFICATION_EVENTS: the user triggers each of these herself, so a bell ping
would tell her nothing she does not already know.
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
def _record_proposal_created(proposal_id, user_id, **_extra):
    user = _user_or_none(user_id, 'ProposalCreated')
    if user is not None:
        log_event('proposal_created', user=user, metadata={'proposal_id': proposal_id})


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
