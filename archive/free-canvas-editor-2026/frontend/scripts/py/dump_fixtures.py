#!/usr/bin/env python3
"""
Phase 2b — generates the adapter's round-trip test fixtures FROM the real
Python BUILTIN_DESIGNS (apps.invoices.design_templates), never hand-typed,
so a fixture can never silently drift from the actual production source
it's supposed to represent (the phase's own explicit requirement). Also
dumps get_blank_design_data('professional') as a 4th fixture, since it
exercises the "minimal, mostly-empty design" shape the 3 builtins don't
(empty header.elements).

Run from anywhere; writes into
frontend/src/pages/design-editor-v2/adapter/__fixtures__/, overwriting
whatever was there — these files are generated output, never hand-edited
(each one's own header records the exact command that produced it, so a
stale-looking diff is immediately traceable).

Merged into frontend/ from the standalone invoice-editor/ project (see
DECISIONS.md's merge entry) — OUT_DIR updated for the new nesting depth,
everything else unchanged.
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from apps.invoices.design_templates import BUILTIN_DESIGNS, get_blank_design_data  # noqa: E402

OUT_DIR = Path(__file__).resolve().parents[2] / 'src' / 'pages' / 'design-editor-v2' / 'adapter' / '__fixtures__'


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = []

    for name, design_data in BUILTIN_DESIGNS.items():
        path = OUT_DIR / f'{name}.json'
        path.write_text(json.dumps(design_data, indent=2, sort_keys=False) + '\n')
        written.append(path)

    blank = get_blank_design_data('professional')
    path = OUT_DIR / 'blank.json'
    path.write_text(json.dumps(blank, indent=2, sort_keys=False) + '\n')
    written.append(path)

    for path in written:
        print(f'wrote {path.relative_to(REPO_ROOT)}')


if __name__ == '__main__':
    main()
