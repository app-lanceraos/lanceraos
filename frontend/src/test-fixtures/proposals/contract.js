// src/test-fixtures/proposals/contract.js
//
// Facts about the Proposals backend that the frontend tests pin themselves to,
// generated 3 Nov 2026 by calling the REAL endpoints (not hand-written
// guesses). Tracked on purpose: the *.test.* files are gitignored, these
// tables are the part worth keeping.

// Real HTTP status of each authenticated action, per proposal status. The UI
// offers an action only if the backend answers 2xx.
export const LIFECYCLE = {
  draft:     { send: 200, withdraw: 409, duplicate: 201, convert: 409, delete: 204 },
  sent:      { send: 409, withdraw: 200, duplicate: 201, convert: 409, delete: 403 },
  viewed:    { send: 409, withdraw: 200, duplicate: 201, convert: 409, delete: 403 },
  accepted:  { send: 409, withdraw: 409, duplicate: 201, convert: 201, delete: 403 },
  declined:  { send: 409, withdraw: 409, duplicate: 201, convert: 409, delete: 403 },
  withdrawn: { send: 409, withdraw: 409, duplicate: 201, convert: 409, delete: 403 },
}
// 'sent' and 'viewed' past valid_until (is_expired: true): withdraw is still 200.

// What the public page's GET answers per proposal status, and what
// POST .../respond/ (accept) answers.
export const PUBLIC = {
  draft:            { get: 404, respond: [404, null] },
  sent:             { get: 200, state: 'open',     can_respond: true,  respond: [200, null] },
  viewed:           { get: 200, state: 'open',     can_respond: true,  respond: [200, null] },
  accepted:         { get: 200, state: 'accepted', can_respond: false, respond: [409, 'already_answered'] },
  declined:         { get: 200, state: 'declined', can_respond: false, respond: [409, 'already_answered'] },
  withdrawn:        { get: 200, state: 'withdrawn',                    respond: [409, 'withdrawn'] },
  'sent+expired':   { get: 200, state: 'expired',  can_respond: false, respond: [409, 'expired'] },
  'viewed+expired': { get: 200, state: 'expired',  can_respond: false, respond: [409, 'expired'] },
}
// Owner opening their own link: GET 200 { preview: true, can_respond: false } and nothing changes;
// respond -> 403 reason "owner". Unknown/over-long token: 404 { error: 'Not found.' }.
// Message of 1000 characters -> 200; 1001 -> 400 flat error "Ensure this field has no more than 1000 characters.".

export const PUBLIC_KEYS = [
  'body', 'can_respond', 'client_name', 'currency', 'discount_amount', 'items', 'payment_terms', 'preview',
  'proposal_number', 'responded_at', 'response_message', 'scope_sections', 'sender', 'state', 'subtotal',
  'tax_amount', 'tax_rate', 'title', 'total', 'valid_until',
] // exactly 20; a withdrawn proposal returns only ['sender', 'state', 'title']

export const SAMPLE_PUBLIC = {
  state: 'open', can_respond: true, preview: false, proposal_number: 'PRO-2026-0001', title: 'Website redesign',
  client_name: 'Sam Client', body: 'Hello Sam,\n\nHere is my plan.', scope_sections: [{ title: 'Scope', text: 'Five pages.' }],
  items: [{ description: 'Design', quantity: '2.00', unit_price: '50.00', total: '100.00' }], currency: 'USD',
  subtotal: '100.00', tax_rate: '0.00', tax_amount: '0.00', discount_amount: '0.00', total: '100.00',
  payment_terms: 'Net 7', valid_until: '2026-12-31', responded_at: null, response_message: '',
  sender: { name: 'Ali Studio', logo_url: '' },
}

// A freelancer-side detail (ProposalDetailSerializer's shape) for tests.
export const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const INVOICE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

export function makeDetail(overrides = {}) {
  return {
    id: ID, proposal_number: null, client: null, client_name: 'Acme Ltd', client_email: 'hi@acme.test', client_company: '',
    title: 'React dashboard', tone: 'professional', job_description: 'J'.repeat(80), my_experience: '',
    body: 'Hello client. I can help.', ai_tips: ['Ask about the data source.'],
    ai_generated: true, ai_generated_at: '2026-11-03T09:00:00', ai_model: 'openai/gpt-oss-120b', currency: 'USD',
    scope_sections: [], payment_terms: '', tax_rate: '0.00', discount_amount: '0.00', subtotal: '100.00',
    tax_amount: '0.00', total: '100.00', valid_until: '2026-12-31', status: 'draft', is_editable: true, is_expired: false,
    items: [{ id: 'i1', description: 'Design', quantity: '2.00', unit_price: '50.00', total: '100.00' }],
    word_count: 5,
    quality: { score: 6, max: 10, earned: 6, possible: 10, explanation: 'Seven simple checks.', checks: [] },
    sent_via: '', sent_at: null, viewed_at: null, responded_at: null, withdrawn_at: null, response_message: '',
    converted_invoice: null, public_url: null,
    created_at: '2026-11-03T09:00:00', updated_at: '2026-11-03T09:30:00.123456', ...overrides,
  }
}

// A proposal in a given non-draft status, shaped as the server returns it.
export function makeSentDetail(status = 'sent', overrides = {}) {
  const base = {
    status, is_editable: false, proposal_number: 'PRO-2026-0007', sent_via: 'email', sent_at: '2026-11-03T10:00:00',
    public_url: 'https://app.example.test/proposal/tok123',
  }
  if (status === 'viewed' || status === 'accepted' || status === 'declined') base.viewed_at = '2026-11-03T11:00:00'
  if (status === 'accepted' || status === 'declined') {
    base.responded_at = '2026-11-03T12:00:00'
    base.response_message = 'Looks good.'
  }
  if (status === 'withdrawn') base.withdrawn_at = '2026-11-03T13:00:00'
  return makeDetail({ ...base, ...overrides })
}
