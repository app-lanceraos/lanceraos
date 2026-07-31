// src/pages/PrivacyPolicy.jsx
import useTitle from '@/hooks/useTitle'
import { LegalPageShell, DraftNotice, Section, P, UL, Needs, SimpleTable } from '@/components/LegalContent'

export default function PrivacyPolicy() {
  useTitle('LanceraOS | Privacy Policy')

  return (
    <LegalPageShell title="Privacy Policy" lastUpdated={<Needs>publish date</Needs>}>
      <DraftNotice>
        This document is a draft, accurate to what LanceraOS actually collects and does today. It
        has not been reviewed by a lawyer and should not be treated as legally binding until it
        has been. Sections marked <Needs>...</Needs> require a real decision before this can be
        published.
      </DraftNotice>

      <Section title="1. Who we are">
        <P>
          LanceraOS ("we," "us," "our") is a platform built for freelancers to manage their
          business — invoicing, clients, and financial tracking. This policy explains what
          personal information we collect, why, and what rights you have over it.
        </P>
        <P>
          <Needs>your legal business name/entity, if one exists yet, and a real contact email —
          "privacy@lanceraos.com" is used as a placeholder throughout this document</Needs>
        </P>
      </Section>

      <Section title="2. Information we collect">
        <P><strong>Account information you provide directly:</strong></P>
        <UL items={[
          'Email address, username, first name, last name (last name is optional)',
          'Date of birth (used only to confirm you\'re at least 16 years old — LanceraOS is not available to anyone younger)',
          'Password (we never see or store your actual password — it\'s hashed using Argon2, a modern, one-way hashing algorithm; even we cannot reverse it to see the original)',
          'Profile photo (if you upload one)',
        ]} />

        <P>
          <strong>If you sign up or sign in with Google or Facebook:</strong> we receive your email
          address and name from that provider. We do not receive or store your Google/Facebook
          password.
        </P>

        <P><strong>Business and tax information you provide (optional, in Settings):</strong></P>
        <UL items={[
          'Business name, address, default currency, payment terms',
          'CNIC, NTN, and PSEB registration number, if you choose to add them — these are encrypted before being stored, and are never visible in plain text in our database. They exist to support tax and invoicing features.',
          'Bank account details, JazzCash/Easypaisa numbers, Payoneer email, or Wise account information, if you choose to add any of these as a payment method for your invoices.',
        ]} />

        <P><strong>Information collected automatically:</strong></P>
        <UL items={[
          'IP address and a general description of your device/browser (e.g. "Chrome on Windows") — used to detect logins from a device we don\'t recognize, and shown back to you on your own Settings > Sessions page so you can review your own account activity.',
          'A record of active login sessions (up to 3 devices at a time), which you can view and revoke yourself at any time.',
          'A security/audit log of account-related events (password changes, login attempts, 2FA changes, etc.) — used to keep your account secure and to help you and, if needed, our support team understand what happened on your account.',
        ]} />

        <P>
          <strong>What we do not collect:</strong> LanceraOS does not use advertising or analytics
          tracking of any kind. We don't sell your data to anyone, and we don't share it with
          advertisers.
        </P>
      </Section>

      <Section title="3. Cookies">
        <P>
          LanceraOS uses a small number of cookies, all of which are <strong>strictly
          necessary</strong> for the site to function — none are used for advertising, tracking, or
          analytics, and none require your consent under most cookie-consent laws for exactly that
          reason. We're still explaining them here for full transparency:
        </P>
        <SimpleTable
          headers={['Cookie', 'Purpose']}
          rows={[
            ['Access token', 'Keeps you signed in for a short period (15 minutes), refreshed automatically'],
            ['Refresh token', 'Lets you stay signed in across visits without re-entering your password, for up to 30 days (90 days if you check "Remember me")'],
            ['CSRF token', 'A security measure that prevents other websites from performing actions on your account without your knowledge'],
            ['Trusted device', 'Recognizes a browser you\'ve used before, so we don\'t need to ask for a two-factor code or send a "new device" alert every time'],
            ['Session hint', 'A small, non-sensitive flag that lets the app know whether to even check if you\'re logged in, so a first-time visitor\'s browser doesn\'t make an unnecessary request'],
          ]}
        />
        <P>
          All of these except the "session hint" cookie are stored in a way that JavaScript running
          on any webpage — including LanceraOS's own — cannot read their contents, specifically to
          protect them from being stolen if a security vulnerability were ever found on the site.
        </P>
      </Section>

      <Section title="4. How we use your information">
        <UL items={[
          'To create and maintain your account',
          'To verify your identity and keep your account secure (login detection, two-factor authentication, session management)',
          'To provide the features you use (profile, business settings, tax information for invoicing)',
          'To send you account-related emails — verification, password resets, security alerts when we detect a new device, and confirmations when you change something sensitive (your password, email, or two-factor settings). We do not send marketing emails unless you separately opt in to a feature that requests it.',
          'To investigate and respond to account security issues, if they arise',
        ]} />
      </Section>

      <Section title="5. Who we share information with">
        <P>
          We use a small number of third-party services to operate LanceraOS. Each only receives
          the specific data it needs to do its job:
        </P>
        <SimpleTable
          headers={['Service', 'What it receives', 'Purpose']}
          rows={[
            ['Cloudinary', 'Your profile photo/logo, if uploaded', 'Image storage and delivery'],
            ['Resend', 'Your email address, and the content of transactional emails we send you', 'Email delivery'],
            ['Google / Facebook', 'Nothing from us — if you use "Sign in with Google/Facebook," you\'re sending your email/name to us, not the other way around', 'Optional sign-in method'],
            [<Needs key="hosting">hosting provider, e.g. Railway</Needs>, 'Everything — this is where our database and servers actually run', 'Infrastructure'],
          ]}
        />
        <P>
          We do not sell, rent, or trade your personal information to any third party for their own
          marketing purposes.
        </P>
      </Section>

      <Section title="6. How long we keep your information">
        <UL items={[
          'While your account is active: for as long as you have an account with us.',
          <>
            If you delete your account: we don't delete it immediately. You get a <strong>30-day
            recovery window</strong> — during that time, you (or anyone who signs back into the
            account) can restore it in full. After 30 days, your account is anonymized: your name,
            email, and other identifying information are permanently replaced with a randomized
            placeholder, and your password becomes unusable. We anonymize rather than fully delete
            because some records (like invoices, once that feature exists) may need to be retained
            for financial or legal record-keeping — but they will no longer be linked to your real
            identity.
          </>,
          <>Security/audit logs: retained <Needs>a specific retention period — this doesn't currently have an automatic expiry/cleanup</Needs>.</>,
        ]} />
      </Section>

      <Section title="7. Your rights">
        <P>You can, at any time, from your own account:</P>
        <UL items={[
          'View and edit your profile, business, and tax information',
          'Enable or disable two-factor authentication',
          'View and revoke your own active login sessions',
          'Change your email address or password',
          'Request deletion of your account (with the 30-day recovery window described above)',
        ]} />
        <P>
          <Needs>a decision — LanceraOS does not currently have a "download my data" / data export
          feature. Many privacy laws (including GDPR, if you ever have EU users) give people a
          right to receive a copy of their own data. Worth building before this is a real concern,
          not after.</Needs>
        </P>
      </Section>

      <Section title="8. Children's privacy">
        <P>
          LanceraOS is not intended for anyone under 16, and we verify date of birth at signup
          specifically to enforce this.
        </P>
      </Section>

      <Section title="9. Security">
        <P>
          We take reasonable technical measures to protect your information, including: encryption
          of sensitive tax-identity fields (CNIC, NTN, PSEB) at rest, industry-standard password
          hashing (Argon2), optional two-factor authentication, rate-limiting and account lockout
          to slow down unauthorized access attempts, and regular internal security review. No
          system can be guaranteed 100% secure, but we take this seriously and continue to review
          it.
        </P>
      </Section>

      <Section title="10. International data transfers">
        <P>
          <Needs>a real answer — where is your database physically hosted? If you ever have users
          outside Pakistan (or your hosting provider's servers are outside Pakistan), this section
          needs to say so and explain the safeguards in place.</Needs>
        </P>
      </Section>

      <Section title="11. Changes to this policy">
        <P>
          We may update this policy from time to time. If we make a significant change, we'll let
          you know <Needs>how — email? A banner in the app?</Needs>
        </P>
      </Section>

      <Section title="12. Contact us">
        <P>
          Questions about this policy or your data can be sent to <Needs>real contact email</Needs>.
        </P>
      </Section>
    </LegalPageShell>
  )
}