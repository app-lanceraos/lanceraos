// src/pages/contractCopy.js
//
// Every static sentence of the Contracts pages, in one place (Prompt 23, Appendix A). Two objects: PUBLIC_COPY (the
// client's signing page and the document) and OWNER_COPY (the freelancer's pages). A few sentences mirror the server's
// (apps/contracts/copy.py); a test compares them with the generated fixture `sentences.json` so a wording change on
// one side cannot go unnoticed. A second test scans every string here for the words the module must never use
// (decision K16: no claim of legal effect, certification or an identity check; no marketing words).
//
// Plain functions of their arguments are used where a sentence carries a name, a date or a count. Nothing here is
// HTML: every value is shown as a React text node.

const plural = (n, one, many) => (n === 1 ? one : many)

// Download failures (the owner's PDF and the client's signed copy).
export const PDF_COPY = {
  rateLimit: 'You have downloaded a lot of PDFs in a short time. Please wait a little and try again.',
  timeout: 'Creating the PDF is taking too long. Please try again in a moment.',
  network: "We couldn't reach LanceraOS. Check your connection and try again.",
  fallback: 'Could not create the PDF. Please try again.',
}

// ── The client's page ─────────────────────────────────────────────────

export const PUBLIC_COPY = {
  notFoundTitle: "This link doesn't work",
  notFoundBody: 'The contract may not exist, or the link may be incomplete. Please ask the sender to send it again.',
  loadErrorTitle: "We couldn't load this contract",
  loadErrorBody: 'Check your connection and try again.',
  tryAgain: 'Try again',
  reloadButton: 'Reload this page',
  loading: 'Loading contract…',
  tooManyTitle: 'Too many requests',
  tooManyBody: 'Please wait a few minutes and try again.',
  ownerBanner: 'This is a preview of your own contract. Your client sees the signing form here. You cannot sign or decline your own contract.',

  signHeading: 'Review and sign',
  signIntro: 'Read the contract above. If you agree to it, type your full name below to sign it.',
  linkNote: 'Anyone who has this link can sign this contract. Only sign if you are the client named above.',
  recordedNote: 'When you sign, we record the name you type, the time, your IP address and your browser details.', // = EMAIL_RECORDED
  nameLabel: 'Your full name',
  nameHint: 'Typing your name here is how you sign.',
  agreeLabel: 'I have read this contract and I agree to it.',
  reviewButton: 'Review and sign',
  declineButton: 'Decline',

  confirmTitle: 'Sign this contract?',
  confirmBody: (name) => `You are about to sign as ${name}.`,
  confirmFinal: "Your signature is final. You won't be able to change it afterwards.",
  confirmButton: 'Sign contract',
  backButton: 'Back',
  signing: 'Signing…',

  signedTitle: 'You signed this contract',
  signedBody: (name, when) => `Signed by ${name} on ${when}.`,
  signedRecorded: 'Your signature has been recorded.',
  downloadSigned: 'Download signed copy (PDF)',
  printButton: 'Print or save as PDF',
  downloadFailed: 'Could not download the PDF. Please try again.',
  pdf: PDF_COPY,
  downloading: 'Preparing PDF…',

  declineTitle: 'Decline this contract?',
  declineReasonLabel: (sender) => `Reason for ${sender} (optional)`,
  declineFinal: "Your answer is final. You won't be able to change it afterwards.",
  declineConfirm: 'Confirm decline',
  declining: 'Declining…',
  declinedTitle: 'You declined this contract',
  declinedBody: 'Your answer has been recorded.',
  declinedReason: 'Your reason:',
  reasonTooLong: (n) => `Your reason is ${n} characters too long.`, // = REASON_TOO_LONG

  expiredTitle: (date) => `This contract was open to sign until ${date}`,
  expiredBody: (name) => `It can no longer be signed or declined. Please contact ${name} if you would still like to go ahead.`,
  withdrawnTitle: 'This contract was withdrawn',
  withdrawnBody: (name, title) => `${name} withdrew “${title}”. You can no longer sign or decline it. Please contact them if you have questions.`,

  // Mirrors of the server's sentences (apps/contracts/copy.py).
  nameRequired: 'Type your full name to sign.',
  nameLength: 'Your name must be between 2 and 120 characters.',
  nameNeedsLetters: 'Use letters in your name.',
  agreeRequired: 'Tick the box to confirm you agree.',

  // Notices (role="status").
  notices: {
    owner: "You own this contract, so you can't sign or decline it.",
    alreadyAnswered: 'This contract was already answered, so nothing changed.',
    withdrawnRace: 'This contract was withdrawn before your answer was recorded.',
    expiredRace: 'This contract passed its sign-by date before your answer was recorded.',
    answeredDifferently: 'This contract had already been answered, so your answer was not recorded. The answer below is the one on record.',
    answer429: 'Too many attempts. Please wait a few minutes and try again.',
    ambiguous: "We couldn't record your answer. Please try again.",
    ambiguousUnknown: "We couldn't tell whether your answer was recorded. Reload this page to check before you try again.",
    badRequest: 'Please check what you entered and try again.',
    serverError: 'Something went wrong on our side. Please try again.',
  },

  // The document itself.
  doc: {
    parties: 'Parties',
    freelancer: 'Freelancer',
    client: 'Client',
    keyTerms: 'Key terms',
    fee: 'Fee',
    paymentTerms: 'Payment terms',
    startDate: 'Start date',
    endDate: 'End date',
    signBy: 'Sign by',
    signatures: 'Signatures',
    notSignedYet: 'Not signed yet',
    signedOn: (when) => `Signed on ${when} PKT`, // `when` carries no zone label of its own
    fingerprintLabel: 'Document fingerprint (SHA-256):', // = PDF_FINGERPRINT_LABEL
    fingerprintNote: 'The fingerprint is calculated from the text of this contract when it was sent. If any word changes, the fingerprint changes.', // = PDF_FINGERPRINT_NOTE
    signingNoteBoth: 'Each person signed by typing their name. Times are Pakistan time (PKT).', // = PDF_SIGNING_NOTE_BOTH
    signingNoteOwner: 'The freelancer signed by typing their name. Times are Pakistan time (PKT).', // = PDF_SIGNING_NOTE_OWNER
    blankBanner: 'These highlighted parts still need your text.',
    contract: 'Contract',
    draftNumber: 'Draft',
    seeTerms: 'See payment terms',
    declinedOn: (when) => `Declined on ${when} PKT`,
  },
}

