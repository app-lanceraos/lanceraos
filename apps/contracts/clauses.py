# apps/contracts/clauses.py
"""
The five contract templates, as data (Prompt 22). Plain English, short, balanced between the two sides, and STARTING
POINTS: they have not been reviewed by a lawyer (CONTRACTS_LAW.md, "Before public launch"). They contain no variables:
the parties, fee, currency, payment terms and dates are printed from fields in the "Key terms" block, so editing a
number can never leave a stale number inside a clause. Text the freelancer must write is wrapped in double square
brackets; sending is refused while any [[...]] is left.

Changing ANY text here changes a contract's fingerprint for new contracts only (old ones keep their frozen text) and
fails the library fingerprint test on purpose: bump CLAUSE_LIBRARY_VERSION and the pinned constant together.
"""
import copy

CLAUSE_LIBRARY_VERSION = '2026-11-10'

TEMPLATE_LABELS = {
    'web_development': ('Web Development', 'For building a website or web application.'),
    'design': ('Design', 'For logos, brand work, screens and illustrations.'),
    'consulting': ('Consulting', 'For advice, reviews, workshops and ongoing support.'),
    'content_writing': ('Content Writing', 'For articles, copy and other written work.'),
    'custom': ('Custom', 'A short general agreement you fill in yourself.'),
}

_SHARED = [
    {'id': 'fees', 'title': 'Fee and payment', 'text': (
        'The Client will pay the Freelancer the Fee shown under Key terms, in the currency shown there, following the '
        'payment terms shown there.\n\n'
        'Each party pays the charges made by its own bank or payment provider. The Fee does not include taxes that the '
        'law puts on the Client.\n\n'
        'If an invoice that is not in dispute is not paid by its due date, the Freelancer may pause work until it is '
        'paid, after telling the Client in writing.')},
    {'id': 'client-duties', 'title': 'What the Client provides', 'text': (
        'The Client will give the Freelancer the information, files, access and feedback the work needs, within a '
        'reasonable time. If input is late or missing, the dates in this contract move by the same amount of time.')},
    {'id': 'ownership', 'title': 'Ownership of the work', 'text': (
        'When the Freelancer has been paid in full, the Client owns the final work made specifically for the Client '
        'under this contract. Until then the Freelancer keeps all rights in it.\n\n'
        'The Freelancer keeps ownership of its own tools, templates and know-how, and gives the Client a non-exclusive '
        'right to use any of them that are built into the final work.\n\n'
        'The Freelancer may show the finished work in its portfolio, unless the Client asks in writing for it not to.')},
    {'id': 'confidentiality', 'title': 'Confidentiality', 'text': (
        'Each party will keep the other party\'s non-public business information private, use it only for this '
        'contract, and not share it, except with advisers who need it or when the law requires it. This does not apply '
        'to information that is already public through no fault of the party holding it. This duty continues for two '
        'years after this contract ends.')},
    {'id': 'contractor', 'title': 'Independent contractor', 'text': (
        'The Freelancer works as an independent contractor, not as an employee, partner or agent of the Client. The '
        'Freelancer decides how, where and when the work is done, within the dates in this contract, and is '
        'responsible for its own taxes and insurance.')},
    {'id': 'ending', 'title': 'Ending this contract', 'text': (
        'Either party may end this contract by giving the other 14 days\' notice in writing (email is enough).\n\n'
        'The Client will pay for the work done up to the end date, and for agreed expenses already committed.\n\n'
        'Either party may end this contract at once if the other seriously breaks it and does not fix the problem '
        'within 7 days of being told in writing.')},
    {'id': 'liability', 'title': 'Limit of liability', 'text': (
        'As far as the law allows, each party\'s total liability to the other under this contract is limited to the '
        'Fee, and neither party is liable for lost profit or indirect loss. This does not limit the Client\'s duty to '
        'pay the Fee, or any liability that the law does not allow to be limited.')},
    {'id': 'law', 'title': 'Governing law and disputes', 'text': (
        'This contract is governed by the laws of Pakistan. If there is a dispute, the parties will first try to settle '
        'it by talking to each other in good faith. If that does not work within 30 days, either party may take the '
        'dispute to the courts of Pakistan.')},
    {'id': 'whole-agreement', 'title': 'Whole agreement and signing', 'text': (
        'This contract, with its Key terms, is the whole agreement about this work and replaces earlier discussions. '
        'A change is valid only if both parties agree to it in writing.\n\n'
        'The parties agree that typing their names on LanceraOS is how they sign this contract, and that a copy of it '
        'showing those names and the times they were typed is a record of their agreement.')},
]

