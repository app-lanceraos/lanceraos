# apps/help/copy.py
"""
Every sentence the Help module writes itself (Prompt 24, Appendix C), in one place, so a test can scan them all for the words
Help never uses (constants.BANNED_PHRASES). Pure strings plus one helper that appends to core.ai's own safe user messages.
"""
from core.ai import AI_USER_MESSAGES

NO_MATCH = "I couldn't find that in the Help guides. Try different words, or start with one of these."
NOT_COVERED = "The guides don't cover that yet. These are the closest ones."
AI_OFF = 'Written answers are switched off right now. These guides match your question.'
ANSWER_REJECTED = "I couldn't put together a reliable answer to that. These guides are the closest match."
SLOW_DOWN = "You're asking quickly. Wait a moment, then ask again. These guides match your question."
OFF_TOPIC = 'I can only help with using LanceraOS.'

AI_UNAVAILABLE_TAIL = ' These guides match your question.'

# The 400 / 404 / 429 sentences (the project's {"error": "..."} shape).
ERR_QUESTION_MISSING = 'Type your question.'
ERR_QUESTION_SHORT = 'Type a few more words.'
ERR_QUESTION_LONG = 'Please keep your question under 300 characters.'
ERR_PREVIOUS_BAD = 'Something went wrong with your question. Please try again.'
ERR_SEARCH_SHORT = 'Type at least 2 letters to search.'
ERR_SEARCH_LONG = 'Search words are too long.'
ERR_GUIDE_NOT_FOUND = "That guide doesn't exist."
ERR_TOO_MANY = 'Too many requests. Please try again later.'
ERR_RATE_HELPFUL = 'Choose helpful or not helpful.'
ERR_RATE_GUIDES = 'Pick the guides this answer came from.'


def ai_unavailable_notice(reason):
    """core.ai's own safe sentence for the failure reason, then the fixed tail. An unknown reason gets the generic one."""
    return AI_USER_MESSAGES.get(reason, AI_USER_MESSAGES['upstream_error']) + AI_UNAVAILABLE_TAIL


NOTICE_BY_REASON = {
    'no_match': NO_MATCH, 'not_covered': NOT_COVERED, 'ai_off': AI_OFF, 'answer_rejected': ANSWER_REJECTED,
    'slow_down': SLOW_DOWN,
}
ALL_FIXED = (NO_MATCH, NOT_COVERED, AI_OFF, ANSWER_REJECTED, SLOW_DOWN, OFF_TOPIC, AI_UNAVAILABLE_TAIL, ERR_QUESTION_MISSING,
             ERR_QUESTION_SHORT, ERR_QUESTION_LONG, ERR_PREVIOUS_BAD, ERR_SEARCH_SHORT, ERR_SEARCH_LONG,
             ERR_GUIDE_NOT_FOUND, ERR_TOO_MANY, ERR_RATE_HELPFUL, ERR_RATE_GUIDES)
