// src/pages/TermsOfService.jsx
//
// The final Terms of Service (version 2026-11-15), rendered verbatim from the text Ali Amir's legal
// draft supplied. Do not reword it here: a change to what LanceraOS does that touches a right or a
// duty must change this file AND the Privacy Policy in the same change, and bump
// CURRENT_TERMS_VERSION in apps/users/constants.py (STANDARDS.md, "Legal pages stay true").
// frontend/src/pages/__tests__/legalPagesDrift.test.js fails when this file and the code disagree
// (for example the minimum age, which must equal MIN_AGE_YEARS in apps/users/serializers.py).
import { Link } from 'react-router-dom'
import useTitle from '@/hooks/useTitle'
import { LegalPageShell, LegalContents, Section, P, UL, MailLink } from '@/components/LegalContent'

// The one list of section titles: the contents block and every <S n={...}> read it, so they cannot disagree.
const SECTIONS = [
  { id: 's1', title: '1. Agreement' },
  { id: 's2', title: '2. Eligibility and your account' },
  { id: 's3', title: '3. What LanceraOS is, and what it is not' },
  { id: 's4', title: '4. Your content and your clients\' information' },
  { id: 's5', title: '5. Acceptable use' },
  { id: 's6', title: '6. Invoices, payments and the client portal' },
  { id: 's7', title: '7. Proposals and contracts' },
  { id: 's8', title: '8. Tax features, income statements and reports' },
  { id: 's9', title: '9. AI features' },
  { id: 's10', title: '10. Sending email from your own email server' },
  { id: 's11', title: '11. Plans and fees' },
  { id: 's12', title: '12. Our intellectual property' },
  { id: 's13', title: '13. Third-party services' },
  { id: 's14', title: '14. Suspension, termination and account deletion' },
  { id: 's15', title: '15. Changes to the Service' },
  { id: 's16', title: '16. Disclaimers' },
  { id: 's17', title: '17. Limitation of liability' },
  { id: 's18', title: '18. Your responsibility to us' },
  { id: 's19', title: '19. Changes to these Terms' },
  { id: 's20', title: '20. Governing law and disputes' },
  { id: 's21', title: '21. General' },
  { id: 's22', title: '22. Contact' },
]

function S({ n, children }) {
  const { id, title } = SECTIONS[n - 1]
  return <Section id={id} title={title}>{children}</Section>
}

const PRIVACY = 'privacy@lanceraos.com'
const SUPPORT = 'support@lanceraos.com'

