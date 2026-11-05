#!/usr/bin/env python3
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
"""JSON Schema 2020-12 validation of patches (P11.1) with the Python jsonschema package.

    python3 tools/validate_patches.py [--json out.json] <patch.yaml> ...

Prints one line per file: valid, or each error with its path. Exit 0 when every file named is valid.
The graph checks (an algebraic loop, an input naming no element) are made by docs/src/patch.js; this tool states
what the schema alone refuses, so the record shows both layers.
"""
import json
import sys
from pathlib import Path

import jsonschema
import yaml

REPO = Path(__file__).resolve().parent.parent


def main(argv):
    out = None
    if argv[:1] == ["--json"]:
        out, argv = argv[1], argv[2:]
    schema = json.loads((REPO / "spec" / "patch.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    v = jsonschema.Draft202012Validator(schema)
    results, bad = {}, 0
    for f in argv:
        doc = yaml.safe_load(Path(f).read_text(encoding="utf-8"))
        errs = sorted(v.iter_errors(doc), key=lambda e: list(e.absolute_path))
        results[f] = ["/".join(str(p) for p in e.absolute_path) + ": " + e.message for e in errs]
        if errs:
            bad += 1
            for e in results[f]:
                print(f"{f}: {e}")
        else:
            print(f"{f}: valid")
    if out:
        Path(out).write_text(json.dumps({"jsonschema": jsonschema.__version__ if hasattr(jsonschema, "__version__") else "unknown",
                                         "results": results}, indent=1) + "\n", encoding="utf-8")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