// ── The freelancer's pages ────────────────────────────────────────────

export const OWNER_COPY = {
  disclaimer: 'These templates are starting points, not legal advice. Read every section, change what does not fit your work, and have a lawyer check the contract before you rely on it.',

  howSigningWorksTitle: 'How signing works',
  howSigningWorks: [
    'You sign by typing your full name when you send. After that the text is locked.',
    'Your client opens a private link. They do not need an account. They type their name to sign, or they decline.',
    "We keep both names, the times and a SHA-256 fingerprint of the text. We also keep each person's IP address and browser details.",
    'Anyone who has the link can sign it, so send it only to your client. We do not check who is typing the name.',
  ],

  blanksTitle: 'Blanks to fill',
  blanksExplain: 'Text in double square brackets is a blank you must fill in or remove before sending.',
  blanksCount: (n) => `${n} ${plural(n, 'blank', 'blanks')} to fill`,
  blanksNone: 'No blanks left to fill',
  nextBlank: 'Next blank',
  noBlank: 'No blanks in this section.',
  needsText: 'Needs your text',

  sectionsTitle: 'Sections',
  addSection: 'Add section',
  removeSection: 'Remove section',
  removeConfirm: 'Remove this section?',
  removeYes: 'Remove',
  removeNo: 'Keep',
  moveUp: 'Move up',
  moveDown: 'Move down',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  untitledSection: 'Untitled section',
  sectionCount: (n, max) => `${n} of ${max} sections`,
  sectionsSummary: (n) => `${n} ${plural(n, 'section', 'sections')}`,
  sectionTitleLabel: 'Section title',
  sectionTextLabel: 'Section text',
  totalTextLabel: 'All section text together',
  sectionsLimit: 'You have reached the most sections a contract can have.',

  detailsTitle: 'Details',
  titleLabel: 'Title',
  keyTermsTitle: 'Key terms',
  feeLabel: 'Fee',
  feeHint: 'Shown in the key terms. Leave it at 0 if the payment terms say what the client pays.',
  currencyLabel: 'Currency',
  paymentTermsLabel: 'Payment terms',
  startLabel: 'Start date',
  endLabel: 'End date',
  signByLabel: 'Sign by',
  signByHint: 'Your client can sign up to and including this date (Pakistan time).',
  quickPicks: [{ days: 7, label: '+7 days' }, { days: 14, label: '+14 days' }, { days: 30, label: '+30 days' }],
  clientEmailHint: 'Needed to send the contract by email',
  templateTitle: 'Template',
  templateVersion: (version) => `Clause library ${version}`,

  newTitle: 'New contract',
  newIntro: 'Choose a template. You can change every section afterwards.',
  whatsInside: "What's inside",
  createButton: 'Create draft',
  creating: 'Creating…',
  fromProposal: (title) => `Starting from your accepted proposal “${title}”`,
  fromProposalCopied: 'The fee, currency, payment terms and client come from the proposal. You can change them in the next step.',
  proposalMissing: 'That proposal could not be found.',
  proposalNotAccepted: 'Only an accepted proposal can be turned into a contract.', // = PROPOSAL_NOT_ACCEPTED
  createFailed: 'Could not create the contract. Please try again.',
  chooseTemplate: 'Choose a template to continue.',
  templatesLoadFailed: 'Could not load the templates. Try again.',
  titleOptionalLabel: 'Title (optional)',
  titlePlaceholder: (label) => `${label} agreement`,

  listTitle: 'Contracts',
  emptyTitle: 'No contracts yet',
  emptyBody: 'A contract turns the work you agreed into something both of you sign. Start from a template, or from an accepted proposal.',
  newButton: 'New contract',
  noResultsTitle: 'No contracts match',
  noResultsBody: 'Try a different search or status.',
  noClient: 'No client yet',
  seeTerms: 'See payment terms',
  deleted: 'Contract deleted.',
  searchPlaceholder: 'Search by title, client or company',
  columns: { contract: 'Contract', client: 'Client', fee: 'Fee', signBy: 'Sign by', status: 'Status', updated: 'Updated' },
  noNumber: 'Draft',
  listLoadFailed: 'Could not load your contracts. Try again.',

  saveWaiting: 'Your latest changes are still saving. Try again in a moment.',
  waitForSave: 'Your latest changes are still saving. Try again in a moment.',
  notDraftAnymore: 'This contract is no longer a draft, so your last changes were not saved. It is shown below as it was sent.',
  previewNote: 'This is how the contract reads. Your client also sees a signing form below it.',
  duplicated: 'Copied as a new draft. Set a new sign-by date before sending.',
  duplicateNotSaved: "We couldn't save your latest changes, so nothing was copied.",
  deleteTitle: 'Delete this draft?',
  deleteBody: "It will be removed. This can't be undone.",
  deleteButton: 'Delete draft',
  deleting: 'Deleting…',
  deleteFailed: 'Could not delete the draft. Please try again.',
  duplicateFailed: 'Could not copy the contract. Please try again.',
  fixFirst: 'Fix the highlighted fields first.',
  contractTitle: 'Contract',
  newPageTitle: 'New Contract',

  sendTitle: 'Send this contract',
  sendIntro: "Check these before you send. Once it is sent the text is locked and you can't edit it. You can withdraw it, or copy it into a new draft.",
  methodLegend: 'How to send it',
  methodEmail: (email) => `Email it to ${email}`,
  methodEmailNoAddress: "Email (add the client's email address first)",
  methodLink: 'Create the link only',
  signSection: 'Sign as the freelancer',
  signNameLabel: 'Your full name',
  signNameHint: 'Typing your name here is how you sign.',
  signRecorded: 'We record your name, the time, your IP address and your browser details when you send.',
  sendAndSign: 'Sign and send',
  linkAndSign: 'Sign and create link',
  checking: 'Checking…',
  checkFailed: 'Could not check the contract. Try again.',
  checkAgain: 'Check again',
  sending: 'Sending…',
  verifying: 'Making sure it was sent…',
  unconfirmedTitle: "We couldn't confirm that it was sent",
  unconfirmedBody: "The connection dropped. Check the contract before you try again, so your client isn't sent it twice.",
  closeButton: 'Close',
  cancelButton: 'Cancel',
  goToField: 'Go to this field',
  warningsTitle: 'Worth a look',
  checklistTitle: 'Before sending',
  verifyingBody: "We lost the connection before getting an answer. We are checking now, so please don't send it again.",
  checkUnreachable: "We couldn't reach the server to check.",
  alreadySentElsewhere: 'This contract was already sent from another tab or device. Here is its current state.',
  reloadContract: 'Reload contract',
  keepIt: 'Keep it',
  withdrawUnconfirmed: "We couldn't confirm whether the withdrawal went through. Reload to see the contract's current status before trying again.",
  withdrawStale: "This contract's status had already changed, so this withdrawal wasn't applied. Here is its current state.",
  saveFailedNothingSent: "We couldn't save your latest changes, so nothing was sent. Check your connection and try again.",
  fieldsHaveProblems: "Some fields have problems and haven't been saved. Fix the highlighted fields, then send.",
  methodEmailHelp: (replyTo) => `We email your client a link to the contract. Their replies come to ${replyTo}.`,
  methodLinkHelp: 'Nothing is emailed. You copy the link and send it yourself, in a chat, on the job platform or from your own email.',

  sentEmail: (email, number) => `Sent to ${email}. Contract ${number} is now with your client.`,
  sentLink: (number) => `Link created. Contract ${number} is ready to share. Copy the link below and send it to your client.`,
  recoveredPrefix: 'The connection dropped, but the contract was sent. ',
  withdrawn: (number) => `Contract ${number} withdrawn. Your client's link now shows it as withdrawn. Your client was not emailed.`,
  linkCopied: 'Link copied',
  linkCopyFailed: 'Could not copy the link. Select it and copy it yourself.',

  linkTitle: 'Client link',
  linkNote: 'Anyone who has this link can sign it. Send it only to your client.',
  linkClosed: 'This link no longer accepts a signature.',
  copyLink: 'Copy link',

  withdrawTitle: 'Withdraw this contract?',
  withdrawBody: "Your client's link will show that the contract was withdrawn, and they can no longer sign or decline it. We do not email your client. You can copy it into a new draft afterwards.",
  withdrawButton: 'Withdraw contract',
  withdrawing: 'Withdrawing…',
  withdrawFailed: 'Could not withdraw the contract. Please try again.',

  recordTitle: 'Signature record',
  recordCaption: 'This is a record of what was entered when each person signed. It does not prove who the person was.',
  fingerprintsEqual: 'The two fingerprints are the same.',
  noReason: 'No reason given.',
  recordLabels: {
    freelancer: 'Freelancer', client: 'Client', name: 'Name', signed: 'Signed', declined: 'Declined', ip: 'IP address', browser: 'Browser',
    hashSent: 'Fingerprint when sent', hashSigned: 'Fingerprint when signed',
  },
  notRecorded: 'Not recorded',

  timeline: {
    title: 'Activity',
    created: 'Draft created',
    ownerSigned: (name) => `You signed as ${name}`,
    sentEmail: (email) => `Sent by email to ${email}`,
    sentLink: 'Link created',
    viewed: 'Your client opened it',
    signedBy: (name) => `${name} signed`,
    declined: 'Your client declined',
    withdrawn: 'You withdrew it',
    signByPassed: (date) => `The sign-by date passed on ${date}`,
  },

  summaryTitle: 'Summary',
  contractTextTitle: 'Contract text',
  showText: 'Show contract text',
  hideText: 'Hide contract text',
  clientReasonTitle: "Your client's reason",
  sentVia: { email: 'Email', link: 'Link only' },
  summaryLabels: { client: 'Client', email: 'Email', fee: 'Fee', signBy: 'Sign by', sentVia: 'Sent by', number: 'Number' },

  loadFailed: 'Could not load this contract. Try again.',
  notFound: 'This contract could not be found.',
  backToList: 'Back to contracts',
  pdfFailed: 'Could not download the PDF. Please try again.',
  pdf: PDF_COPY,
  actions: {
    send: 'Send', preview: 'Preview', copy_link: 'Copy link', withdraw: 'Withdraw', duplicate: 'Duplicate',
    delete: 'Delete', pdf: 'Download PDF',
  },
  actionBusy: { send: 'Saving…', pdf: 'Preparing…' },
  copied: 'Copied',
  statuses: {
    draft: 'Draft', sent: 'Sent', viewed: 'Viewed', signed: 'Signed', declined: 'Declined', withdrawn: 'Withdrawn',
    expired: 'Expired',
  },
}
