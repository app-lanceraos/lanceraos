# apps/contracts/constants.py
"""Every limit and fixed list of the Contracts module, named once (Prompt 22)."""
import re

SECTION_MAX = 30
TITLE_MAX = 200
SECTION_TITLE_MAX = 120
SECTION_TEXT_MAX = 6000
TOTAL_TEXT_MAX = 60000
PAYMENT_TERMS_MAX = 2000
NAME_MIN = 2
NAME_MAX = 120
MESSAGE_MAX = 1000

GET_LIMIT_PER_HOUR = 120
SIGN_LIMIT_PER_HOUR = 10
DECLINE_LIMIT_PER_HOUR = 10
PUBLIC_PDF_LIMIT_PER_HOUR = 20
MUTATIONS_PER_HOUR = 60
# Autosave sends a PATCH about every 1.5 s while someone types; 60/hour would lock them out after ~90 s of typing.
UPDATES_PER_HOUR = 600
SENDS_PER_HOUR = 10

TOKEN_MAX_LENGTH = 32  # Contract.view_token's column width

# The text a freelancer still has to write is wrapped in double square brackets in the template.
PLACEHOLDER_RE = re.compile(r'\[\[.*?\]\]', re.DOTALL)

TEMPLATE_KEYS = ['web_development', 'design', 'consulting', 'content_writing', 'custom']
TEMPLATE_CHOICES = [
    ('web_development', 'Web Development'),
    ('design', 'Design'),
    ('consulting', 'Consulting'),
    ('content_writing', 'Content Writing'),
    ('custom', 'Custom'),
]

# draft -> sent -> viewed -> signed | declined, and sent/viewed -> withdrawn.
# `expired` is NOT a status: it is computed on read (Contract.is_expired).
STATUS_CHOICES = [
    ('draft', 'Draft'),
    ('sent', 'Sent'),
    ('viewed', 'Viewed'),
    ('signed', 'Signed'),
    ('declined', 'Declined'),
    ('withdrawn', 'Withdrawn'),
]

SENT_VIA_CHOICES = [
    ('email', 'Email'),
    ('link', 'Link'),
]

AWAITING_RESPONSE_STATUSES = ('sent', 'viewed')
