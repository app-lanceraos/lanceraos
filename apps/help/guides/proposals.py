# apps/help/guides/proposals.py
"""Guides: proposals and AI (write with AI, score and tips, send, convert to an invoice, AI in LanceraOS)."""
from . import guide, link, note, p, steps

TODAY = '2026-11-11'

GUIDES = (
    guide(
        'write-a-proposal-with-ai', 'Write a proposal with AI', 'proposals',
        'Paste a job post and get a first draft you can edit, or start from a blank proposal.',
        ['upwork', 'fiverr', 'cover letter', 'bid', 'pitch', 'job post', 'generate', 'ai proposal', 'tone', 'draft', 'regenerate', 'blank proposal'],
        [
            p('Open Proposals in the sidebar and press "New Proposal". The page "Write a proposal" asks for the "Job post", a "Tone" (Professional, Friendly or Technical), an optional "Title (optional)" and your experience in "Your experience (optional)".'),
            steps(
                'Paste the client\'s job description into "Job post".',
                'Choose a tone, and add your experience. Write only what is true: the AI is told not to invent anything beyond it.',
                'Press "Generate with AI". It usually takes a short while, so keep the page open.',
                'Read the draft, change anything that is not right, and fill in the client, the scope, the prices and "Valid until".',
            ),
            p('You can also choose "Start from a blank proposal". A draft saves automatically as you type. The editor has a "Regenerate the proposal text?" step, which replaces your text, so it asks you to confirm first.'),
            note('An AI draft is marked "AI-assisted draft". It can say things you never told it, so read the whole text before you send it. The AI sees only the job post, your experience notes, and your name, business name and profession.'),
            link('Write a proposal', '/proposals/new'),
        ],
        related=['proposal-score-and-tips', 'send-a-proposal', 'ai-features-in-lanceraos'],
        ui_labels=['New Proposal', 'Write a proposal', 'Job post', 'Tone', 'Title (optional)', 'Your experience (optional)', 'Generate with AI',
                   'Start from a blank proposal', 'Valid until', 'Regenerate the proposal text?', 'AI-assisted draft'],
        sources=['frontend/src/pages/ProposalNew.jsx', 'frontend/src/pages/ProposalEditor.jsx', 'frontend/src/pages/proposalHelpers.js', 'apps/proposals/prompts.py'],
        checked_on=TODAY),
    guide(
        'proposal-score-and-tips', 'Your proposal score and tips', 'proposals',
        'What the proposal score card checks, and how the tips can help you improve a draft.',
        ['quality score', 'checks', 'passed', 'not passed', 'improve proposal', 'tips', 'win job', 'rating'],
        [
            p('A draft shows a "Proposal score" card. It counts simple checks on your text: its length, how many key terms of the job post you used, a clear next step, a specific number, no stock cliches, and readable sentences and paragraphs. Each check is "Passed", "Partly passed", "Not passed" or "Not applicable".'),
            p('The score is worked out by software from the last text you saved, not by AI. While your edits are still being saved, the card says "Based on your last saved text".'),
            p('The "Tips" card gives a few suggestions specific to the job post. Use them as prompts for your own wording, then read the checks again.'),
            note('The score counts checks. It does not predict whether you will win the job.'),
        ],
        related=['write-a-proposal-with-ai', 'send-a-proposal', 'ai-features-in-lanceraos'],
        ui_labels=['Proposal score', 'Passed', 'Partly passed', 'Not passed', 'Not applicable', 'Based on your last saved text', 'Tips'],
        sources=['frontend/src/components/ProposalScoreCard.jsx', 'frontend/src/components/ProposalTipsCard.jsx', 'apps/proposals/scoring.py'],
        checked_on=TODAY),
    guide(
        'send-a-proposal', 'Send a proposal', 'proposals',
        'Send a proposal by email or as a link, see when your client opens it, and withdraw it if needed.',
        ['share proposal', 'client link', 'accept', 'decline', 'withdraw', 'preview', 'email proposal', 'proposal status', 'duplicate proposal'],
        [
            p('Open a draft proposal and press "Send". A dialog called "Before sending" checks the draft. Items marked "Fix" must be fixed, and items marked "Worth a look" are suggestions. Then choose how to send: email it to your client, or create a link to paste into WhatsApp, Upwork or anywhere else.'),
            p('Your client opens the link without logging in, reads the proposal and presses "Accept proposal" or "Decline proposal", with an optional message. Anyone who has the link can read the proposal. Press "Preview" to see what the client sees.'),
            p('Once sent, a proposal cannot be edited. "Withdraw" makes the client\'s link show that it was withdrawn, and the client is not emailed. A withdrawal cannot be undone. To send a revised version, press "Duplicate" to copy it into a new draft.'),
            note('Whether you get a bell or email alert when a client answers depends on the "Client Messages" switch in Settings.'),
        ],
        related=['write-a-proposal-with-ai', 'turn-a-proposal-into-an-invoice', 'notification-settings'],
        ui_labels=['Send', 'Before sending', 'Fix', 'Worth a look', 'Accept proposal', 'Decline proposal',
                   'Preview', 'Withdraw', 'Duplicate', 'Client Messages'],
        sources=['frontend/src/components/SendProposalDialog.jsx', 'frontend/src/components/ProposalHeader.jsx', 'frontend/src/components/WithdrawProposalDialog.jsx', 'frontend/src/pages/ProposalPublic.jsx', 'frontend/src/components/ProposalLinkCard.jsx'],
        checked_on=TODAY),
    guide(
        'turn-a-proposal-into-an-invoice', 'Turn an accepted proposal into an invoice', 'proposals',
        'Create a draft invoice from an accepted proposal, or start a contract from it.',
        ['convert proposal', 'proposal to invoice', 'accepted proposal', 'after acceptance', 'create contract', 'next step', 'client accepted'],
        [
            p('When your client accepts, the proposal shows as accepted. Open it and press "Create invoice". The dialog "Create an invoice from this proposal" makes a draft invoice with the same items and totals.'),
            p('If the proposal has a saved client, that client is used. Otherwise you can tick the box to also save the client. If you already have a client with that email, LanceraOS uses that one instead of making a copy. Without a name and email, the invoice is made for a one-time client.'),
            p('Press "Create draft invoice". The invoice is not sent. Review it, then finalise and send it like any other. Afterwards the proposal shows "Open invoice".'),
            p('An accepted proposal also has "Create contract", which starts a contract from its details.'),
            note('A proposal with no priced items has nothing to invoice. Start a new invoice from the Invoices page instead.'),
        ],
        related=['create-an-invoice', 'create-a-contract', 'send-a-proposal'],
        ui_labels=['Create invoice', 'Create an invoice from this proposal', 'Create draft invoice', 'Open invoice', 'Create contract'],
        sources=['frontend/src/components/ConvertProposalDialog.jsx', 'frontend/src/components/ProposalHeader.jsx', 'frontend/src/pages/proposalLifecycle.js'],
        checked_on=TODAY),
    guide(
        'ai-features-in-lanceraos', 'AI in LanceraOS', 'proposals',
        'Where LanceraOS uses AI, what it sees, and why you should check what it writes.',
        ['artificial intelligence', 'chatgpt', 'ai writing', 'insights', 'privacy', 'ai off', 'ai mistakes', 'machine'],
        [
            p('LanceraOS uses AI in a few places. In Proposals, "Generate with AI" writes a first draft and tips from a job post you paste. On the Dashboard, the "Insights" card can word short observations about your own totals; when AI is not used there, the card shows fixed sentences built from the same figures. Help can word a short answer from its guides when that is switched on, and otherwise shows the matching guides.'),
            p('The text you paste into an AI feature is processed by an outside AI service. For proposals, it sees only the job post, your experience notes and your name, business name and profession. The Insights card sends short sentences about your own figures.'),
            p('AI can be wrong. It can say something you never told it. Read every draft and correct it before you send it to a client. The Insights card says "Written by AI from your own figures" only when AI wrote the words.'),
            note('The proposal score, the health score and all the numbers in LanceraOS are calculated by software from your records, not by AI.'),
        ],
        related=['write-a-proposal-with-ai', 'your-dashboard', 'health-score'],
        ui_labels=['Generate with AI', 'Insights', 'Written by AI from your own figures'],
        sources=['frontend/src/pages/ProposalNew.jsx', 'frontend/src/components/DashboardInsightsCard.jsx', 'frontend/src/pages/dashboardHelpers.js', 'apps/dashboard/insights.py', 'apps/proposals/services.py'],
        checked_on=TODAY),
)
