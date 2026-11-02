# apps/proposals/scoring.py
"""
The proposal quality score (1-10), computed by CODE — pure, deterministic,
DB-free and AI-free, in the style of apps/clients/scoring.py.

Why code and not the model (owner decision, 02 November 2026, replacing the
original spec's "the AI returns a quality score"): "AI explains, code
calculates". A number the user reads and acts on must be reproducible — the
same text always gets the same score and every point can be pointed at — and a
language model grading its own output is neither. The model writes the text and
a few job-specific tips; this module counts.

score_proposal(body, job_description) runs 7 explainable checks worth 10
points. The score counts how many of them the text passes; it is NOT a
prediction of winning the job (the explanation field says so, in plain words).

  length      2  120-350 words = 2; 80-119 or 351-500 = 1; otherwise 0
  key_terms   3  share of the job post's top-8 key terms found in the proposal:
                 >=75% = 3, >=50% = 2, >=25% = 1, else 0. N/A with no job post
                 (or one with no usable terms)
  next_step   1  a clear call to action
  specifics   1  at least one number written with digits
  no_cliches  1  none of the stock opening/closing cliches
  readability 1  average sentence <= 24 words AND longest paragraph <= 120 words
  structure   1  2-8 paragraphs

score = clamp(round(earned / possible * 10), 1, 10), where `possible` leaves
out N/A checks, so a proposal with no job post is scored out of 7 and scaled
to 10. An empty body scores 1 with every check at 0.

The word/phrase lists below are FROZEN constants: changing one changes every
score, so edit them deliberately (and the golden tests with them).
"""
import re
from collections import Counter

MAX_SCORE = 10

EXPLANATION = (
    'This score counts how many of 7 simple checks your proposal passes (length, how many of the job '
    "post's key terms you used, a clear next step, a specific number, no stock cliches, readable "
    'sentences and paragraphs). It is not a prediction of whether you will win the job.'
)

# ── length ─────────────────────────────────────────────────────────
LENGTH_FULL_RANGE = (120, 350)
LENGTH_PARTIAL_RANGES = ((80, 119), (351, 500))

# ── key terms ──────────────────────────────────────────────────────
KEY_TERM_COUNT = 8
_TOKEN_RE = re.compile(r'[a-z0-9][a-z0-9+#.\-]*')
# Tokens shorter than 3 characters are dropped EXCEPT these, which are real
# skills/fields in a job post.
SHORT_TERM_ALLOWLIST = frozenset({'ui', 'ux', 'ai', 'qa', 'js', 'c#', 'ml'})
# Common English words plus job-post boilerplate that says nothing about the
# work. Checked against the raw token AND its crude singular.
STOPWORDS = frozenset("""
a about above across after again against all almost also although always am among an and another any anyone
anything are around as at away back be became because become been before being below between both but by can
cannot come could did do does doing done down during each either else enough even ever every few for from get
getting give given go going good got great had has have having he her here hers him his how however i if in
into is it its just keep know last least less let like likely made make many may me might more most much must
my need needed needs never new no nor not now of off often on once one only onto or other our out over own per
please put quite rather really right same see seem several shall she should since so some something sometimes
still such take than that the their them then there these they thing things this those though through to too
under until up upon us use used using very want was way we well were what when where whether which while who
whom whose why will with within without would yet you your yours
looking need required requirement requirements experience experienced project projects freelancer freelancers
budget skills skill team years year work working worked job role position candidate ideal strong excellent
responsible responsibilities ability able knowledge understanding familiar proven track record seeking hire
hiring apply applicants applicant opportunity company client clients business provide provided providing
include including includes must-have nice-to-have plus bonus asap immediately urgent urgently looking-for
don isn aren won didn doesn wasn weren couldn shouldn wouldn haven hasn hadn etc
""".split())

# ── call to action ─────────────────────────────────────────────────
# FROZEN and deliberately CONSERVATIVE: a phrase is here only if it is, on its own, a call to action. The
# bare words 'available' and 'happy to' used to be on this list and passed any text containing them ("the
# data is available from the API", "happy to say the app is fast") — they are now only matched in the
# specific forms below. Adding a phrase changes every score, so change it deliberately (and the golden tests).
NEXT_STEP_PHRASES = (
    "let's discuss", "let's talk", "let's schedule", "let's chat", "let's connect", "let us discuss",
    'happy to discuss', 'happy to chat', 'happy to jump', 'happy to hop', 'happy to answer',
    'available for a', 'available to', "i am available", "i'm available", 'available this', 'available next',
    'glad to', 'next step', 'look forward', 'reach out', 'get back to you',
    'book a call', 'schedule a call', 'quick call', 'short call', 'short discussion', 'get started',
    # added after real model output was seen missing a plain call to action (02 November 2026):
    'brief call', 'could we schedule', 'convenient time', 'hop on', 'set up a call',
)

