# apps/help/guides/account.py
"""Guides: your account and sign-in (sign-up, passwords, two-factor, devices, email and username, deletion)."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'sign-up-and-verify-your-email', 'Sign up and confirm your email', 'account',
        'Create an account with your email or with Google, and confirm your email address.',
        ['register', 'create account', 'signup', 'verify', 'verification email', 'confirm email', 'google', 'login', 'sign in', 'log in', 'spam'],
        [
            p('You can sign up with your email, or continue with Google. With your email, you go through a short form: your name and date of birth, then your email address and username, then a password.'),
            p('Before the form is sent, LanceraOS asks you to confirm the email address, so a typing mistake does not send your link to the wrong place. Choose "Edit email" to fix it, or "Yes, that\'s correct" to go on.'),
            steps(
                'Open the sign-up page and fill in the three parts of the form.',
                'Check your email address in the confirmation box.',
                'Open the verification email and press its link. Look in your spam or junk folder if you do not see it.',
                'Come back and sign in with your email or username.',
            ),
            note('If the email did not arrive, use "Resend Verification Email" on the Check Your Email page.'),
        ],
        related=['reset-or-change-your-password', 'first-steps', 'two-factor-sign-in'],
        ui_labels=['Edit email', "Yes, that's correct", 'Resend Verification Email'],
        sources=['frontend/src/pages/Register.jsx', 'frontend/src/pages/Login.jsx', 'frontend/src/pages/EmailVerificationPending.jsx', 'frontend/src/pages/VerifyEmail.jsx'],
        checked_on=TODAY),
    guide(
        'reset-or-change-your-password', 'Reset or change your password', 'account',
        'Reset a forgotten password, change your password while signed in, or add a password to a Google account.',
        ['forgot password', 'reset link', 'new password', 'lost password', 'cannot sign in', 'locked out', 'add password', 'google account', 'sign in', 'log in'],
        [
            p('If you cannot sign in, open the sign-in page and choose the forgotten password link. Enter your email address and LanceraOS sends you a reset link. Open it and choose a new password.'),
            p('If you are already signed in, open Settings, then "Security", and use "Change Password". You enter your current password and the new one twice. Changing it signs you out of your other devices.'),
            p('If you are signed in but do not know your current password, press "Email Me a Reset Link" in the same card. The link signs you out of every device, including this one.'),
            note('If your account was made with Google, it has no password yet. In "Security", press "Add a Password" and follow the link in the email. Adding a password also lets you turn on two-factor sign-in.'),
            link('Open Security settings', '/settings?tab=security'),
        ],
        related=['two-factor-sign-in', 'your-devices-and-sessions', 'sign-up-and-verify-your-email'],
        ui_labels=['Security', 'Change Password', 'Email Me a Reset Link', 'Add a Password'],
        sources=['frontend/src/pages/ForgotPassword.jsx', 'frontend/src/pages/ResetPassword.jsx', 'frontend/src/pages/settings/SecuritySection.jsx', 'frontend/src/pages/AddPassword.jsx'],
        checked_on=TODAY),
    guide(
        'two-factor-sign-in', 'Two-factor sign-in', 'account',
        'Turn on a code sent to your email each time you sign in, and turn it off again.',
        ['2fa', 'two factor', 'two step', 'otp', 'verification code', 'security code', 'authenticator', 'trusted device', 'sign in', 'log in'],
        [
            p('With two-factor sign-in on, signing in with your email and password also needs a code that LanceraOS emails to you. This protects your account if someone learns your password.'),
            steps(
                'Open Settings and choose "Security".',
                'In the "Two-Factor Authentication" card, type your password and press "Enable".',
                'To turn it off later, type your password and press "Disable". LanceraOS emails you a code.',
                'Enter the code and press "Verify and Disable".',
            ),
            p('When you sign in, the code page has a box called "Do not ask again on this device". Tick it on a device you trust and LanceraOS skips the code there.'),
            note('Two-factor sign-in needs a password. If your account uses Google only, add a password first.'),
            link('Open Security settings', '/settings?tab=security'),
        ],
        related=['reset-or-change-your-password', 'your-devices-and-sessions'],
        ui_labels=['Security', 'Two-Factor Authentication', 'Enable', 'Disable', 'Verify and Disable', 'Do not ask again on this device'],
        sources=['frontend/src/pages/settings/SecuritySection.jsx', 'frontend/src/pages/TwoFAVerify.jsx'], checked_on=TODAY),
    guide(
        'your-devices-and-sessions', 'Your devices and sessions', 'account',
        'See where you are signed in, rename a device and sign other devices out.',
        ['sessions', 'devices', 'logged in', 'sign out other device', 'revoke', 'rename device', 'login limit', 'active sessions', 'sign in', 'log in', 'logout', 'log out'],
        [
            p('Open Settings and choose "Sessions". The "Active Sessions" card lists the devices that are signed in to your account. Its subtitle tells you how many devices can be signed in at one time.'),
            steps(
                'Open Settings and choose "Sessions".',
                'Find the device in the list. Your own device is marked "This device".',
                'Press "Sign Out" next to any other device to end its session.',
                'Use the pencil beside a device name, "Rename this device", to give it a name you will recognise.',
            ),
            note('If you do not recognise a device, sign it out and change your password.'),
            link('Open Sessions', '/settings?tab=sessions'),
        ],
        related=['two-factor-sign-in', 'reset-or-change-your-password'],
        ui_labels=['Sessions', 'Active Sessions', 'This device', 'Sign Out', 'Rename this device'],
        sources=['frontend/src/pages/settings/SessionsSection.jsx'], checked_on=TODAY),
    guide(
        'change-your-email-or-username', 'Change your email or username', 'account',
        'Change your name and username in Settings, and change your email through a confirmation link.',
        ['change email', 'new email', 'update email', 'username', 'account settings', 'name', 'date of birth', 'email address'],
        [
            p('Open Settings and stay on "Account". The "Personal Information" card holds your first name, last name, username and date of birth. Change them and press the save button.'),
            p('Your email is in its own card, "Email Address". Press "Change Email Address". LanceraOS sends a link to your current email first. On the page that opens you type your new address and your password, and then a link goes to the new inbox. Press it to finish the change.'),
            note('You can change your email only once in a while. The Account page tells you how long you wait. To stop a change that is waiting, press "Cancel Email Change".'),
            note('The email card is not shown for an account that uses Google only and has no password.'),
            link('Open Account settings', '/settings?tab=account'),
        ],
        related=['reset-or-change-your-password', 'delete-your-account'],
        ui_labels=['Account', 'Personal Information', 'Email Address', 'Change Email Address', 'Cancel Email Change'],
        sources=['frontend/src/pages/settings/AccountSection.jsx', 'frontend/src/pages/ChangeEmail.jsx', 'frontend/src/pages/ActivateEmail.jsx'],
        checked_on=TODAY),
    guide(
        'delete-your-account', 'Delete your account', 'account',
        'Delete your account from Settings, and cancel it by signing in again before it is final.',
        ['remove account', 'close account', 'deactivate', 'danger zone', 'erase data', 'restore account', 'cancel deletion'],
        [
            p('Open Settings, choose "Security" and find the "Danger Zone" card. Deleting your account is scheduled, not instant. You can cancel by signing in again before the waiting period ends.'),
            steps(
                'In "Danger Zone", type your password and press "Send Verification Code".',
                'Enter the code from your email and press "Verify and Continue".',
                'Read the review page. It lists what will be deleted and says you will be signed out of every device.',
                'Press "Yes, Delete My Account" to schedule the deletion, or "Cancel — Keep My Account" to stop.',
            ),
            note('If your account uses Google only, you confirm with that sign-in instead of a password.'),
            note('When you sign in again during the waiting period, LanceraOS asks if you want to restore your account.'),
        ],
        related=['reset-or-change-your-password', 'change-your-email-or-username'],
        ui_labels=['Security', 'Danger Zone', 'Send Verification Code', 'Verify and Continue', 'Yes, Delete My Account', 'Cancel — Keep My Account'],
        sources=['frontend/src/pages/settings/SecuritySection.jsx', 'frontend/src/pages/DeletionReview.jsx'], checked_on=TODAY),
)
