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

from core.ai import run_ai_task, strip_model_reply_wrapper
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


_MARKER_RE = {
    name: re.compile(rf'^[ \t]*=+[ \t]*{name}[ \t]*=+[ \t]*$', re.IGNORECASE | re.MULTILINE)
    for name in ('PROPOSAL', 'TIPS', 'END')
}
_TITLE_RE = re.compile(r'^[ \t]*TITLE[ \t]*:[ \t]*(.*)$', re.IGNORECASE | re.MULTILINE)
# A tip starts at "-", "*", a bullet, or "1." / "1)"; any other non-blank line continues the previous tip.
_BULLET_RE = re.compile(r'^\s*(?:[-*\u2022\u2013]|\d{1,2}[.)])\s*(.*)$')


def _clean_line(text):
    return _CONTROL_CHARS_RE.sub('', text.translate(_ASCII_FOLD)).strip()


def parse_proposal_reply(text):
    """
    Parses the model's delimited reply (prompts.REPLY_FORMAT) and returns
    {"title", "proposal_text", "tips"}. Raises ValueError on ANY violation,
    which run_ai_task turns into `invalid_output`. Nothing in the reply is
    executed, evaluated or rendered: it is plain text end to end.

    Format: an optional `TITLE:` line, `===PROPOSAL===`, the proposal,
    `===TIPS===`, bulleted tips, an optional `===END===`. Markers are whole
    lines, case-insensitive, spaces tolerated. Exactly one PROPOSAL and one
    TIPS marker in that order (a marker echoed twice — e.g. by an injected job
    post — is invalid), and no END before TIPS. TITLE is read only from the
    text before the PROPOSAL marker; any other preamble is ignored. Text after
    the first END is ignored.
    """
    text = strip_model_reply_wrapper(text or '').replace('\r\n', '\n').replace('\r', '\n')

    proposal_markers = list(_MARKER_RE['PROPOSAL'].finditer(text))
    tips_markers = list(_MARKER_RE['TIPS'].finditer(text))
    if len(proposal_markers) != 1 or len(tips_markers) != 1:
        raise ValueError('Expected exactly one PROPOSAL marker and one TIPS marker.')
    proposal_marker, tips_marker = proposal_markers[0], tips_markers[0]
    if tips_marker.start() < proposal_marker.end():
        raise ValueError('TIPS marker comes before the PROPOSAL marker.')
    end_markers = list(_MARKER_RE['END'].finditer(text))
    if any(m.start() < tips_marker.start() for m in end_markers):
        raise ValueError('END marker comes before the TIPS marker.')
    end_marker = next((m for m in end_markers if m.start() >= tips_marker.end()), None)

    title_match = _TITLE_RE.search(text[:proposal_marker.start()])
    title = _clean_line(title_match.group(1)) if title_match else ''
    if len(title) > MODEL_TITLE_MAX:
        raise ValueError('title is longer than 100 characters.')

    proposal_text = text[proposal_marker.end():tips_marker.start()].translate(_ASCII_FOLD)
    proposal_text = _CONTROL_CHARS_RE.sub('', proposal_text).strip()
    if not PROPOSAL_TEXT_MIN <= len(proposal_text) <= PROPOSAL_TEXT_MAX:
        raise ValueError('proposal text has an unusable length.')

    tips_block = text[tips_marker.end():end_marker.start() if end_marker else len(text)]
    tips = []
    for line in tips_block.split('\n'):
        if not line.strip():
            continue
        bullet = _BULLET_RE.match(line)
        if bullet:
            if bullet.group(1).strip():
                tips.append(bullet.group(1))
        elif tips:
            tips[-1] = f'{tips[-1]} {line}'
        else:
            tips.append(line)
    tips = [' '.join(_clean_line(tip).split()) for tip in tips]
    tips = [tip for tip in tips if tip]
    if not TIPS_MIN <= len(tips) <= TIPS_MAX:
        raise ValueError('expected 1-4 tips.')
    if any(len(tip) > TIP_MAX_CHARS for tip in tips):
        raise ValueError('a tip is longer than 240 characters.')

    return {'title': title, 'proposal_text': proposal_text, 'tips': tips}


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
    return generate_with_facts(
        facts=build_freelancer_facts(user), job_description=job_description, tone=tone,
        my_experience=my_experience, user=user, request_id=request_id,
    )


def generate_with_facts(*, facts, job_description, tone, my_experience, user=None, system=False, request_id=None):
    """
    The one place the generation request is built and sent. run_generation (production) and the evaluation
    harness (apps/proposals/evaluation, `system=True`, invented facts) both call THIS, so what is measured is
    exactly what users get; a test pins that both reach run_ai_task with the same arguments. `system` is
    forwarded only when true, so production's call to run_ai_task is unchanged.
    """
    messages = build_generation_messages(
        facts=facts, my_experience=my_experience, job_description=job_description, tone=tone,
    )
    extra = {'system': True} if system else {}
    return run_ai_task(
        feature=AI_FEATURE, user=user, model=settings.GROQ_MODEL_QUALITY, messages=messages,
        max_tokens=AI_MAX_TOKENS, reasoning_effort=AI_REASONING_EFFORT,
        parse=parse_proposal_reply, request_id=request_id,
        # Falls back to the smaller model ONLY when the big one is rate-limited or gone (core.ai
        # AI_FALLBACK_REASONS). There is deliberately no second API key: see DECISIONS.md, 02 Nov 2026.
        fallback_model=settings.GROQ_MODEL_FAST, **extra,
    )


def _first_line_title(job_description):
    for line in job_description.splitlines():
        if line.strip():
            return line.strip()[:TITLE_FALLBACK_MAX]
    return 'Proposal'


def save_new_proposal(user, generated, *, model, job_description, tone, my_experience, title='', client=None):
    """
    Creates the draft from a successful generation, in one atomic block, then emits the events.
    `model` is the model that ACTUALLY wrote the text (AiResult.model — the fallback model if it fell back).
    """
    with transaction.atomic():
        proposal = Proposal.objects.create(
            user=user, client=client,
            client_name=client.name if client else '', client_email=client.email if client else '',
            client_company=client.company if client else '',
            title=title.strip() or generated['title'] or _first_line_title(job_description),
            tone=tone, job_description=job_description, my_experience=my_experience,
            body=generated['proposal_text'], ai_tips=generated['tips'],
            ai_generated_at=timezone.now(), ai_model=model,
            currency=user.profile.default_currency, status='draft',
        )
    emit('ProposalCreated', proposal_id=str(proposal.pk), user_id=str(user.pk))
    emit('ProposalAiGenerated', proposal_id=str(proposal.pk), user_id=str(user.pk), tone=tone,
         model=model, regenerated=False)
    return proposal


def apply_regeneration(user, proposal_id, generated, *, model, job_description, tone, my_experience, title=''):
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
        proposal.ai_model = model
        proposal.save(update_fields=[
            'title', 'tone', 'job_description', 'my_experience', 'body', 'ai_tips',
            'ai_generated_at', 'ai_model', 'updated_at',
        ])
    emit('ProposalAiGenerated', proposal_id=str(proposal.pk), user_id=str(user.pk), tone=tone,
         model=model, regenerated=True)
    return proposal
