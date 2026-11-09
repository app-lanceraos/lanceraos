// src/test-fixtures/health/index.js
//
// Loads every tracked Health Score fixture by name for the tests: SCORES['rich'] is score-rich.sample.json, MINIS['rich']
// is mini-rich.sample.json. Always read through clone() so one test can never change another's data.
const files = import.meta.glob('./*.sample.json', { eager: true, import: 'default' })

export const SCORES = {}
export const MINIS = {}
for (const [path, body] of Object.entries(files)) {
  const name = path.replace('./', '').replace('.sample.json', '')
  if (name.startsWith('score-')) SCORES[name.slice(6)] = body
  else if (name.startsWith('mini-')) MINIS[name.slice(5)] = body
}
export const ERRORS = files['./errors.sample.json']
export const clone = (value) => JSON.parse(JSON.stringify(value))
