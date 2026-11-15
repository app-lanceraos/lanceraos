// src/pages/PrivacyPolicy.jsx
//
// The final Privacy Policy (version 2026-11-15), rendered verbatim from the text Ali Amir's legal
// draft supplied. Do not reword it here: a factual change to what LanceraOS does (a cookie, a
// third-party service or script, a stored personal field, an AI data flow, a log, a retention rule,
// the minimum age) must change this file in the SAME change, and a change to a right or a duty must
// bump CURRENT_TERMS_VERSION in apps/users/constants.py (STANDARDS.md, "Legal pages stay true").
// frontend/src/pages/__tests__/legalPagesDrift.test.js fails when this file and the code disagree.
import useTitle from '@/hooks/useTitle'
import { LegalPageShell, LegalContents, Section, SubHeading, P, UL, MailLink, SimpleTable } from '@/components/LegalContent'

// The one list of section titles: the contents block and every <S n={...}> read it, so they cannot disagree.
const SECTIONS = [
  { id: 's1', title: '1. The short version' },
  { id: 's2', title: '2. Who we are and how to reach us' },
  { id: 's3', title: '3. Our role: your information and your clients\' information' },
  { id: 's4', title: '4. Information we collect' },
  { id: 's5', title: '5. How we use information' },
  { id: 's6', title: '6. AI features' },
  { id: 's7', title: '7. Who we share information with' },
  { id: 's8', title: '8. Where information is processed' },
  { id: 's9', title: '9. Cookies and similar technologies' },
  { id: 's10', title: '10. How long we keep information' },
  { id: 's11', title: '11. How we protect information' },
  { id: 's12', title: '12. Your choices and rights' },
  { id: 's13', title: '13. If you are a client of a LanceraOS user' },
  { id: 's14', title: '14. Children' },
  { id: 's15', title: '15. Changes to this policy' },
  { id: 's16', title: '16. Contact' },
]

function S({ n, children }) {
  const { id, title } = SECTIONS[n - 1]
  return <Section id={id} title={title}>{children}</Section>
}

const PRIVACY = 'privacy@lanceraos.com'
const SUPPORT = 'support@lanceraos.com'

