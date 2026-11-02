# apps/proposals/services.py
"""
AI proposal generation. The model call (core.ai.run_ai_task) happens OUTSIDE
any database transaction — it can take tens of seconds and must never hold a
transaction or a row lock (STANDARDS.md "AI calls") — and the result is saved
in ONE short transaction afterwards. If the call fails, nothing is created or
changed.
"""
import logging
import re

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from core.ai import parse_json_object, run_ai_task
from core.events import emit

from .models import Proposal
from .prompts import FREELANCER_FACT_FIELDS, build_generation_messages

logger = logging.getLogger(__name__)

AI_FEATURE = 'proposal_generate'
AI_MAX_TOKENS = 4000          # reasoning tokens count against this; ~3x the measured need for 'medium'
AI_REASONING_EFFORT = 'medium'  # 'high' ran out of tokens on a proposal-sized task (DECISIONS.md, 02 Nov 2026)

PROPOSAL_TEXT_MIN, PROPOSAL_TEXT_MAX = 400, 8000
TIPS_MIN, TIPS_MAX, TIP_MAX_CHARS = 1, 4, 240
MODEL_TITLE_MAX = 100
TITLE_FALLBACK_MAX = 80

_CONTROL_CHARS_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
# Typographic look-alikes the model emits that break word matching: a non-breaking
# hyphen (U+2011) and a non-breaking / narrow no-break space become their plain ASCII forms.
_ASCII_FOLD = str.maketrans({'\u2011': '-', '\u00a0': ' ', '\u202f': ' '})


class ProposalNotEditable(Exception):
    """The proposal stopped being a draft while the model was working."""


def parse_proposal_reply(text):
    """
    Validates the model's reply and returns {"title", "proposal_text", "tips"}.
    Raises ValueError on ANY violation, which run_ai_task turns into
    `invalid_output`. Unknown extra keys are ignored.
    """
    data = parse_json_object(text)

    proposal_text = data.get('proposal_text')
    if not isinstance(proposal_text, str):
        raise ValueError('proposal_text must be a string.')
    # A model that double-escapes its paragraph breaks leaves a literal backslash-n in the text
    # (seen live, 02 November 2026); no real proposal contains one, so it is decoded to a newline.
    proposal_text = proposal_text.translate(_ASCII_FOLD).replace('\\n', '\n')
    proposal_text = proposal_text.replace('\r\n', '\n').replace('\r', '\n')
    proposal_text = _CONTROL_CHARS_RE.sub('', proposal_text).strip()
    if not PROPOSAL_TEXT_MIN <= len(proposal_text) <= PROPOSAL_TEXT_MAX:
        raise ValueError('proposal_text has an unusable length.')

    tips = data.get('tips')
    if not isinstance(tips, list) or not TIPS_MIN <= len(tips) <= TIPS_MAX:
        raise ValueError('tips must be a list of 1-4 strings.')
    cleaned_tips = []
    for tip in tips:
        if not isinstance(tip, str) or not tip.strip() or len(tip.strip()) > TIP_MAX_CHARS:
            raise ValueError('every tip must be a non-empty string of at most 240 characters.')
        cleaned_tips.append(_CONTROL_CHARS_RE.sub('', tip).strip())

    title = data.get('title', '')
    if title is None:
        title = ''
    if not isinstance(title, str) or len(title.strip()) > MODEL_TITLE_MAX:
        raise ValueError('title must be a string of at most 100 characters.')

    return {'title': _CONTROL_CHARS_RE.sub('', title).strip(), 'proposal_text': proposal_text, 'tips': cleaned_tips}


def build_freelancer_facts(user):
    """Only the allowlisted profile fields (prompts.FREELANCER_FACT_FIELDS), never the whole profile."""
    profile = user.profile
    facts = {}
    for field in FREELANCER_FACT_FIELDS:
        value = (getattr(profile, field, '') or '').strip()
        if value:
            facts[field] = value
    return facts


def run_generation(user, *, job_description, tone, my_experience, request_id=None):
    """The model call. Returns core.ai.AiResult; touches the database only for the AiCallLog row."""
    messages = build_generation_messages(
        facts=build_freelancer_facts(user), my_experience=my_experience,
        job_description=job_description, tone=tone,
    )
    return run_ai_task(
        feature=AI_FEATURE, user=user, model=settings.GROQ_MODEL_QUALITY, messages=messages,
        max_tokens=AI_MAX_TOKENS, reasoning_effort=AI_REASONING_EFFORT,
        parse=parse_proposal_reply, request_id=request_id,
    )


def _first_line_title(job_description):
    for line in job_description.splitlines():
        if line.strip():
            return line.strip()[:TITLE_FALLBACK_MAX]
    return 'Proposal'


def save_new_proposal(user, generated, *, job_description, tone, my_experience, title='', client=None):
    """Creates the draft from a successful generation, in one atomic block, then emits the events."""
    with transaction.atomic():
        proposal = Proposal.objects.create(
            user=user, client=client,
            client_name=client.name if client else '', client_email=client.email if client else '',
            client_company=client.company if client else '',
            title=title.strip() or generated['title'] or _first_line_title(job_description),
            tone=tone, job_description=job_description, my_experience=my_experience,
            body=generated['proposal_text'], ai_tips=generated['tips'],
            ai_generated_at=timezone.now(), ai_model=settings.GROQ_MODEL_QUALITY,
            currency=user.profile.default_currency, status='draft',
        )
    emit('ProposalCreated', proposal_id=str(proposal.pk), user_id=str(user.pk))
    emit('ProposalAiGenerated', proposal_id=str(proposal.pk), user_id=str(user.pk), tone=tone,
         model=settings.GROQ_MODEL_QUALITY, regenerated=False)
    return proposal


def apply_regeneration(user, proposal_id, generated, *, job_description, tone, my_experience, title=''):
    """
    Replaces a draft's body/tips with a fresh generation. Re-reads the row
    under a lock and re-checks it is still a draft (the model call took
    seconds, and part 2's send could have raced it). The user's own title
    wins; otherwise an existing title is kept (it may have been edited by
    hand), then the model's, then the job post's first line.
    """
    with transaction.atomic():
        proposal = Proposal.objects.select_for_update().get(pk=proposal_id, user=user)
        if proposal.status != 'draft':
            raise ProposalNotEditable()
        proposal.title = (title.strip() or proposal.title.strip() or generated['title']
                          or _first_line_title(job_description))
        proposal.tone = tone
        proposal.job_description = job_description
        proposal.my_experience = my_experience
        proposal.body = generated['proposal_text']
        proposal.ai_tips = generated['tips']
        proposal.ai_generated_at = timezone.now()
        proposal.ai_model = settings.GROQ_MODEL_QUALITY
        proposal.save(update_fields=[
            'title', 'tone', 'job_description', 'my_experience', 'body', 'ai_tips',
            'ai_generated_at', 'ai_model', 'updated_at',
        ])
    emit('ProposalAiGenerated', proposal_id=str(proposal.pk), user_id=str(user.pk), tone=tone,
         model=settings.GROQ_MODEL_QUALITY, regenerated=True)
    return proposal