export default function TermsOfService() {
  useTitle('LanceraOS | Terms of Service')

  return (
    <LegalPageShell
      title="Terms of Service"
      lastUpdated="15 November 2026"
      version="2026-11-15"
      related={{ to: '/privacy', label: 'Privacy Policy' }}
    >
      <LegalContents items={SECTIONS} />

      <S n={1}>
        <P>
          These Terms of Service (&quot;Terms&quot;) are an agreement between you and LanceraOS, operated by Ali Amir, an
          individual based in Pakistan (&quot;LanceraOS&quot;, &quot;we&quot;, &quot;us&quot;, &quot;our&quot;). They apply to
          your use of the LanceraOS website and application at lanceraos.com and everything we provide through them (the
          &quot;Service&quot;).
        </P>
        <P>
          By creating an account, or by using the Service, you agree to these Terms and to our{' '}
          <Link to="/privacy" style={{ color: 'var(--accent)', fontWeight: 600 }}>Privacy Policy</Link>. If you do not agree,
          do not use the Service.
        </P>
        <P>
          If you use LanceraOS for a business or on behalf of one, you confirm that you are allowed to bind it, and
          &quot;you&quot; includes that business.
        </P>
      </S>

      <S n={2}>
        <UL items={[
          'You must be at least 18 years old and able to enter into a binding agreement under the law that applies to you. We check your date of birth when you create an account, and we will close accounts that belong to anyone under 18.',
          'You must give accurate information when you register and keep it up to date.',
          <>You are responsible for your password and for everything that happens under your account. Do not share your sign-in details. Tell us at once at <MailLink address={SUPPORT} /> if you think your account has been compromised. You can end your own sessions in Settings.</>,
          'One person, one account. You may not create accounts for the purpose of avoiding a limit, a suspension or a plan restriction.',
          'We strongly recommend turning on two-factor authentication. LanceraOS can hold tax identity numbers and financial details.',
        ]} />
      </S>

      <S n={3}>
        <P>
          LanceraOS is software that helps freelancers keep their business records: invoices, clients, payments, expenses,
          proposals, contracts, reports and tax estimates.
        </P>
        <P>LanceraOS is <strong>not</strong>:</P>
        <UL items={[
          'a bank, a payment processor or a wallet. We do not receive, hold or move your money or your clients\' money. A payment recorded in LanceraOS is a record that you or your client entered. We do not verify that money was received;',
          'an accountant, tax adviser, auditor or lawyer, and nothing in the Service is accounting, tax or legal advice;',
          'a party to any agreement between you and your clients.',
        ]} />
        <P>
          You are responsible for the accuracy of what you enter, for the documents you send, and for your own decisions.
        </P>
      </S>

      <S n={4}>
        <P>
          <strong>Ownership.</strong> You keep ownership of the information and documents you put into LanceraOS (&quot;Your
          Content&quot;), including information about your clients. We do not claim ownership of it.
        </P>
        <P>
          <strong>Our permission to use it.</strong> You give us a limited, non-exclusive permission to store, copy, process,
          display and transmit Your Content, only as needed to provide, secure and support the Service for you, and as
          described in the Privacy Policy. This includes generating PDFs, sending emails you ask us to send, showing documents
          to the clients you send them to, and making backups.
        </P>
        <P><strong>Your responsibilities.</strong> You promise that:</P>
        <UL items={[
          'you have the right to put Your Content into LanceraOS, including the personal information of your clients and of anyone else it mentions;',
          'you have a lawful reason to hold and use that information, and you will tell your clients how you use it;',
          'Your Content, and the way you use the Service with it, does not break any law or anyone\'s rights;',
          'you will only send emails and links to people you have a genuine business reason to contact.',
        ]} />
        <P>
          <strong>Your records.</strong> LanceraOS is not your records archive. Download and keep your own copies of invoices,
          statements, contracts and any other record you are legally required to keep. In Pakistan, taxpayers generally must
          keep their accounts and records for six years after the end of the relevant tax year.
        </P>
        <P>
          <strong>What happens to records when you leave.</strong> Section 14 and the Privacy Policy explain what happens to
          Your Content when your account is closed.
        </P>
      </S>

      <S n={5}>
        <P>You agree not to:</P>
        <UL items={[
          'use the Service for anything unlawful, or to help anyone commit fraud, tax evasion, money laundering or any other offence;',
          'create invoices, receipts, contracts or other documents that you know to be false or misleading, or that misstate who you are, what was agreed or what was paid;',
          'impersonate any person or business, or give false identity or tax details (including CNIC, NTN and PSEB numbers);',
          'send spam or unsolicited bulk messages, or harass, threaten or deceive anyone through the Service;',
          'upload or send anything unlawful, defamatory, hateful, infringing, or containing malware;',
          'access or try to access another person\'s account, data or the Service\'s systems without permission;',
          'probe, scan or test the security of the Service, or overload it, or get around rate limits, plan limits or other protections;',
          'scrape the Service, or copy, reverse engineer, decompile or try to extract its source code, except where the law gives you that right;',
          'use the AI features to produce content that is unlawful or deceptive, or put into them information you are not entitled to share;',
          'resell or make the Service available to others as your own service without our written agreement.',
        ]} />
        <P>
          We may investigate suspected breaches and may remove content or suspend access as described in Section 14.
        </P>
      </S>

      <S n={6}>
        <UL items={[
          'When you send an invoice, proposal, contract or portal link, the person you send it to receives it. You are responsible for sending it to the right person and for what it says.',
          'Reminders, notices and other emails that LanceraOS sends on your behalf are sent because you set them up or asked for them. You are responsible for them, including the choice to send a formal notice.',
          'Payment claims and comments submitted by your clients through the portal are their statements. You are responsible for deciding whether to accept them. A payment shown as received, confirmed or paid in LanceraOS is only as accurate as the information entered.',
          'Exchange rates are shown for convenience from a public daily source. They are not live, are not a quote, and may differ from the rate your bank or payment provider uses.',
          'Links to invoices, proposals and contracts are private links. Anyone who holds the link can open it. Treat links like passwords and share them only with the intended person.',
        ]} />
      </S>

      <S n={7}>
        <P>
          LanceraOS lets you prepare proposals and contracts and lets the people involved respond by typing their name and
          confirming. Please understand the limits.
        </P>
        <UL items={[
          <><strong>Templates are starting points, not legal advice.</strong> The contract templates and clause text are general and may not suit your situation, your client or the law that applies to you. Read every clause. Have a lawyer review any contract that matters, or is large, or involves a person or business in another country.</>,
          <><strong>We do not verify identity.</strong> A signature in LanceraOS is a typed name, a confirmation, and a record of the time, the IP address, the browser description and a fingerprint of the text. Anyone who holds the link can sign. We do not check who is typing.</>,
          <><strong>We make no promise about validity or enforceability.</strong> Whether an electronic signature or a contract made this way is valid, binding or enforceable depends on the document, the parties and the law that applies. Some kinds of document generally cannot be made by electronic signature. Payment of stamp duty or other formalities, where required, are your responsibility.</>,
          <><strong>Proposal and contract records.</strong> A recorded acceptance, decline or signature is a record of what was entered. It is not a statement from us about what anyone intended or agreed.</>,
          <><strong>You are the party to your contracts and proposals.</strong> We are not.</>,
        ]} />
      </S>

      <S n={8}>
        <P>
          The tax overview, calculator, income statements, profit and loss, health score and other reports are estimates and
          summaries calculated from the information you entered and from tax rules as we understand them at the time. They
          may be incomplete, out of date or not suited to your situation.
        </P>
        <UL items={[
          'They are not tax advice, and not a return, assessment or certificate from any authority.',
          'A statement of income or similar document you generate is self-declared by you. It does not certify, verify or confirm anything.',
          'You remain responsible for your own tax returns and payments. Check figures with a qualified tax professional before you file or rely on them.',
        ]} />
      </S>

      <S n={9}>
        <P>
          LanceraOS offers features that use artificial intelligence to draft proposals, write insights about your figures,
          and answer help questions. The Privacy Policy explains what each sends to our AI provider.
        </P>
        <UL items={[
          'AI output can be inaccurate, incomplete, inappropriate or out of date, and it can sound more confident than it should. It is a draft or a suggestion only.',
          'You must review AI output before you use or send it. You are responsible for what you send to your clients, including text an AI helped write.',
          'Do not put into AI inputs any information you are not allowed to share, or that you would not want an outside service to process.',
          'AI features may be limited, changed, switched off or unavailable at any time. They do not give legal, tax, financial or professional advice.',
        ]} />
      </S>

      <S n={10}>
        <P>
          If you connect your own email server (custom SMTP), you give us permission to use it to send emails you ask us to
          send. You are responsible for that account, for your provider&apos;s terms, for keeping its credentials correct and
          for the content and lawfulness of the messages. We store your email password encrypted. You can disconnect your
          server in Settings at any time. If you have not set one up, client emails are sent from our own address with a
          reply address pointing to you.
        </P>
      </S>

      <S n={11}>
        <P>
          LanceraOS is currently free to use. We intend to introduce paid plans. Before we ever charge you, we will tell you
          the price, what the plan includes, how billing renews and how to cancel and what refunds apply, and we will not
          charge you unless you clearly agree to it. If we later limit or move a feature you use on the free plan, we will
          give you at least 30 days&apos; notice by email, except where we must act sooner for security or legal reasons. We
          may change prices for a paid plan with at least 30 days&apos; notice, and the change will apply from your next
          billing period.
        </P>
      </S>

      <S n={12}>
        <P>
          LanceraOS, including its software, design, text, templates, clause library, logos and branding, belongs to us or
          our licensors and is protected by law. We give you a personal, non-exclusive, non-transferable, revocable right to
          use the Service for your business under these Terms. Nothing here transfers any ownership to you. You may use the
          invoices, proposals and contracts you create with the templates for your own business.
        </P>
        <P>If you send us feedback or ideas, we may use them without owing you anything.</P>
        <P>
          If you believe content on LanceraOS infringes your rights, email <MailLink address={SUPPORT} /> with details, and
          we will review it.
        </P>
      </S>

      <S n={13}>
        <P>
          LanceraOS works with services run by others, including hosting, email, file storage, Google sign-in and AI
          providers (see the Privacy Policy). Those services have their own terms. We are not responsible for services we do
          not control, including your own email provider and your bank or payment provider. Links on our pages to other
          sites are for convenience only.
        </P>
      </S>

      <S n={14}>
        <P>
          <strong>By you.</strong> You can delete your account at any time in Settings. For 30 days after you request
          deletion you can sign back in and restore it. After that your account is anonymized as described in the Privacy
          Policy. Records about your clients and your work are not erased automatically at that point. They remain stored,
          you can no longer manage them, and links you shared before may continue to work until the records are deleted. You
          can ask us to delete them at any time by emailing <MailLink address={PRIVACY} />, and you can delete records
          yourself before closing your account wherever the app allows it. Download anything you need first.
        </P>
        <P>
          <strong>By us.</strong> We may suspend or end your access, remove content, or limit features if you break these
          Terms, if we reasonably believe your use is unlawful, fraudulent or harmful to others or to the Service, if you do
          not pay a fee that is due, if required by law, or if we stop providing the Service. Where it is practical and
          lawful, we will tell you why and give you a chance to fix the problem first.
        </P>
        <P>
          <strong>What survives.</strong> Sections that by their nature should continue after the Terms end do so, including
          Sections 4, 7, 8, 16, 17, 18 and 20.
        </P>
      </S>

      <S n={15}>
        <P>
          We improve and change the Service constantly. We may add, change or remove features. If a change would
          significantly reduce what you can do, we will give notice as set out in Section 11 where it relates to plans and
          fees, and otherwise as much notice as is reasonable.
        </P>
        <P>
          We aim to keep LanceraOS available and to protect your information, but we do not promise that it will always be
          available, error-free or free of interruptions. We may carry out maintenance, and outages can happen, including
          because of our providers.
        </P>
      </S>

      <S n={16}>
        <P>
          To the fullest extent the law allows, the Service is provided &quot;as is&quot; and &quot;as available&quot;. We do
          not give any warranty, express or implied, including any warranty of merchantability, fitness for a particular
          purpose, accuracy, non-infringement or uninterrupted or error-free operation. We do not warrant that documents,
          signatures, tax estimates, calculations, AI output or reports produced with the Service are accurate, complete,
          valid, enforceable or suitable for any purpose.
        </P>
        <P>Nothing in these Terms excludes a warranty or right that the law does not allow to be excluded.</P>
      </S>

      <S n={17}>
        <P>To the fullest extent the law allows:</P>
        <UL items={[
          'we are not liable for any indirect, incidental, special or consequential loss, or for loss of profits, revenue, business, goodwill, savings, data or opportunity, even if we were told it could happen;',
          'we are not liable for any loss caused by information you or others entered, by AI output, by tax or legal decisions you made, by the acts or omissions of your clients or other third parties, by services we do not control, or by events beyond our reasonable control, such as power or network failures, attacks, or the failure of a provider;',
          'our total liability to you for all claims connected with the Service in any 12-month period is limited to the greater of (a) the total fees you paid us in the 12 months before the event that led to the claim and (b) PKR 10,000.',
        ]} />
        <P>
          Nothing in these Terms limits liability for fraud, for death or personal injury caused by negligence, or for
          anything else that the law does not allow to be limited.
        </P>
      </S>

      <S n={18}>
        <P>
          You will compensate us for losses, claims, costs and reasonable legal fees that arise from claims by third parties
          (including your clients) connected with Your Content, your breach of these Terms, or your breach of the law or
          someone&apos;s rights while using the Service. We will tell you promptly about any such claim, and you will give us
          reasonable help. We may take over the defense of any claim at your cost.
        </P>
      </S>

      <S n={19}>
        <P>
          We may update these Terms. For a material change we will email the address on your account and show a notice in the
          app at least 30 days before it takes effect, unless the change is needed sooner to meet a legal requirement or to
          protect the Service. If you keep using the Service after the change takes effect, you accept the new Terms. If you
          do not agree, delete your account before the change takes effect. The date and version at the top show when these
          Terms last changed.
        </P>
      </S>

      <S n={20}>
        <P>
          These Terms and any dispute about them or the Service are governed by the laws of Pakistan. If a dispute arises,
          please first write to <MailLink address={SUPPORT} /> so that we can try to resolve it informally; we will respond
          within 30 days. If it is not resolved, the courts of Pakistan that have jurisdiction will decide it. Nothing in
          this section takes away a right you have under mandatory consumer or data protection law where you live.
        </P>
      </S>

      <S n={21}>
        <UL items={[
          <><strong>Entire agreement.</strong> These Terms and the Privacy Policy are the whole agreement between you and us about the Service.</>,
          <><strong>Severability.</strong> If a part of these Terms is found unenforceable, the rest continues.</>,
          <><strong>No waiver.</strong> If we do not enforce a right straight away, we have not given it up.</>,
          <><strong>Assignment.</strong> You may not transfer your rights or duties under these Terms without our written agreement. We may transfer ours as part of a sale or reorganization of LanceraOS.</>,
          <><strong>Notices.</strong> We may give you notice by email to the address on your account, or by a notice in the app. You may give us notice at <MailLink address={SUPPORT} />.</>,
          <><strong>Electronic communications.</strong> You agree that we may communicate with you electronically, and that these Terms are accepted electronically.</>,
          <><strong>Language.</strong> These Terms are in English. If they are translated, the English version prevails.</>,
          <><strong>No third-party rights.</strong> These Terms do not give anyone other than you and us any right to enforce them.</>,
        ]} />
      </S>

      <S n={22}>
        <P>Support and questions about these Terms: <MailLink address={SUPPORT} /></P>
        <P>Privacy requests: <MailLink address={PRIVACY} /></P>
        <P>LanceraOS, operated by Ali Amir, Pakistan.</P>
      </S>
    </LegalPageShell>
  )
}
