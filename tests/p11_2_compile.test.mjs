// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// P11.2, T-51: the patch compiler records every scale factor (written to reports/scaling/<patch>.json and
// checked by undoing it: machine value times M gives the problem value, machine time over T the problem time),
// the ODE is assembled in dependency order, and predicted overloads equal simulated ones (same elements, same
// number of onsets, each onset within 1 per cent of the horizon, Test Plan 5). The overload gate is first shown
// refusing a planted defect: a prediction made with a wrong bound must not match the simulation.

import fs from 'node:fs';
import path from 'node:path';
import { harness } from './lib.mjs';
import { REPO, PATCHES, loadAll } from '../tools/load.mjs';
import { compilePatch, runIdeal } from '../docs/src/anasim.js';
import { predictOverloads, compareOverloads } from '../docs/src/compile/predict.js';
import { scalePatch } from '../docs/src/compile/scale.js';
import { canonicalJson } from '../docs/src/core.js';

const H = harness('P11.2_compile');
const outDir = path.join(REPO, 'reports', 'scaling');
fs.mkdirSync(outDir, { recursive: true });
const NOTICE = '© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC0-1.0';
const simOnsets = (run) => run.events.filter((e) => e.name === 'overload').map((e) => ({ element: e.element, t: e.tProblem }));

// 1. The gate refuses planted defects: predictions made with a wrong bound (no overloads predicted) or a wrong
//    frequency (onsets drift away) must not match the simulation of the overloaded oscillator
{
  const { patch, model, substrate } = loadAll('docs/programs/harmonic-oscillator-overload.patch.yaml');
  const c = compilePatch(patch, model, substrate);
  const run = runIdeal(c);
  const wrong = JSON.parse(JSON.stringify(patch));
  wrong.elements.find((e) => e.id === 'I_v').max = 2.2;
  const ws = scalePatch(wrong, model, substrate);
  const p1 = predictOverloads(wrong, model, ws, { t1: c.t1, h: c.h });
  const c1 = compareOverloads(p1.onsets, simOnsets(run), c.t1);
  H.check('gate refuses a prediction with a wrong bound (planted: I_v max 1.6 -> 2.2)', !c1.agree, { summary: c1.problems.slice(0, 2).join('; ') || 'NOT REFUSED' });
  const wm = JSON.parse(JSON.stringify(model));
  wm.parameters.find((q) => q.name === 'omega').value = 2.1;
  const ws2 = scalePatch(patch, wm, substrate);
  const p2 = predictOverloads(patch, wm, ws2, { t1: c.t1, h: c.h });
  const c2 = compareOverloads(p2.onsets, simOnsets(run), c.t1);
  H.check('gate refuses a prediction with a wrong frequency (planted: omega 2 -> 2.1)', !c2.agree, { summary: c2.problems.slice(0, 2).join('; ') || 'NOT REFUSED' });
}

// 2. Dependency order: the algebraic elements are evaluated in dependency order whatever order the patch lists
//    them in, so the Lorenz patch with its element list reversed gives the same run, value for value
{
  const { patch, model, substrate } = loadAll('docs/programs/lorenz.patch.yaml');
  const rev = JSON.parse(JSON.stringify(patch));
  rev.elements.reverse();
  const a = runIdeal(compilePatch(patch, model, substrate), { every: 100 });
  const b = runIdeal(compilePatch(rev, model, substrate), { every: 100 });
  const col = (r, id) => r.values.map((v) => v[r.columns.indexOf(id)]);
  const same = patch.elements.every((e) => canonicalJson(col(a, e.id)) === canonicalJson(col(b, e.id)));
  H.check('evaluation in dependency order: reversed element list gives an identical run (lorenz)', same, { summary: `${a.values.length} rows x ${patch.elements.length} elements compared` });
}

const summary = {};
for (const f of PATCHES()) {
  const { patch, model, substrate } = loadAll(f);
  const id = patch.patch.id;
  if (model.kind === 'discrete') {
    // a static network: no time, so overloads are checked at each vector case in the P11.3 test; here the
    // factors are recorded for the default inputs
    const s = scalePatch(patch, model, substrate);
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ _notice: NOTICE, patch: `${id} ${patch.patch.version}`, factors: s.factors }, null, 1) + '\n');
    H.check(`factors recorded ${id}`, s.factors.magnitude.length === patch.elements.length, { summary: `${patch.elements.length} elements, T = ${s.T}` });
    continue;
  }
  const c = compilePatch(patch, model, substrate);
  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ _notice: NOTICE, patch: `${id} ${patch.patch.version}`, model: `${model.identity.id} ${model.identity.version}`, factors: c.scaled.factors, model_check: c.modelCheck }, null, 1) + '\n');
  // undoing the factors: every element's machine value times M equals the problem value in the run
  const run = runIdeal(c, { every: 10 });
  let undo = 0;
  run.machine.rows.forEach((r, k) => r.forEach((x, i) => { undo = Math.max(undo, Math.abs(x * c.scaled.machine[i].M - run.values[k][i])); }));
  const tUndo = Math.max(...run.machine.t.map((tau, k) => Math.abs(tau / c.T - run.t[k])));
  const recorded = c.scaled.factors.magnitude.every((m) => m.M > 0 && m.from) && c.scaled.factors.time_scale.T === c.T;
  H.check(`factors recorded and undone ${id}`, recorded && undo === 0 && tUndo === 0, { summary: `T = ${c.T} (${c.scaled.factors.time_scale.choice}); fastest machine gain ${c.scaled.factors.time_scale.fastest_machine_gain.toFixed(3)} s-1 <= ${c.scaled.factors.time_scale.gain_limit.toFixed(1)}` });
  H.check(`fastest gain inside the bandwidth limit ${id}`, c.scaled.factors.time_scale.fastest_machine_gain <= c.scaled.factors.time_scale.gain_limit, {});
  // predicted against simulated overloads
  const full = runIdeal(c, { every: 1000000 });
  const pred = predictOverloads(patch, model, c.scaled, { t1: c.t1, h: c.h });
  const sim = simOnsets(full);
  const cmp = compareOverloads(pred.onsets, sim, c.t1);
  summary[id] = { predicted: pred.onsets.length, simulated: sim.length, agree: cmp.agree, max_difference_over_horizon: cmp.maxDiffOverHorizon, onsets: sim.slice(0, 40) };
  H.check(`predicted overloads equal simulated ${id}`, cmp.agree, { summary: `${pred.onsets.length} predicted, ${sim.length} simulated, largest onset difference ${cmp.maxDiffOverHorizon.toExponential(2)} of the horizon (bound 1e-2)${cmp.problems.length ? '; ' + cmp.problems.slice(0, 3).join('; ') : ''}` });
}
const withOverloads = Object.values(summary).filter((s) => s.simulated > 0).length;
H.check('at least two patches exercise overloads', withOverloads >= 2, { summary: `${withOverloads} patch(es) overload` });
H.extra.overloads = summary;
H.finish();
