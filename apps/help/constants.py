# apps/help/constants.py
"""
Every number, vocabulary and word list of the Help module, in ONE place (Prompt 24). Nothing magic lives elsewhere: a limit
is changed here and in the test that pins it. The retrieval thresholds and TITLE_ALL_TERMS_BONUS are tuned only in Part 10a of
Prompt 24 and Part 3 of Prompt 25 (see AI_EVALUATION.md sections 15 and 15c); nothing else may change them.
"""
from .domain import Topic

# --- the question and the search box ---------------------------------------------------------------------------------
QUESTION_MIN_CHARS = 3            # after normalise
QUESTION_MAX_CHARS = 300
PREVIOUS_QUESTION_MAX_CHARS = 300
SEARCH_MIN_CHARS = 2
SEARCH_MAX_CHARS = 120
SEARCH_RESULT_LIMIT = 8

# --- what is sent to the model and shown to the person ----------------------------------------------------------------
ASK_GUIDE_LIMIT = 3               # guides sent to the model, at most
PROMPT_GUIDE_CHAR_BUDGET = 5000   # characters of guide text sent to the model, at most (a guide that does not fit whole is skipped)
GUIDES_ONLY_LIMIT = 5             # guides shown when there is no answer
GUIDE_MAX_PROMPT_CHARS = 1800     # per guide: title + summary + all block text

# --- the model's answer, as the guard sees it -------------------------------------------------------------------------
ANSWER_MIN_CHARS = 20
ANSWER_MAX_CHARS = 900
ANSWER_MAX_WORDS = 160

# --- limits ------------------------------------------------------------------------------------------------------------
ASK_PER_MINUTE = 6                # soft: more than this in 60 s -> outcome guides_only / slow_down (HTTP 200)
ASK_PER_HOUR = 120                # hard: more than this in an hour -> HTTP 429
AI_PER_HOUR = 30                  # run_ai_task(rate_limit_per_hour=...)
READS_PER_HOUR = 600              # GET /guides/ and /guides/<slug>/
SEARCH_PER_HOUR = 1200
RATE_PER_HOUR = 60

# --- cache and AI call -------------------------------------------------------------------------------------------------
CACHE_TTL_SECONDS = 24 * 60 * 60
CACHE_KEY_PREFIX = 'help:answer:v1:'
AI_FEATURE = 'help_assistant'
AI_MAX_TOKENS = 1500
AI_REASONING_EFFORT = 'low'
AI_TOTAL_BUDGET_SECONDS = 25

# --- retrieval thresholds (tuned only in Prompt 24 Part 10a and Prompt 25 Part 3; nothing else may change them) ----------
MIN_COVERAGE_TO_LIST = 0.34       # a guide is listed in results / as a "closest guide" at this coverage or more
MIN_COVERAGE_FOR_AI = 0.5         # the gate: the model is called only if the best match reaches this
TITLE_ALL_TERMS_BONUS = 0.7       # (Prompt 25) score x (1 + this x query terms / title terms) when EVERY query term is in the title
TK_COVERAGE_BONUS = 0.5           # score x (1 + this x the share of the question's terms found in the title or keywords)
PHRASE_BONUS = 2.0                # x idf of the rarest term of a multi-word keyword found whole in the question
BM25_K1 = 1.2
BM25_B = 0.75
FIELD_WEIGHTS = {'title': 3, 'keywords': 3, 'summary': 2, 'body': 1}
PREVIOUS_TERM_WEIGHT = 0.5
PREVIOUS_ONLY_BELOW_TERMS = 3     # the earlier question counts only when the current one has fewer terms than this

# --- vocabularies --------------------------------------------------------------------------------------------------------
OUTCOMES = ('answered', 'guides_only', 'off_topic')
REASONS = ('', 'no_match', 'not_covered', 'ai_off', 'ai_unavailable', 'answer_rejected', 'slow_down')
GUARD_REASONS = ('length', 'characters', 'link', 'number', 'banned', 'leak', 'action')
MODEL_STATUSES = ('ANSWER', 'NOT_COVERED', 'OFF_TOPIC')
BLOCK_TYPES = ('p', 'steps', 'note', 'link')