export default function PrivacyPolicy() {
  useTitle('LanceraOS | Privacy Policy')

  return (
    <LegalPageShell
      title="Privacy Policy"
      lastUpdated="15 November 2026"
      version="2026-11-15"
      related={{ to: '/terms', label: 'Terms of Service' }}
    >
      <LegalContents items={SECTIONS} />

      <S n={1}>
        <UL items={[
          'LanceraOS is a tool for freelancers to manage invoices, clients, payments, proposals, contracts and tax estimates. To do that we have to store information about you and about the people you do business with.',
          'We do not sell your information. We do not show advertising. We do not use analytics or advertising trackers.',
          'We use a small number of outside service providers to run LanceraOS (hosting, email, file storage, sign-in and AI). Section 7 lists each one and what it receives.',
          'Some features use an AI service. They only run when you use them, or when we switch on an optional feature that says so. Section 6 explains exactly what is sent.',
          'Your tax identity numbers (CNIC, NTN, PSEB) and your custom email password are encrypted before they are stored.',
          'You can delete your account. You then have a 30-day window to change your mind. After that your personal details are removed. Section 10 explains what is kept and why, including what is not removed automatically.',
          <>You can ask us for a copy of your data, a correction, or a deletion at any time by writing to <MailLink address={PRIVACY} />.</>,
        ]} />
      </S>

      <S n={2}>
        <P>
          LanceraOS (&quot;LanceraOS&quot;, &quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is a web application for
          freelancers, operated by Ali Amir, an individual based in Pakistan.
        </P>
        <UL items={[
          <>Privacy questions and requests: <MailLink address={PRIVACY} /></>,
          <>Support: <MailLink address={SUPPORT} /></>,
        ]} />
        <P>
          This policy applies to the LanceraOS website and application at lanceraos.com, to the pages we show to your
          clients (such as invoice, proposal and contract links and the client portal), and to the emails we send.
        </P>
      </S>

      <S n={3}>
        <P>LanceraOS handles two kinds of information, and our role is different for each.</P>
        <P>
          <strong>Your own account information.</strong> This is the information about you that you give us to create and
          use an account (your name, email, security settings and so on). For this information we decide how and why it is
          used, as described in this policy.
        </P>
        <P>
          <strong>Information about your clients and your work.</strong> When you add a client, create an invoice, record a
          payment, write a proposal or send a contract, you are putting other people&apos;s information into LanceraOS. For
          that information you decide what is stored and why, and we store and process it on your behalf to provide the
          service. You are responsible for having a lawful reason to hold it and use it, and for telling your own clients how
          you use their information. We will only use it to provide LanceraOS to you, to keep it secure, and as this policy
          describes.
        </P>
        <P>
          If you are a client of a LanceraOS user (for example you received an invoice, proposal or contract link), see
          Section 13.
        </P>
      </S>

      <S n={4}>
        <SubHeading>4.1 Information you give us when you create and use an account</SubHeading>
        <UL items={[
          'Email address, username, first name and last name (last name is optional).',
          'Date of birth. We use it only to confirm that you meet our minimum age of 18.',
          'Password. We never store your password itself. We store a one-way hash made with Argon2, which we cannot reverse.',
          'Profile photo or business logo, and a signature image, if you upload them.',
          'Your answers to setup questions, such as your profession, how you earn income (for example full time, part time or as a student) and the platforms you use (for example Upwork or Fiverr). We use these to set up the product for you.',
          'If you sign in with Google: your Google account identifier, email address and name. We do not receive or store your Google password.',
        ]} />

        <SubHeading>4.2 Business, tax and payment details you choose to add</SubHeading>
        <UL items={[
          'Business name, address, city, phone number, default currency, language and payment terms.',
          'CNIC, NTN and PSEB registration numbers. These are encrypted before they are stored. We also keep a one-way "blind index" of each, which lets us prevent the same number being registered twice without storing it in readable form.',
          'Payment details you want printed on your invoices: bank name and account number, JazzCash or Easypaisa numbers, a Payoneer email, or a Wise profile identifier. These are stored so they can appear on the invoices you choose to send. They are protected by access controls and by encryption in transit; they are not encrypted at the application level in the way CNIC, NTN and PSEB numbers are.',
          'If you connect your own email server (custom SMTP) to send client emails: the server address, username and sender name, and your email password, which is encrypted before it is stored.',
        ]} />

        <SubHeading>4.3 Records you create about your business</SubHeading>
        <UL items={[
          'Clients: name, email address, company, address, phone, country, notes and tags you add, and portal access links we generate for them.',
          'Invoices and their line items, recurring invoice settings, reminders, notes and terms, and the PDF copy of each invoice.',
          'Payments and expenses you record, and files you import (for example a CSV export from Wise), including counterparty names and transaction identifiers that appear in them.',
          'Proposals, including the job description and notes you paste into them and the text you or the AI write.',
          'Contracts, including the parties\' names, the contract text and the signatures described in Section 4.4.',
          'Comments and messages exchanged on invoices, and files attached to them.',
          'Reports and tax estimates generated from the records above.',
        ]} />

        <SubHeading>4.4 Information from your clients and other people who open links you send</SubHeading>
        <P>When your client opens an invoice, proposal, contract or portal link:</P>
        <UL items={[
          'We record that the link was opened and when.',
          'If they reply or comment, we store their message and any file they attach. Replies sent by email to a comment notification are received through our email routing service and added to the conversation.',
          'If they report a payment, we store what they enter (amount, currency, date, how it was paid and a note).',
          'If they accept or decline a proposal, we store their decision, any message, the time, their IP address and their browser description.',
          'If they sign or decline a contract, we store the name they type, the time, their IP address, their browser description, and a fingerprint (a SHA-256 hash) of the exact contract text. The same record is kept for the freelancer\'s own signature.',
          'To give a client access to the portal we email them a sign-in link and set a cookie on their browser (Section 9).',
        ]} />

        <SubHeading>4.5 Information collected automatically</SubHeading>
        <UL items={[
          'IP address and a description of your browser and device. We use these to detect sign-ins from a device we do not recognize and to protect accounts. Your active sessions, with this information, are shown to you in Settings so you can review and end them.',
          'Sign-in sessions (at most three devices at a time) and the devices you have marked as trusted.',
          'A security log of account events such as sign-ins, failed sign-ins, password and email changes, two-factor changes, and actions on invoices, proposals and contracts. Entries can include IP address and browser description.',
          'A technical request log of calls to our servers (the time, the address called, the response status, your IP address and browser description). Sensitive values in requests are redacted before they are stored.',
          'A log of AI requests that records which feature ran, which model, whether it worked and how large the request was. It does not store the text sent or received.',
        ]} />

        <SubHeading>4.6 What we do not collect</SubHeading>
        <P>
          We do not use advertising trackers or analytics tools. We do not collect payment card numbers. We do not buy
          information about you from other sources.
        </P>
      </S>

      <S n={5}>
        <P>We use information to:</P>
        <UL items={[
          'create and run your account, and to provide invoicing, payments, expenses, proposals, contracts, reports, tax estimates, the client portal and the other features you use;',
          'send you emails that you need: verification, password resets, security alerts, notices about your invoices, proposals, contracts and client messages, and service notices. We do not send marketing email;',
          'send emails to your clients on your behalf when you tell us to, using your own email server if you set one up, and otherwise our email provider;',
          'keep LanceraOS and your account secure: detect unusual sign-ins, enforce limits, investigate abuse, fraud and errors;',
          'fix problems and improve reliability and quality of the product;',
          'keep records we need in order to resolve disputes and meet legal obligations;',
          'respond to your requests and to messages sent to our support and privacy addresses.',
        ]} />
        <P>
          We use your information only for these purposes. Where the laws that apply to you require a legal basis, we rely
          on: providing the service you asked for (contract), our legitimate interest in security, preventing abuse and
          improving the service, your consent where we ask for it, and compliance with legal obligations.
        </P>
      </S>

      <S n={6}>
        <P>
          Some features use an AI service. We use Groq to run AI models. Each feature is described below, with exactly what
          is sent.
        </P>
        <P>
          <strong>Proposal drafting.</strong> When you choose to generate or regenerate a proposal with AI, we send Groq the
          job description you pasted, your notes about your experience, and your display name, business name and profession.
          Do not paste more than you need. Job descriptions sometimes include other people&apos;s names or contact details;
          remove anything you are not comfortable sharing. The result is a draft that you read and edit; nothing is sent to
          your client until you send it.
        </P>
        <P>
          <strong>Dashboard insights (optional, off unless we switch it on).</strong> If switched on, we send Groq short plain
          statements calculated from your own figures, for example the change in income from last month. These can include
          amounts and currencies. They do not include names, email addresses, invoice numbers, proposal titles or business
          names.
        </P>
        <P>
          <strong>Help answers (optional, off unless we switch it on).</strong> If switched on, a question you type into Help
          is sent to Groq together with the help guides that match it. Before sending, we remove email addresses, web
          addresses and long numbers from your question. The Help page tells you when a written answer feature is on.
          Searching the help guides never sends anything to an AI service.
        </P>
        <P>For all AI features:</P>
        <UL items={[
          'AI output can be wrong. Check it before you rely on it or send it to anyone.',
          'We store only the size, timing and outcome of each AI request, not its text.',
          'Groq\'s published terms say it does not use this data to train its models, and that it keeps request content only as needed to operate and secure its service. See Groq\'s privacy policy and terms for their current commitments.',
          'We do not use your information to train AI models.',
        ]} />
      </S>

      <S n={7}>
        <P>
          We do not sell your information, and we do not rent or trade it. We share it only with the providers below, who
          help us run LanceraOS, and in the situations in the next list. Each receives only what it needs for its job.
        </P>
        <SimpleTable
          headers={['Provider', 'What it handles', 'Why']}
          rows={[
            ['Amazon Web Services (Sydney, Australia)', 'Our application servers and database, which hold everything described in Section 4, and our backups', 'Hosting. We expect to move hosting to Railway, and will update this list if we do'],
            ['Vercel', 'The website you load in your browser, and technical details of each request such as your IP address', 'Hosting the front end'],
            ['Cloudflare', 'Network traffic between you and our servers, DNS, and inbound routing of email replies to comments', 'Security, delivery and email routing'],
            ['Resend', 'Recipient email address and the content of emails we send from our own address (account emails and, when you have no custom email server, client emails)', 'Email delivery'],
            ['Cloudinary', 'Business logos, signature images, invoice PDF copies and files attached to comments', 'File storage and delivery'],
            ['Google', 'Your email and name when you use Sign in with Google. Our pages also load Google Fonts, so your browser contacts Google\'s servers and Google receives your IP address and browser details', 'Sign-in and page fonts'],
            ['Groq', 'The AI inputs described in Section 6', 'AI features'],
          ]}
        />
        <P>
          If you set up a custom email server (SMTP), emails to your clients are sent through your own provider, which is a
          service you chose and are responsible for.
        </P>
        <P>We may also disclose information:</P>
        <UL items={[
          <><strong>When the law requires it</strong>, for example in response to a valid court order or legal process. Where lawful, we will tell you first.</>,
          <><strong>To protect people or the service</strong>, for example to investigate fraud, abuse or a security incident, or to protect the rights and safety of users, the public or us.</>,
          <><strong>If our business changes.</strong> If LanceraOS is sold or merged, your information may transfer to the new owner, who must honor this policy for it. We will tell you before it is governed by a different policy.</>,
          <><strong>With your direction.</strong> For example, when you send an invoice, the client receives the invoice you sent.</>,
        ]} />
        <P>
          Only authorized people can access production systems and the administration panel. Staff may view account details
          and logs when needed to provide support, investigate security issues or keep the service working, and their actions
          in the administration panel are logged.
        </P>
      </S>

      <S n={8}>
        <P>
          LanceraOS is operated from Pakistan. Our servers are currently in Sydney, Australia, and our providers operate
          internationally. This means your information is processed outside Pakistan, in Australia and in other countries
          where our providers operate. These countries may have data protection laws that differ from Pakistan&apos;s. We
          rely on our providers&apos; own data protection and security terms to protect information that leaves Pakistan.
        </P>
        <P>
          Pakistan does not currently have a comprehensive data protection statute in force. We apply the practices in this
          policy to everyone, wherever they live.
        </P>
      </S>

      <S n={9}>
        <P>
          LanceraOS uses only cookies that it needs to work. We do not use advertising or analytics cookies.
        </P>
        <SimpleTable
          headers={['Cookie', 'Purpose', 'How long it lasts']}
          rows={[
            ['lanceraos_access', 'Keeps you signed in. Cannot be read by page scripts', '15 minutes, renewed automatically while you are active'],
            ['lanceraos_refresh', 'Lets you stay signed in without entering your password again. Cannot be read by page scripts', '30 days, or 90 days if you choose "Remember me"'],
            ['lanceraos_has_session', 'A flag with no secret in it, so the app knows whether to check for a session', 'Same as the refresh cookie'],
            ['lanceraos_trusted_device', 'Recognizes a browser you chose to trust so we do not ask for a two-factor code every time. Cannot be read by page scripts', '30 days'],
            ['csrftoken', 'Protects against other websites acting on your account. Page scripts can read it, because the app must send it with requests', 'Up to one year (the security framework\'s default)'],
            ['lanceraos_portal_session', 'Keeps a client signed in to the client portal after they use their email link. Cannot be read by page scripts', '60 days from last use'],
          ]}
        />
        <P>
          Our staff administration panel uses its own separate sign-in cookies, which only staff receive.
        </P>
        <P>
          <strong>Other storage on your device.</strong> The app also stores small non-personal settings in your browser,
          such as your chosen theme, whether the sidebar is collapsed, and short-lived items needed during sign-in (for
          example a two-factor step). These stay in your browser and are not sent to us as cookies.
        </P>
        <P>
          <strong>Third-party content on our pages.</strong> Our pages load fonts from Google Fonts and Google&apos;s sign-in
          library. When your browser loads them, Google receives your IP address and browser details. See Section 7.
        </P>
        <P>
          Because these cookies are strictly necessary, we do not ask for consent. You can block cookies in your browser, but
          LanceraOS will not work without them.
        </P>
      </S>

      <S n={10}>
        <SimpleTable
          headers={['Information', 'How long we keep it']}
          rows={[
            ['Your account and profile', 'While your account is active'],
            ['After you delete your account', 'A 30-day recovery window, during which you can restore the account in full. After 30 days your account is anonymized (see below)'],
            ['Sign-in sessions and trusted devices', 'Until they expire or you end them. They are deleted when your account is anonymized'],
            ['Backups', 'Our routine backups are kept on a rolling basis (currently the most recent 14 daily backups). Deleted information can remain in a backup until that backup is replaced'],
            ['Security log, request log and AI request log', 'For as long as needed for security, fraud prevention, troubleshooting and dispute resolution. These logs are not removed when an account is anonymized. They are not linked to your name after anonymization, but they can contain IP addresses'],
            ['Records about your clients and your work', 'See below'],
            ['Emails and messages you send us', 'For as long as needed to deal with your request and keep a record of it'],
          ]}
        />
        <P>
          <strong>What anonymization removes.</strong> After 30 days your name, email address, username, date of birth, phone
          number, business name, address, logo, payment details, CNIC, NTN and PSEB numbers, and custom email settings are
          removed or replaced, and your password stops working. Your sessions, trusted devices and linked Google sign-in are
          deleted.
        </P>
        <P>
          <strong>What is not removed automatically.</strong> Records you created about your clients and your work (clients,
          invoices, payments, expenses, proposals, contracts and attachments), and your stored signature image, are not part
          of your personal profile. They are not erased automatically when your account is anonymized. They stay stored, you
          can no longer sign in to manage them, and links you previously shared with clients may continue to work until the
          records are deleted. You can delete records yourself before you close your account wherever the app offers
          deletion. You can also email <MailLink address={PRIVACY} /> at any time, before or after closing your account, and
          we will delete them. Your clients can also email us to ask for their personal information to be deleted.
        </P>
        <P>
          <strong>Records you may need to keep.</strong> In Pakistan, taxpayers generally must keep their accounts and records
          for six years after the end of the relevant tax year. LanceraOS is not an archive for your legal records. Download
          and keep your own copies of invoices, statements and other records you are required to keep.
        </P>
      </S>

      <S n={11}>
        <P>We use reasonable technical and organizational measures, including:</P>
        <UL items={[
          'encryption in transit (HTTPS) between your browser and our servers;',
          'application-level encryption of CNIC, NTN and PSEB numbers and custom email passwords before storage, with the keys kept separate from the database;',
          'Argon2 password hashing, optional two-factor authentication, sign-in rate limiting and account lockout;',
          'sign-in cookies that page scripts cannot read, and protection against cross-site request forgery;',
          'a client portal that uses private email links and sessions that your clients can end;',
          'audit logging of security-relevant actions, and limits on who can access production systems.',
        ]} />
        <P>
          No system is completely secure. If we learn of a breach that is likely to cause you serious harm, we will tell you
          without undue delay by email, with what happened, what information was involved and what you can do, and we will
          notify others as the law requires.
        </P>
        <P>
          You can help by using a strong, unique password, turning on two-factor authentication, keeping your devices secure
          and ending sessions you do not recognize.
        </P>
      </S>

      <S n={12}>
        <P>
          You can do the following yourself in Settings: view and edit your profile, business and tax information; turn
          two-factor authentication on or off; see and end your sign-in sessions; change your email address or password;
          delete your account.
        </P>
        <P>
          In addition, whether you live in Pakistan or elsewhere, you may email <MailLink address={PRIVACY} /> to:
        </P>
        <UL items={[
          'ask what information we hold about you and receive a copy in a common format such as JSON or CSV;',
          'ask us to correct information that is wrong;',
          'ask us to delete information, including records described in Section 10;',
          'object to or ask us to restrict a use of your information;',
          'withdraw a consent you gave.',
        ]} />
        <P>
          We will confirm your request and normally reply within 30 days. We may need to confirm that you are the account
          holder first. We may keep or refuse part of a request where the law allows or requires it, for example where we
          must keep a record to meet a legal obligation, protect against fraud, or resolve a dispute, and we will tell you
          why.
        </P>
        <P>
          If you are unhappy with how we handled a request, tell us at <MailLink address={PRIVACY} /> and we will review it.
          You may also have the right to complain to a data protection authority where you live.
        </P>
      </S>

      <S n={13}>
        <P>
          If you received an invoice, proposal, contract or portal link, a LanceraOS user (a freelancer) has chosen to send
          it to you. The freelancer decides what information about you they record, and is responsible for it. LanceraOS
          stores and processes it for them.
        </P>
        <P>
          When you open a link we record that it was opened. If you reply, comment, report a payment, answer a proposal or
          sign a contract, we store what you submit and, for answers and signatures, your IP address and browser description.
          We use the portal cookie described in Section 9 only to keep you signed in to the portal.
        </P>
        <P>
          To ask what a freelancer holds about you, or to ask for correction or deletion, contact the freelancer first. You
          can also email <MailLink address={PRIVACY} /> and we will help, including by deleting your personal information
          from LanceraOS where we are able to do so. A signed contract may be something both parties need to keep, so we may
          point you to the other party in that case.
        </P>
      </S>

      <S n={14}>
        <P>
          LanceraOS is for people aged 18 and over. We do not knowingly collect information from anyone under 18. We check
          date of birth when an account is created. If we learn that an account belongs to someone under 18, we will close it
          and delete the information associated with it. If you believe a child has an account, email{' '}
          <MailLink address={PRIVACY} />.
        </P>
      </S>

      <S n={15}>
        <P>
          We may update this policy as LanceraOS changes or the law changes. The date and version at the top show when it
          last changed. For a significant change we will email the address on your account and show a notice in the app at
          least 30 days before it takes effect, unless the change is needed sooner to meet a legal requirement or to protect
          the service. If you do not agree with a change, you can delete your account before it takes effect.
        </P>
      </S>

      <S n={16}>
        <P>Privacy questions and requests: <MailLink address={PRIVACY} /></P>
        <P>Support: <MailLink address={SUPPORT} /></P>
        <P>LanceraOS, operated by Ali Amir, Pakistan.</P>
      </S>
    </LegalPageShell>
  )
}
