# User & Admin Module Feedback — Finalized Plan

**Status: COMPLETE.** All 12 items built, verified against the real repo, and — beyond the
original list — a follow-up comprehensive review found and fixed one additional real bug
(`AddPassword.jsx`'s stale user-state issue) and closed five rate-limiting gaps surfaced by the
project-wide audit conducted alongside items 11/12. See `DECISIONS.md` for full details on every
entry below.

Not yet implemented — this is the agreed plan after a full round of discussion. Each item notes
the final decision and why.

---

## User module

**1. Confirm email before sending verification.** Agreed. A lightweight confirmation moment
between account creation and the pending screen, not a new wizard step.

**2. Username re-editable in onboarding for everyone, even people who already chose one at
registration.** Agreed, real redundancy. Fix: shown only for OAuth users (mirrors the existing
`needsDob` pattern exactly) — hidden entirely for email/password users.

**3. Forgot-password message reveals nothing about whether an account exists.** Kept as-is,
deliberately — this is the standard anti-enumeration protection already used consistently
elsewhere in the app (`resend_verification`, etc.). Confirmed: no change.

**4. Email-change section shown to OAuth users.** **Finalized approach, simpler than first
discussed:** Google/Facebook-linked accounts never see the email-change section at all — not
hidden-with-a-warning, just genuinely not applicable to them. Only accounts using LanceraOS's own
email/password system can change their email. (Once an OAuth user adds a password — see #8 — they
are, from that point on, also a "dedicated auth system" user and this section becomes relevant to
them too, consistent with the rest of this plan.)

**5. Notification links don't navigate correctly if already on Settings.** Confirmed real bug,
root cause found: the tab-selection logic only reads the URL's `tab` parameter once, at initial
mount, and never again — since clicking a different notification while already on `/settings`
doesn't remount the page, the tab visually never updates. Fix: watch for that parameter to change
after the page has already loaded, not just once.

**6. Onboarding data (profession/income source/platform) editable-to-empty later in Settings.**
**Finalized: remove entirely from Settings/anywhere outside onboarding.** These are asked once,
during onboarding, and never touched again afterward — not editable, not clearable, no Settings UI
for them at all.

**7. Save button shows disabled ("No changes") vs. hidden entirely until something changes.**
**Finalized: hidden entirely until a real change is made** — your call, noted.

**8. OAuth users cannot add a password, and cannot delete their account at all today.**
**Finalized approach:**
- Google/Facebook users can add a real password (its own confirmation flow, since there's no
  existing password to verify against — email confirmation is the natural mechanism).
- **Account deletion does NOT require adding a password first** — an OAuth-only user can delete
  their account using the same re-authentication (sign in again via Google/Facebook) as their
  proof of identity, the equivalent of "enter your password" for an email/password account. This
  is a genuinely good, cleaner design than what was first proposed — deletion shouldn't be gated
  behind an unrelated feature (adding a password) that someone may not want at all.
- **2FA does require a password first** — since 2FA specifically protects the email/password
  login path, it's meaningless without one; the messaging should say so plainly.
- Confirmed real, separate bug found during this discussion: `Register.jsx`'s OAuth buttons don't
  check for a pending deletion at all (unlike `Login.jsx`'s, which do this correctly) — someone
  whose Google account is already linked to an existing, deletion-scheduled account could click
  "Sign up with Google" on the Register page and be silently logged back in with no restore
  choice shown. Needs the same handling `Login.jsx` already has, added to `Register.jsx` too.

**9. Auto-suggested username from email doesn't offer an alternative when taken.** Confirmed real
(`suggestUsername()` genuinely exists in `Register.jsx`, and genuinely doesn't try alternatives).
Agreed — when the suggested/typed username is taken, suggest a real, available alternative rather
than just saying "not available."

**10. Default 2FA on for `@lanceraos.com` signups.** Agreed, low-risk convenience since you
control that domain entirely.

## Admin module

**11. Admin's own "viewed the audit log" action clutters the top of their own view.** Agreed. Fix:
keep logging it (real forensic value in knowing who reviewed the log and when) but exclude it from
the *default* view of the log itself — still fully visible if explicitly searched for. Also add a
quick "all activity" vs. "admin actions only" toggle (the `actor` filter already technically
supports this, just without a one-click shortcut).

**12. Only successful actions are logged, not failures.** Clarified scope: failed *logins* already
are logged correctly (both regular and admin). The genuine gap is failed *admin actions* — a
regular admin attempting to suspend a super-admin, or attempting to grant admin access without
being a super-admin, and getting correctly rejected, currently leaves no record at all. Agreed,
worth fixing — arguably the most valuable thing to have a record of if an admin account is ever
compromised.

## Cross-cutting

**Rate limiting across every input-accepting endpoint.** Agreed this needs its own real,
systematic pass — confirming what already has throttling, adding it where genuinely missing,
rather than the ad-hoc way it's accumulated so far.

---

## Status: complete

Every item above is built and verified against the real repository. Two things beyond the
original 12, found during a dedicated follow-up review:
- **Real bug found and fixed**: `AddPassword.jsx` didn't refresh the app's cached user state after
  success, leaving someone who added a password while already logged in stuck seeing the old
  restricted view until a hard refresh.
- **Five rate-limiting gaps closed**, surfaced by the audit conducted alongside items 11/12:
  `save_custom_smtp`, `change_password`/`toggle_2fa`, `google_login`/`facebook_login`,
  `complete_email_change_step1`, and `upload_logo`.

Two small feature ideas raised during the same review, not yet built (worth considering
separately, not part of this plan's original scope): a "my actions only" quick filter in the
admin audit log, and a direct link from a user's admin detail page to their filtered audit
history.