# --- the library's limits ------------------------------------------------------------------------------------------------
SLUG_MIN, SLUG_MAX = 3, 60
TITLE_MAX = 70
SUMMARY_MIN, SUMMARY_MAX = 40, 160
KEYWORDS_MIN, KEYWORDS_MAX = 4, 14
KEYWORD_MIN_CHARS, KEYWORD_MAX_CHARS = 2, 40
P_MAX, NOTE_MAX = 600, 300
STEPS_MIN, STEPS_MAX, STEP_MAX = 2, 8, 220
LINK_LABEL_MAX = 40
BLOCKS_MIN, BLOCKS_MAX = 1, 12
RELATED_MAX = 4
UI_LABEL_MIN, UI_LABEL_MAX = 2, 40
POPULAR_COUNT = 6
EXPECTED_GUIDE_COUNT = 48

# --- the words Help never uses (decision H15) -----------------------------------------------------------------------------
# One definition. Guides AND model answers are scanned for BANNED_PHRASES; guides alone for STYLE_WORDS.
BANNED_PHRASES = (
    'legally binding', 'legally valid', 'legal effect', 'enforceable', 'tamper-proof', 'guarantee', 'guaranteed',
    'certified', 'court', 'audit-proof', 'tax-free', 'tax free', 'exempt', 'penalty', 'penalties', 'premium',
    'upgrade', 'subscription', 'pricing', 'coming soon',
)
STYLE_WORDS = ('simply', 'just', 'easily', 'seamless', 'powerful', 'effortless')

# --- topics and the popular list (Appendix A) -----------------------------------------------------------------------------
TOPICS = (
    Topic('getting-started', 'Getting started', 'What LanceraOS does and where to begin.'),
    Topic('account', 'Your account and sign-in', 'Signing in, passwords, two-factor sign-in, devices and deleting your account.'),
    Topic('settings', 'Settings', 'Your business details, tax details, notifications and email sending.'),
    Topic('clients', 'Clients', 'Keeping client records, their reliability score, statements and the client portal.'),
    Topic('invoices', 'Invoices', 'Creating, sending, getting paid for and managing invoices.'),
    Topic('payments', 'Payments', 'Recording money you receive, importing it from a file, and how amounts are converted.'),
    Topic('expenses', 'Expenses', 'Recording what you spend.'),
    Topic('reports', 'Reports and scores', 'Profit and loss, your income statement and your health score.'),
    Topic('tax', 'Tax', 'What the Tax page shows, the calculator and the summary document.'),
    Topic('proposals', 'Proposals and AI', 'Writing, sending and converting proposals, and how AI is used.'),
    Topic('contracts', 'Contracts', 'Creating, sending and signing contracts.'),
    Topic('dashboard', 'Dashboard and notifications', 'What the dashboard shows and how notifications work.'),
)
POPULAR_SLUGS = (
    'create-an-invoice', 'send-an-invoice', 'record-a-payment', 'import-payments-from-a-file',
    'write-a-proposal-with-ai', 'the-tax-page',
)

# Spelled-out numbers (decision H15). `one` is deliberately absent: it is an ordinary article ("one of the tabs").
NUMBER_WORDS = (
    'zero', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
    'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty',
    'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
)

# Characters that never appear in shown text (guides) or in a model's answer (the guard): markdown and markup.
MARKUP_CHARS = frozenset('*#`<>[]{}|~_')

# The 48 guides of Appendix A: these slugs, no more and no fewer.
EXPECTED_SLUGS = (
    'what-is-lanceraos', 'first-steps', 'find-your-way-around',
    'sign-up-and-verify-your-email', 'reset-or-change-your-password', 'two-factor-sign-in', 'your-devices-and-sessions',
    'change-your-email-or-username', 'delete-your-account',
    'business-details-and-payment-methods', 'tax-and-pseb-details', 'notification-settings', 'send-emails-from-your-own-address',
    'add-and-manage-clients', 'client-reliability-score', 'client-statement', 'the-client-portal',
    'create-an-invoice', 'invoice-statuses', 'send-an-invoice', 'payment-reminders-and-formal-notice',
    'record-a-payment-on-an-invoice', 'recurring-invoices', 'invoice-templates-and-design',
    'invoice-messages-and-payment-claims', 'invoice-analytics', 'duplicate-and-delete-invoices',
    'record-a-payment', 'link-payments-to-invoices', 'import-payments-from-a-file', 'exchange-rates-and-converted-amounts',
    'record-an-expense',
    'profit-and-loss', 'income-statement', 'health-score',
    'the-tax-page', 'the-tax-calculator', 'the-tax-summary-pdf',
    'write-a-proposal-with-ai', 'proposal-score-and-tips', 'send-a-proposal', 'turn-a-proposal-into-an-invoice',
    'ai-features-in-lanceraos',
    'create-a-contract', 'send-and-sign-a-contract', 'signed-contracts-and-the-pdf',
    'your-dashboard', 'notifications',
)
