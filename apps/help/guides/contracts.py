# apps/help/guides/contracts.py
"""Guides: contracts (create, send and sign, signed copies). They explain the screens and make no claim about legal effect."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'create-a-contract', 'Create a contract', 'contracts',
        'Start a contract from a template or an accepted proposal, fill in the blanks and the key terms.',
        ['agreement', 'template', 'draft contract', 'clauses', 'sections', 'blanks', 'key terms', 'web development', 'design', 'consulting', 'content writing', 'from proposal'],
        [
            p('Open Contracts in the sidebar and press "New contract". Choose a template and press "Create draft". You can change every section afterwards. If a proposal was accepted, press "Create contract" on that proposal and the fee, currency, payment terms and client come from it.'),
            p('The editor shows the "Sections" of the contract, and you can add, remove, move and edit them. Text in double square brackets is a blank you must fill in or remove before sending. The "Blanks to fill" list takes you to the next one. The "Key terms" hold the "Fee", "Currency", "Payment terms", "Start date", "End date" and "Sign by".'),
            p('A draft saves by itself. Press "Preview" to read it the way your client will.'),
            note('These templates are starting points, not legal advice. Read every section, change what does not fit your work, and have a lawyer check the contract before you rely on it.'),
            link('Open Contracts', '/contracts'),
        ],
        related=['send-and-sign-a-contract', 'turn-a-proposal-into-an-invoice', 'signed-contracts-and-the-pdf'],
        ui_labels=['New contract', 'Create draft', 'Create contract', 'Sections', 'Blanks to fill', 'Key terms', 'Fee', 'Currency', 'Payment terms', 'Start date', 'End date', 'Sign by', 'Preview'],
        sources=['frontend/src/pages/ContractNew.jsx', 'frontend/src/pages/ContractEditor.jsx', 'frontend/src/pages/contractCopy.js', 'apps/contracts/clauses.py'],
        checked_on=TODAY),
    guide(
        'send-and-sign-a-contract', 'Send a contract and get it signed', 'contracts',
        'Sign and send a contract by email or link, and see how your client signs or declines.',
        ['esign', 'signature', 'client signs', 'decline contract', 'withdraw contract', 'sign by date', 'contract link', 'no account', 'type name'],
        [
            p('Open a draft contract and press "Send". The box "Send this contract" runs a checklist called "Before sending". Choose how to send it: by email, or "Create the link only" and send the link yourself. Then type your full name under "Sign as the freelancer" and press "Sign and send" or "Sign and create link". After that the text is locked.'),
            p('Your client opens a private link. They do not need an account. They press "Review and sign", type their full name, tick the box that says they have read and agree, and press "Sign contract". Or they press "Decline" and can give a reason. Their answer is final. The client can sign up to and including the "Sign by" date.'),
            p('Until the client answers, you can press "Withdraw" to close the link. Your client is not emailed, and you can copy the contract into a new draft.'),
            note('Anyone who has the link can sign it, so send it only to your client. LanceraOS does not check who is typing the name.'),
        ],
        related=['create-a-contract', 'signed-contracts-and-the-pdf', 'notification-settings'],
        ui_labels=['Send', 'Send this contract', 'Before sending', 'Create the link only', 'Sign as the freelancer', 'Sign and send', 'Sign and create link',
                   'Review and sign', 'Sign contract', 'Decline', 'Sign by', 'Withdraw'],
        sources=['frontend/src/components/SendContractDialog.jsx', 'frontend/src/pages/ContractPublic.jsx', 'frontend/src/pages/contractCopy.js'],
        checked_on=TODAY),
    guide(
        'signed-contracts-and-the-pdf', 'Signed contracts and the PDF', 'contracts',
        'What the signature record shows, how to get the signed PDF, and what the fingerprint means.',
        ['signature record', 'fingerprint', 'signed copy', 'download contract', 'pdf', 'hash', 'proof', 'evidence', 'ip address'],
        [
            p('When a contract is signed, its page shows a "Signature record" with both names, the times, and each person\'s IP address and browser details. The page says it is a record of what was entered when each person signed, and that it does not prove who the person was.'),
            p('The fingerprint is a short code worked out from the exact text of the contract. LanceraOS works it out again at the moment of signing. If the text had changed, the two would not match and signing would stop. After signing, "The two fingerprints are the same" is shown.'),
            p('Press "Download PDF" to get the contract as a PDF. Your client can use "Download signed copy (PDF)" on their page once it is signed, and a signed copy is emailed to them.'),
            note('LanceraOS does not say what a signature means in law. Ask a lawyer about your own situation.'),
        ],
        related=['send-and-sign-a-contract', 'create-a-contract'],
        ui_labels=['Signature record', 'The two fingerprints are the same', 'Download PDF', 'Download signed copy (PDF)'],
        sources=['frontend/src/pages/contractCopy.js', 'frontend/src/components/ContractSignatureCard.jsx', 'apps/contracts/integrity.py', 'CONTRACTS_LAW.md'],
        checked_on=TODAY),
)
