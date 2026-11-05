// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The cases of the Node.js and browser parity test (WEB-06, T-33 applied to the patches): fixed-step ideal runs
// of the continuous patches as trace texts (problem units, outputs; machine units, every element) and their
// overload event lists, and seeded non-ideal runs. The same function runs in Node.js and in the page
// tests/parity.html; readText(path) reads a repository-relative path.

import { loadYaml } from '../docs/src/core.js';
import { loadPatch } from '../docs/src/patch.js';
import { compilePatch, runIdeal, traceText } from '../docs/src/anasim.js';

const CORE = 'docs/vendor/subcore/0.1.0';
export const PATCHES = ['exponential-decay', 'harmonic-oscillator', 'harmonic-oscillator-overload', 'damped-driven-oscillator', 'lorenz', 'lorenz-overload', 'function-generation'];
export const REQUIRED = [];
for (const p of PATCHES) REQUIRED.push(`${p}.ideal.problem.csv`, `${p}.ideal.machine.csv`, `${p}.ideal.events.json`);

export async function runCases(readText, extra = null) {
  const substrate = loadYaml(await readText(`${CORE}/spec/substrates/analogue-electronic.yaml`));
  const out = {};
  for (const p of PATCHES) {
    const patch = loadPatch(await readText(`docs/programs/${p}.patch.yaml`));
    const model = loadYaml(await readText(`${CORE}/spec/models/${patch.patch.model.id}.yaml`));
    const c = compilePatch(patch, model, substrate);
    const t1 = model.identity.id === 'lorenz' ? 5 : undefined;
    const run = runIdeal(c, { t1 });
    out[`${p}.ideal.problem.csv`] = traceText(c, run, { units: 'problem' });
    out[`${p}.ideal.machine.csv`] = traceText(c, run, { units: 'machine', columns: 'all' });
    out[`${p}.ideal.events.json`] = JSON.stringify(run.events);
    if (extra) Object.assign(out, await extra(p, patch, model, substrate, c));
  }
  return out;
}
