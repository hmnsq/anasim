// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// A small harness for the acceptance tests: named checks, a verbose log, and a results file that
// tools/record.mjs attaches to the run record (--results). A test exits 0 only when every check passed.

import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../tools/load.mjs';

export function harness(name) {
  const checks = [];
  const extra = {};
  const t0 = Date.now();
  const log = (...a) => console.log(`[${name}]`, ...a);
  return {
    log,
    extra,
    check(id, ok, detail = {}) {
      checks.push({ id, ok: !!ok, ...detail });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail.summary ? ': ' + detail.summary : ''}`);
      return !!ok;
    },
    finish() {
      const failed = checks.filter((c) => !c.ok);
      const out = { test: name, passed: checks.length - failed.length, failed: failed.length, checks, ...extra, seconds: (Date.now() - t0) / 1000 };
      const dir = path.join(REPO, 'reports', 'results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(out, null, 1) + '\n');
      console.log(`[${name}] ${out.passed} passed, ${out.failed} failed; results reports/results/${name}.json`);
      process.exitCode = failed.length ? 1 : 0;
      return out;
    },
  };
}
