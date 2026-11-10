# apps/contracts/copy.py
"""
Every sentence of the Contracts module that a person reads and that is shared by more than one layer (Prompt 22,
Appendix B). Defined once so a test can scan them all for the words the module must never use (decision K16):
claims about legal effect, certification or identity checks, and marketing words.
"""

# -- Owner errors -------------------------------------------------------------------------------------------------
NOT_DRAFT_CHANGE = 'Only a draft can be changed. This contract has already been {word}.'
SIGNER_NAME_REQUIRED = 'Type your full name to sign the contract before sending.'
CONFIRM_SEND = 'Confirm that you want to send this contract.'
CONFIRM_WITHDRAW = 'Confirm that you want to withdraw this contract.'
ALREADY_SENT = 'This contract has already been sent.'
ALREADY_STATE = 'This contract has already been {word}.'
EMAIL_FAILED = 'Could not send this contract by email: {detail}. It is still a draft.'
DRAFTS_ARE_DELETED = 'Drafts are deleted, not withdrawn.'
NOT_WITHDRAWABLE = 'This contract has already been {status}, so it cannot be withdrawn.'
PROPOSAL_NOT_ACCEPTED = 'Only an accepted proposal can be turned into a contract.'
TOO_MANY_SENDS = 'You have sent a lot of contracts recently. Please try again later.'
TOO_MANY_ACTIONS = 'Too many actions. Please try again later.'
TEMPLATE_CANNOT_CHANGE = 'The template cannot be changed after the contract is created.'
SCOPE_TOO_LONG = "The proposal's scope was too long to copy, so the Scope of work section still needs your text."

# -- Send problems (services.send_problem), in the order they are checked ------------------------------------------
SEND_NO_TITLE = 'Add a title before sending.'
SEND_NO_CLIENT_NAME = "Add the client's name before sending."
SEND_EMPTY_SECTION = 'Every section needs a title and text before sending.'
SEND_PLACEHOLDER = 'Fill in or remove the text in double square brackets in the section "{title}".'
SEND_NO_FEE = 'Add the fee or the payment terms before sending.'
SEND_NO_SIGN_BY = 'Set a sign-by date before sending.'
SEND_SIGN_BY_PASSED = 'The sign-by date has passed. Choose a future date.'
SEND_NO_CLIENT_EMAIL = "Add the client's email address to send by email, or choose Copy link."

# -- Public errors -------------------------------------------------------------------------------------------------
NOT_FOUND = 'Not found.'
TOO_MANY_REQUESTS = 'Too many requests. Please try again in a little while.'
NAME_REQUIRED = 'Type your full name to sign.'
NAME_LENGTH = 'Your name must be between 2 and 120 characters.'
NAME_NEEDS_LETTERS = 'Use letters in your name.'
AGREE_REQUIRED = 'Tick the box to confirm you agree.'
OWN_CONTRACT = "You can't sign your own contract."
WITHDRAWN = 'This contract has been withdrawn.'
ALREADY_ANSWERED = 'This contract has already been answered.'
EXPIRED = 'This contract is past its sign-by date.'
INTEGRITY = 'This contract can no longer be signed. Please ask the sender to send it again.'
REASON_TOO_LONG = 'Your reason is {n} characters too long.'
NOT_SIGNED_YET = 'The signed copy is available after the contract is signed.'
RENDER_FAILED = 'Could not create the PDF. Please try again.'

# -- Email lines ---------------------------------------------------------------------------------------------------
EMAIL_SENT_INTRO = '{sender} has sent you a contract to review and sign.'
EMAIL_RECORDED = 'When you sign, we record the name you type, the time, your IP address and your browser details.'
EMAIL_BUTTON = 'Review and sign'
EMAIL_SIGNED_COPY = 'A copy of the signed contract is attached.'

# -- PDF chrome ----------------------------------------------------------------------------------------------------
PDF_STATUS_DRAFT = 'Draft - not signed'
PDF_STATUS_AWAITING = "Awaiting the client's signature"
PDF_STATUS_SIGNED = 'Signed on {when} PKT'
PDF_STATUS_DECLINED = 'Declined on {when}'
PDF_STATUS_WITHDRAWN = 'Withdrawn'
PDF_NOT_SIGNED_YET = 'Not signed yet'
PDF_SIGNED_LINE = 'Signed electronically on {when} PKT'
PDF_FINGERPRINT_LABEL = 'Document fingerprint (SHA-256):'
PDF_FINGERPRINT_NOTE = (
    'The fingerprint is calculated from the text of this contract when it was sent. '
    'If any word changes, the fingerprint changes.'
)
PDF_SIGNING_NOTE = 'Each person signed by typing their name. Times are Pakistan time (PKT).'

# -- Words the module must never use in any sentence a person reads (decision K16) ---------------------------------
BANNED_WORDS = [
    'legally binding', 'legally valid', 'legal effect', 'enforceable', 'certified', 'verified', 'tamper-proof',
    'guarantee', 'official', 'advanced', 'secure', 'court', 'seamless', 'powerful', 'easily', 'simply', 'just',
]
# The clause library legitimately says "courts of Pakistan"; it is scanned for the marketing words only.
MARKETING_WORDS = ['seamless', 'powerful', 'easily', 'simply', 'just', 'secure', 'official', 'advanced']
