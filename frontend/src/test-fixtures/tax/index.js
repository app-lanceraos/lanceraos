// src/test-fixtures/tax/index.js
//
// Loads every tracked Tax fixture by name: OVERVIEWS.pseb is overview-pseb.sample.json, CALCULATOR["1500000"] is
// calculator-1500000.sample.json. Always read through clone() so one test can never change another's data.
// PAYMENT_COUNTS is the number of payments the generator created inside each overview file's tax year (counted from the
// database, not from the payload): the drift test compares it with paymentTotal(data).
const files = import.meta.glob('./*.sample.json', { eager: true, import: 'default' })

export const OVERVIEWS = {}
export const CALCULATOR = {}
for (const [path, body] of Object.entries(files)) {
  const name = path.replace('./', '').replace('.sample.json', '')
  if (name.startsWith('overview-')) OVERVIEWS[name.slice(9)] = body
  else if (name.startsWith('calculator-')) CALCULATOR[name.slice(11)] = body
}
export const LAW = files['./law.sample.json']
export const ERRORS = files['./errors.sample.json']
export const PAYMENT_COUNTS = {
  "pseb": 5,
  "pseb-2026": 5,
  "nopseb": 2,
  "marked": 2,
  "empty": 0,
  "local": 2,
  "unconverted": 2,
  "estimated": 1,
  "stale": 5,
  "no-ntn": 2
}
export const clone = (value) => JSON.parse(JSON.stringify(value))
