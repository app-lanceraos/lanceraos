#!/usr/bin/env python3
"""
Phase 2b — the real backend validator, wired into the JS test suite as a
subprocess bridge rather than reimplemented in JS (the phase's own
explicit instruction: "wire the real validator into the test path — don't
reimplement it in JS"). Reads one JSON design_data payload from stdin,
calls the actual production validator (apps.invoices.design_schema,
confirmed importable standalone with zero Django app registry/settings
required — validate_design_data_schema_by_version and everything it
transitively imports is pure Python), and writes {"errors": [...]} to
stdout (empty list means valid). Never raises past this boundary — any
exception is caught and reported as a single error string, so a malformed
JS-side payload always produces a real JSON test failure rather than a
crashed subprocess with an opaque non-zero exit code.
"""
import json
import sys
from pathlib import Path

# frontend/scripts/py/ -> frontend/scripts/ -> frontend/ -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from apps.invoices.design_schema import validate_design_data_schema_by_version  # noqa: E402


def main():
    raw = sys.stdin.read()
    try:
        design_data = json.loads(raw)
        errors = validate_design_data_schema_by_version(design_data)
    except Exception as exc:  # noqa: BLE001 - deliberate, see module docstring
        errors = [f'{type(exc).__name__}: {exc}']
    json.dump({'errors': errors}, sys.stdout)


if __name__ == '__main__':
    main()
