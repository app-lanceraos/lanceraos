# apps/admin_panel/constants.py
# Admin access may only ever be granted to an email on this domain —
# checked both when granting access and independently again at every
# admin login, so a mistakenly-set flag on the wrong account still
# can't actually be used to log in.
ADMIN_EMAIL_DOMAIN = 'lanceraos.com'
