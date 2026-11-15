# apps/users/constants.py
"""
Small standalone constants shared across apps.users — kept in their own
file (rather than models.py or serializers.py) since both need to import
this, and models.py/serializers.py must not import from each other.
"""

# The version of the Terms of Service AND the Privacy Policy, an ISO date.
# It is the same string shown as "Version ..." at the top of both pages
# (frontend/src/pages/PrivacyPolicy.jsx and TermsOfService.jsx), and the two
# pages and this constant are changed TOGETHER: a test fails if they disagree.
# Bump it whenever a right or a duty in either document changes (STANDARDS.md,
# "Legal pages stay true"). Existing users are NOT retroactively required to
# re-accept, but User.terms_version records which version a given user actually
# agreed to, which matters if they're ever disputed.
CURRENT_TERMS_VERSION = '2026-11-15'
