// src/pages/TermsOfService.jsx
import { Link } from 'react-router-dom'
import useTitle from '@/hooks/useTitle'
import { LegalPageShell, DraftNotice, Section, P, UL, Needs } from '@/components/LegalContent'

export default function TermsOfService() {
  useTitle('LanceraOS | Terms of Service')

  return (
    <LegalPageShell title="Terms of Service" lastUpdated={<Needs>publish date</Needs>}>
      <DraftNotice>
        This document is a draft, accurate to what LanceraOS actually does today. It has not been
        reviewed by a lawyer and should not be treated as legally binding until it has been.
        Sections marked <Needs>...</Needs> require a real decision before this can be published.
      </DraftNotice>

      <Section title="1. Acceptance of these terms">
        <P>
          By creating an account with LanceraOS, you agree to these Terms of Service and our{' '}
          <Link to="/privacy" style={{ color: 'var(--accent)', fontWeight: 600 }}>Privacy Policy</Link>.
          If you don't agree, please don't use LanceraOS.
        </P>
      </Section>

      <Section title="2. Eligibility">
        <P>
          You must be at least 16 years old to use LanceraOS. We verify your date of birth at
          signup to enforce this — for accounts created through Google or Facebook (which don't
          give us your birthday), we ask for it separately during account setup, and any account
          found to belong to someone under 16 will be closed.
        </P>
      </Section>

      <Section title="3. Your account">
        <UL items={[
          'You\'re responsible for keeping your password secure and for all activity that happens under your account.',
          'You agree to provide accurate information when creating your account and keep it up to date.',
          <>If you believe your account has been compromised, you can revoke your own active sessions from Settings, or contact us at <Needs key="support">support contact</Needs>.</>,
          'We offer optional two-factor authentication — we recommend enabling it, especially given LanceraOS is used to manage sensitive business and tax information.',
        ]} />
      </Section>

      <Section title="4. Acceptable use">
        <P>You agree not to:</P>
        <UL items={[
          'Use LanceraOS for any illegal purpose, or to facilitate fraud',
          'Attempt to gain unauthorized access to another user\'s account or to LanceraOS\'s systems',
          'Interfere with or disrupt the service (including attempting to bypass rate limits, security measures, or automated protections)',
          'Reverse-engineer, scrape, or attempt to extract the underlying source code of the platform',
          'Impersonate another person or provide false information, including false tax-identity information (CNIC/NTN/PSEB)',
          'Share your account credentials with anyone else',
        ]} />
        <P>We reserve the right to suspend or terminate accounts that violate these terms.</P>
      </Section>

      <Section title="5. Fees">
        <P>
          LanceraOS is currently free to use.{' '}
          <Needs>a real decision — this project has already decided to add a paid tier
          eventually; once that exists, this section needs real terms covering billing, renewal,
          and cancellation. Until then, this sentence should stay accurate: nothing is currently
          charged.</Needs>
        </P>
      </Section>

      <Section title="6. Your content">
        <P>
          You retain ownership of the business and financial information you enter into LanceraOS
          (your client data, invoices, business details, etc., as those features are built). We
          don't claim ownership of it — we store and process it on your behalf so the product can
          function.
        </P>
      </Section>

      <Section title="7. Intellectual property">
        <P>
          LanceraOS's own software, design, and branding are owned by us and may not be copied,
          modified, or redistributed without permission.
        </P>
      </Section>

      <Section title="8. Account termination">
        <UL items={[
          'By you: you may delete your account at any time from Settings. You\'ll have a 30-day window to change your mind and restore it before it\'s permanently anonymized — see the Privacy Policy for details.',
          'By us: we may suspend or terminate an account that violates these terms, engages in fraud or illegal activity, or poses a security risk to LanceraOS or other users. Where practical, we\'ll attempt to notify you first.',
        ]} />
      </Section>

      <Section title="9. Disclaimers">
        <P>
          LanceraOS is provided "as is." While we take reasonable steps to keep the service secure
          and available, we don't guarantee it will be error-free or uninterrupted.{' '}
          <Needs>real legal language here around limitation of liability — this is exactly the
          kind of clause that genuinely benefits from a lawyer's review, especially once real
          financial/invoicing features exist and users are relying on the platform for actual
          business operations.</Needs>
        </P>
      </Section>

      <Section title="10. Changes to these terms">
        <P>
          We may update these terms from time to time.{' '}
          <Needs>how you'll notify users of material changes.</Needs>
        </P>
      </Section>

      <Section title="11. Governing law">
        <P>
          <Needs>a real decision — which country/jurisdiction's law governs these terms? Given
          you're based in Pakistan, that's the likely starting point, but this is worth confirming
          with a lawyer, especially if you ever have users outside Pakistan.</Needs>
        </P>
      </Section>

      <Section title="12. Contact us">
        <P>
          Questions about these terms can be sent to <Needs>real contact email</Needs>.
        </P>
      </Section>
    </LegalPageShell>
  )
}