_SPECIFIC = {
    'web_development': [
        {'id': 'scope', 'title': 'Scope of work', 'text': (
            'The Freelancer will design, build and deliver the website or web application described here: '
            '[[Describe the pages, features, integrations and the technology to be used.]]')},
        {'id': 'deliverables', 'title': 'Deliverables and timeline', 'text': (
            'The Freelancer will deliver: [[List the deliverables, for example the source code, the finished site on the '
            'Client\'s hosting and the admin login.]]\n\n'
            'Work starts on the start date in Key terms and the Freelancer will aim to finish by the end date.')},
        {'id': 'revisions', 'title': 'Revisions and changes', 'text': (
            'The Fee includes [[number]] rounds of changes to the agreed scope. A round is one set of feedback given '
            'together. Changes outside the agreed scope, and extra rounds, are extra work and are priced and agreed in '
            'writing before they start.')},
        {'id': 'hosting-warranty', 'title': 'Hosting, third-party services and fixes', 'text': (
            'Unless this contract says otherwise, the Client pays for hosting, domain names, licences and other '
            'third-party services.\n\n'
            'For 30 days after delivery the Freelancer will fix, free of charge, any bug where the work does not do what '
            'the scope describes. Fixes for later problems, or for changes made by other people, are extra work.')},
    ],
    'design': [
        {'id': 'scope', 'title': 'Scope of work', 'text': (
            'The Freelancer will create the design work described here: [[Describe what is being designed, for example '
            'a logo, a brand kit, app screens or illustrations.]]')},
        {'id': 'deliverables', 'title': 'Deliverables and file formats', 'text': (
            'The Freelancer will deliver the final files in these formats: [[List the file formats.]] Working files are '
            'not included unless they are listed here.\n\n'
            'Work starts on the start date in Key terms and the Freelancer will aim to finish by the end date.')},
        {'id': 'revisions', 'title': 'Concepts and revisions', 'text': (
            'The Freelancer will present [[number]] first concept(s). The Client chooses one, and the Fee includes '
            '[[number]] rounds of changes to it. A round is one set of feedback given together. A change of direction '
            'after a concept is chosen, and extra rounds, are extra work and are priced and agreed in writing before they '
            'start.')},
        {'id': 'licensed-material', 'title': 'Fonts, images and licensed material', 'text': (
            'Fonts, stock images and other material licensed from third parties are included only if this contract '
            'lists them. Otherwise the Client buys the licences it needs.')},
    ],
    'consulting': [
        {'id': 'scope', 'title': 'Scope of services', 'text': (
            'The Freelancer will give the Client advice and support on: [[Describe the topic and the work, for example a '
            'review, a series of workshops or a monthly advisory service.]]')},
        {'id': 'deliverables', 'title': 'Deliverables and meetings', 'text': (
            'The Freelancer will provide: [[List the reports, sessions or hours.]]\n\n'
            'Meetings are held online unless the parties agree otherwise. A meeting that the Client cancels with less than '
            '24 hours\' notice counts as used.\n\n'
            'Work starts on the start date in Key terms and ends on the end date, if one is shown.')},
        {'id': 'advice-only', 'title': 'Advice only', 'text': (
            'The Freelancer gives advice based on the information the Client provides. The Client makes its own decisions '
            'and is responsible for them. The Freelancer does not give legal, tax or financial advice unless this contract '
            'says it does.')},
        {'id': 'changes', 'title': 'Changes to the scope', 'text': (
            'Work outside the scope above is extra work. Its price is agreed in writing before it starts.')},
    ],
    'content_writing': [
        {'id': 'scope', 'title': 'Scope of work', 'text': (
            'The Freelancer will write the content described here: [[Describe the pieces, for example articles, product '
            'descriptions or web copy, with topics and word counts.]]')},
        {'id': 'deliverables', 'title': 'Deliverables and deadlines', 'text': (
            'Each piece is delivered as [[file format]] by the date agreed for it. Word counts are targets: a piece within '
            '10% above or below the agreed count meets the agreement.\n\n'
            'Work starts on the start date in Key terms and the Freelancer will aim to finish by the end date.')},
        {'id': 'revisions', 'title': 'Revisions', 'text': (
            'The Fee includes [[number]] round(s) of edits for each piece. A round is one set of feedback given together. '
            'A new brief, a new angle or extra rounds are extra work and are priced and agreed in writing before they '
            'start.')},
        {'id': 'originality', 'title': 'Originality and facts', 'text': (
            'The Freelancer will write original content and will not copy the work of others. The Client is responsible '
            'for checking the facts and claims in the content before it is published, unless this contract says the '
            'Freelancer will do so.')},
    ],
    'custom': [
        {'id': 'scope', 'title': 'Scope of work', 'text': (
            'The Freelancer will do the work described here: [[Describe the services and what the Client will receive.]]')},
        {'id': 'deliverables', 'title': 'Deliverables and timeline', 'text': (
            '[[List the deliverables and the dates.]]')},
        {'id': 'changes', 'title': 'Revisions and changes', 'text': (
            'Work outside the scope above is extra work. Its price is agreed in writing before it starts.')},
    ],
}

TEMPLATES = {key: _SPECIFIC[key] + _SHARED for key in _SPECIFIC}


def template_sections(key):
    """A deep copy, so a caller can never change the library."""
    return copy.deepcopy(TEMPLATES[key])


def template_summaries():
    return [
        {'key': key, 'label': TEMPLATE_LABELS[key][0], 'description': TEMPLATE_LABELS[key][1],
         'section_titles': [s['title'] for s in TEMPLATES[key]]}
        for key in TEMPLATE_LABELS
    ]