# ── cliches ────────────────────────────────────────────────────────
CLICHES = (
    'dear sir', 'dear sir/madam', 'to whom it may concern', 'i am writing to apply',
    'i am the best', 'i can do this job', '100% satisfaction', 'i have gone through your job',
    'i have read your job', 'i am an expert in everything', 'hard working and dedicated',
    'i will do my best', 'please give me a chance', 'i am a hardworking',
)

# ── readability / structure ────────────────────────────────────────
MAX_AVERAGE_SENTENCE_WORDS = 24
MAX_PARAGRAPH_WORDS = 120
PARAGRAPH_RANGE = (2, 8)

_SENTENCE_SPLIT_RE = re.compile(r'[.!?]+(?:\s+|$)|\n+')
_PARAGRAPH_SPLIT_RE = re.compile(r'\n\s*\n')
_DIGIT_RE = re.compile(r'\d')


def _crude_singular(token):
    """Strip one trailing 's' from tokens longer than 3 chars that do not end in 'ss'."""
    if len(token) > 3 and token.endswith('s') and not token.endswith('ss'):
        return token[:-1]
    return token


def _tokens(text):
    """Lowercased tokens with trailing '.'/'-' stripped (so 'react.' and 'react' match)."""
    return [t for t in (raw.rstrip('.-') for raw in _TOKEN_RE.findall((text or '').lower())) if t]


def extract_key_terms(job_description):
    """
    The job post's top KEY_TERM_COUNT distinct terms: [(normalised, display)],
    ranked by frequency (ties: first occurrence). `display` is the first form
    the post used; `normalised` is the crude-singular form both sides are
    compared in. Pure-number tokens are not terms (a budget or a year says
    nothing about the work), nor are stopwords or 1-2 character tokens other
    than SHORT_TERM_ALLOWLIST.
    """
    counts = Counter()
    first_seen = {}
    display = {}
    for index, token in enumerate(_tokens(job_description)):
        if token.isdigit():
            continue
        if len(token) < 3 and token not in SHORT_TERM_ALLOWLIST:
            continue
        normalised = _crude_singular(token)
        if token in STOPWORDS or normalised in STOPWORDS:
            continue
        counts[normalised] += 1
        first_seen.setdefault(normalised, index)
        display.setdefault(normalised, token)
    ranked = sorted(counts, key=lambda term: (-counts[term], first_seen[term]))[:KEY_TERM_COUNT]
    return [(term, display[term]) for term in ranked]


def _check(check_id, label, status, points, possible, detail):
    return {'id': check_id, 'label': label, 'status': status, 'points': points, 'possible': possible, 'detail': detail}


def _binary(check_id, label, passed, detail):
    return _check(check_id, label, 'pass' if passed else 'fail', 1 if passed else 0, 1, detail)


def _check_length(words):
    low, high = LENGTH_FULL_RANGE
    if low <= words <= high:
        return _check('length', 'Length', 'pass', 2, 2, f'{words} words. A good proposal is {low}-{high} words.')
    if any(a <= words <= b for a, b in LENGTH_PARTIAL_RANGES):
        side = 'short' if words < low else 'long'
        return _check('length', 'Length', 'partial', 1, 2, f'{words} words is a little {side}. Aim for {low}-{high}.')
    side = 'short' if words < low else 'long'
    return _check('length', 'Length', 'fail', 0, 2, f'{words} words is too {side}. Aim for {low}-{high}.')


def _check_key_terms(proposal_tokens, job_description):
    terms = extract_key_terms(job_description) if (job_description or '').strip() else []
    if not terms:
        return _check('key_terms', 'Uses the job post\'s key terms', 'n/a', 0, 0,
                      'No job post was provided, so this check is skipped.')
    present = {_crude_singular(t) for t in proposal_tokens}
    missing = [display for normalised, display in terms if normalised not in present]
    covered = len(terms) - len(missing)
    share = covered / len(terms)
    if share >= 0.75:
        status, points = 'pass', 3
    elif share >= 0.5:
        status, points = 'partial', 2
    elif share >= 0.25:
        status, points = 'partial', 1
    else:
        status, points = 'fail', 0
    detail = f'{covered} of {len(terms)} key terms covered.'
    if missing:
        detail += f' Missing: {", ".join(missing)}.'
    return _check('key_terms', "Uses the job post's key terms", status, points, 3, detail)


