// Phase 2b — calls the REAL backend validator (apps.invoices.design_schema.
// validate_design_data_schema_by_version) as a subprocess, rather than
// reimplementing it in JS (explicit phase instruction). Test-only: never
// imported by the actual editor app.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'py', 'validate_design_data.py');

export function validateDesignDataAgainstPython(designData) {
  const result = spawnSync('python3', [SCRIPT], {
    input: JSON.stringify(designData),
    encoding: 'utf-8',
  });
  if (result.status !== 0 && !result.stdout) {
    throw new Error(`validate_design_data.py failed: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  return parsed.errors;
}
