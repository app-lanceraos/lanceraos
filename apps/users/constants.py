# apps/users/constants.py
"""
Small standalone constants shared across apps.users — kept in their own
file (rather than models.py or serializers.py) since both need to import
this, and models.py/serializers.py must not import from each other.
"""

# Bump this string whenever Terms of Service or Privacy Policy materially
# change — existing users are NOT retroactively required to re-accept,
# but this lets you know which version of the terms a given user
# actually agreed to, which matters if they're ever disputed.
CURRENT_TERMS_VERSION = '2026-08-01'