def _check_next_step(lowered):
    lowered = lowered.replace('\u2019', "'")  # models write curly apostrophes ("Let’s", "I’m")
    found = next((p for p in NEXT_STEP_PHRASES if p in lowered), None)
    detail = (f'Found a clear next step ("{found}").' if found else
              'No clear next step. End with one specific, low-pressure ask, e.g. "Happy to jump on a short call this week."')
    return _binary('next_step', 'Clear next step', bool(found), detail)


def _check_specifics(body):
    found = bool(_DIGIT_RE.search(body))
    detail = ('Contains a specific number.' if found else
              'No numbers. A concrete detail (years, a count, a percentage) makes a proposal feel real.')
    return _binary('specifics', 'Specific details', found, detail)


def _check_cliches(lowered):
    found = next((c for c in CLICHES if c in lowered), None)
    detail = f'Contains a stock phrase: "{found}". Replace it with something specific.' if found else 'No stock cliches found.'
    return _binary('no_cliches', 'No stock cliches', not found, detail)


def _check_readability(body):
    sentences = [len(s.split()) for s in _SENTENCE_SPLIT_RE.split(body) if s.split()]
    paragraphs = [len(p.split()) for p in _PARAGRAPH_SPLIT_RE.split(body) if p.split()]
    average = sum(sentences) / len(sentences) if sentences else 0
    longest = max(paragraphs) if paragraphs else 0
    passed = average <= MAX_AVERAGE_SENTENCE_WORDS and longest <= MAX_PARAGRAPH_WORDS
    if passed:
        detail = f'Average sentence {average:.0f} words, longest paragraph {longest} words.'
    else:
        problems = []
        if average > MAX_AVERAGE_SENTENCE_WORDS:
            problems.append(f'average sentence is {average:.0f} words (keep it under {MAX_AVERAGE_SENTENCE_WORDS})')
        if longest > MAX_PARAGRAPH_WORDS:
            problems.append(f'longest paragraph is {longest} words (keep it under {MAX_PARAGRAPH_WORDS})')
        detail = 'Hard to skim: ' + ' and '.join(problems) + '.'
    return _binary('readability', 'Easy to read', passed, detail)


def _check_structure(body):
    count = len([p for p in _PARAGRAPH_SPLIT_RE.split(body) if p.strip()])
    low, high = PARAGRAPH_RANGE
    passed = low <= count <= high
    if passed:
        detail = f'{count} paragraphs.'
    elif count < low:
        detail = f'{count} paragraph. Break it into {low}-{high} short paragraphs separated by blank lines.'
    else:
        detail = f'{count} paragraphs is too many. Keep it to {high} or fewer.'
    return _binary('structure', 'Clear structure', passed, detail)


def score_proposal(body, job_description=''):
    """
    Deterministic quality score for a proposal text. Returns
    {"score", "max", "earned", "possible", "explanation", "checks": [...]}.
    Never raises for any string input, including non-English text.
    """
    body = body or ''
    if not body.strip():
        # Every check at 0 points. Built explicitly: run on '' the cliche and
        # readability checks would "pass" vacuously, which is not what an
        # empty proposal deserves.
        checks = [
            _check_length(0),
            _check_key_terms([], job_description),
            _check_next_step(''),
            _check_specifics(''),
            _binary('no_cliches', 'No stock cliches', False, 'There is no text yet.'),
            _binary('readability', 'Easy to read', False, 'There is no text yet.'),
            _check_structure(''),
        ]
        return {'score': 1, 'max': MAX_SCORE, 'earned': 0, 'possible': sum(c['possible'] for c in checks),
                'explanation': EXPLANATION, 'checks': checks}

    lowered = body.lower()
    words = len(body.split())
    checks = [
        _check_length(words),
        _check_key_terms(_tokens(body), job_description),
        _check_next_step(lowered),
        _check_specifics(body),
        _check_cliches(lowered),
        _check_readability(body),
        _check_structure(body),
    ]
    earned = sum(c['points'] for c in checks)
    possible = sum(c['possible'] for c in checks)
    # Integer half-up rounding of earned / possible * 10 (no float, no banker's rounding).
    scaled = (earned * MAX_SCORE * 2 + possible) // (2 * possible)
    return {
        'score': max(1, min(MAX_SCORE, scaled)), 'max': MAX_SCORE, 'earned': earned, 'possible': possible,
        'explanation': EXPLANATION, 'checks': checks,
    }
