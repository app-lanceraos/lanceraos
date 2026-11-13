# apps/users/migrations/0018_remove_facebook_social_accounts.py
"""
Facebook sign-in was removed in Prompt 27 (13 November 2026). The Meta app was never created, so no real account can hold a
`facebook` row in `user_social_accounts`; this migration still deletes any that exist, then drops 'facebook' from the
provider choices.

Why the rows are DELETED instead of left behind: `User.is_oauth_only()` is "has a social account AND no usable password", and
"Forgot password" deliberately sends nothing to an OAuth-only account. A leftover Facebook-only row would therefore leave its
owner unable to sign in (no Facebook button any more) AND unable to recover (no reset email). With the row deleted the account
is an ordinary account with no password and no social link, `is_oauth_only()` is False, and "Forgot password" works.

Order matters: the rows go first, then the field's choices change.
"""
from django.db import migrations, models


def delete_facebook_social_accounts(apps, schema_editor):
    """Removes every UserSocialAccount whose provider is 'facebook'. Users are never touched."""
    UserSocialAccount = apps.get_model('users', 'UserSocialAccount')
    UserSocialAccount.objects.filter(provider='facebook').delete()


def cannot_restore_facebook_social_accounts(apps, schema_editor):
    """
    Reverse is deliberately a no-op: the deleted links cannot be restored (their provider ids are gone). Reversing this migration
    restores only the 'facebook' choice on the field.
    """


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0017_alter_freelancerprofile_invoice_template'),
    ]

    operations = [
        migrations.RunPython(delete_facebook_social_accounts, cannot_restore_facebook_social_accounts),
        migrations.AlterField(
            model_name='usersocialaccount',
            name='provider',
            field=models.CharField(choices=[('google', 'Google')], max_length=20),
        ),
    ]
