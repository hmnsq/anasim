// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// P11.9, T-56: the analogue mutation self-test (Test Plan 8). Planted defects, generated deterministically from
// the patches: every summing input's sign flipped (a summer sign), every weight and potentiometer setting scaled
// by 1.1 (a coefficient), every integrator's initial condition moved by a tenth of its bound (an initial
// condition). Each mutant must be caught by the oracle comparison of P11.3 (a simulation with the model check
// switched off, compared with the analytic, mpmath or reference-function oracle at the Test Plan bound); the
// static model check (SEMANTIC) is run too and reported as a second catcher.
//   node tests/p11_9_mutation.test.mjs [--quick]

import fs from 'node:fs';
import path from 'node:path';
import { harness } from './lib.mjs';
import { REPO, CORE, loadAll } from '../tools/load.mjs';
import { compilePatch, runIdeal, outputRows, evaluateStatic, setInputs } from '../docs/src/anasim.js';
import { analyticSolution, parseVectors } from '../docs/src/core.js';

const H = harness('P11.9_mutation');
const QUICK = process.argv.includes('--quick');

function mutants(patch, { stages = null } = {}) {
  const list = [];
  patch.elements.forEach((e, i) => {
    if (stages && !stages.some((s) => e.id.endsWith(`_${s}`))) return;
    (e.inputs || []).forEach((inp, k) => {
      if (e.kind !== 'integrator' && e.kind !== 'summer' && e.kind !== 'comparator') return;
      const w = inp.weight === undefined ? 1 : inp.weight;
      list.push({ kind: 'summer sign', where: `${e.id}.inputs[${k}]`, apply: (p) => { p.elements[i].inputs[k].weight = typeof w === 'number' ? -w : `-(${w})`; } });
      // a comparator compares integer sums with thresholds at +-1.5, so scaling its weights by 1.1 is an
      // equivalent mutant (no valid input can tell); its coefficient defect moves the threshold past an integer
      const f = e.kind === 'comparator' ? 1.7 : 1.1;
      list.push({ kind: 'coefficient', where: `${e.id}.inputs[${k}] x${f}`, apply: (p) => { p.elements[i].inputs[k].weight = typeof w === 'number' ? w * f : `${f}*(${w})`; } });
    });
    if (e.kind === 'inverter') list.push({ kind: 'summer sign', where: `${e.id} (inverter made a unit coefficient)`, apply: (p) => { p.elements[i].kind = 'coefficient'; p.elements[i].k = 1; } });
    if (e.kind === 'coefficient') list.push({ kind: 'coefficient', where: `${e.id}.k`, apply: (p) => { p.elements[i].k = `0.9*(${e.k})`; } });
    if (e.kind === 'integrator') list.push({ kind: 'initial condition', where: `${e.id}.ic`, apply: (p) => { p.elements[i].ic = `(${e.ic}) + ${0.1 * e.max}`; } });
  });
  return list;
}

const vec = (rel) => parseVectors(fs.readFileSync(path.join(CORE, 'vectors', rel), 'utf8'));
// oracle comparisons (P11.3 bounds); each returns { caught, measure }
const oracles = {
  analytic(c, model) {
    const a = analyticSolution(model);
    const o = outputRows(c, runIdeal(c, { events: false }));
    const amp = o.names.map(() => 0), err = o.names.map(() => 0);
    for (const r of o.rows) { const v = a.at(r[0]); o.names.forEach((n, j) => { const x = v[a.names.indexOf(n)]; amp[j] = Math.max(amp[j], Math.abs(x)); err[j] = Math.max(err[j], Math.abs(r[1 + j] - x)); }); }
    const m = Math.max(...err.map((e, j) => e / amp[j]));
    return { caught: !(m <= 1e-4), measure: `error over amplitude ${m.toExponential(2)} (bound 1e-4)` };
  },
  lorenz(c) {
    const v = vec('lorenz/lorenz.t5.vec');
    const o = outputRows(c, runIdeal(c, { t1: 5, events: false }));
    let e = 0;
    for (const cs of v.cases) { const r = o.rows[Math.round(cs[0] / c.h)]; o.names.forEach((n, j) => { e = Math.max(e, Math.abs(r[1 + j] - cs[v.fields.indexOf(n)])); }); }
    return { caught: !(e <= 1e-6), measure: `max abs error ${e.toExponential(2)} (bound 1e-6)` };
  },
  functions(c) {
    const v = vec('function-generation/function-generation.vec');
    const o = outputRows(c, runIdeal(c, { events: false }));
    let worst = 0;
    for (const n of ['f_sin', 'f_exp', 'f_square', 'f_tanh', 'f_abs']) {
      let e = 0, amp = 0;
      for (const cs of v.cases) { const r = o.rows[Math.round(cs[0] / c.h)]; e = Math.max(e, Math.abs(r[1 + o.names.indexOf(n)] - cs[v.fields.indexOf(n)])); amp = Math.max(amp, Math.abs(cs[v.fields.indexOf(n)])); }
      worst = Math.max(worst, e / amp);
    }
    return { caught: !(worst <= 1e-4), measure: `worst element-realised function error over amplitude ${worst.toExponential(2)} (bound 1e-4)` };
  },
};

const TARGETS = [
  ['exponential-decay', 'analytic'], ['harmonic-oscillator', 'analytic'], ['damped-driven-oscillator', 'analytic'],
  ['lorenz', 'lorenz'], ['function-generation', 'functions'],
];
const table = [];
let total = 0, caughtDyn = 0, caughtStatic = 0;
// a control: the unmutated patches pass both catchers (otherwise a catcher that always fires would look perfect)
for (const [id, kind] of TARGETS) {
  const { patch, model, substrate } = loadAll(`docs/programs/${id}.patch.yaml`);
  const r = oracles[kind](compilePatch(patch, model, substrate, { check: false }), model);
  let st = true; try { compilePatch(patch, model, substrate); } catch (e) { st = false; }
  H.check(`control: unmutated ${id} passes the oracle and the model check`, !r.caught && st, { summary: r.measure });
  for (const mu of mutants(patch)) {
    const p = JSON.parse(JSON.stringify(patch));
    mu.apply(p);
    let staticCaught = false, staticMsg = '';
    try { compilePatch(p, model, substrate); } catch (e) { staticCaught = true; staticMsg = `${e.code} at ${e.path}`; }
    let dyn;
    try { dyn = oracles[kind](compilePatch(p, model, substrate, { check: false }), model); } catch (e) { dyn = { caught: true, measure: `run refused: ${e.message}` }; }
    total++; caughtDyn += dyn.caught; caughtStatic += staticCaught;
    table.push({ patch: id, kind: mu.kind, where: mu.where, caught_by_oracle: dyn.caught, oracle: dyn.measure, caught_by_model_check: staticCaught, model_check: staticMsg });
    H.check(`${id} ${mu.kind} ${mu.where}`, dyn.caught, { summary: `${dyn.measure}; model check ${staticCaught ? 'refuses (' + staticMsg + ')' : 'passes'}` });
  }
}

// balanced ternary adder: mutants of stages 0, 1 and 15, against the reference vectors (levels must equal trits)
{
  const { patch, model, substrate } = loadAll('docs/programs/balanced-ternary-addition.patch.yaml');
  const v = parseVectors(fs.readFileSync(path.join(REPO, 'tests', 'vectors', 'balanced_ternary', 'add.16.vec'), 'utf8'));
  const n = 16;
  const dec = (w) => { const t = []; for (let i = 0; i < n; i++) { const c2 = Number((w >> BigInt(2 * i)) & 3n); if (c2 === 3) return null; t.push(c2 === 1 ? 1 : c2 === 2 ? -1 : 0); } return t; };
  const cases = v.cases.map(([a, b, r]) => [dec(a), dec(b), dec(r)]).filter(([a, b]) => a && b);
  const use = QUICK ? cases.slice(0, 600) : cases;
  const oracle = (p) => {
    const c = compilePatch(p, model, substrate);
    let bad = 0;
    for (const [a, b, r] of use) {
      const inputs = {};
      a.forEach((x, i) => { inputs[`a${i}`] = x; inputs[`b${i}`] = b[i]; });
      const res = evaluateStatic(setInputs(c, inputs));
      for (let i = 0; i < n; i++) if (Math.abs(res.outputs[`z${i}`] - r[i]) > 1e-9) { bad++; break; }
    }
    return { caught: bad > 0, measure: `${bad} of ${use.length} vectors wrong` };
  };
  const ctl = oracle(patch);
  H.check('control: unmutated balanced ternary adder passes', !ctl.caught, { summary: ctl.measure });
  for (const mu of mutants(patch, { stages: [0, 1, 15] })) {
    const p = JSON.parse(JSON.stringify(patch));
    mu.apply(p);
    const dyn = oracle(p);
    total++; caughtDyn += dyn.caught;
    table.push({ patch: 'balanced-ternary-addition', kind: mu.kind, where: mu.where, caught_by_oracle: dyn.caught, oracle: dyn.measure, caught_by_model_check: null, model_check: 'not applicable: a discrete model has no equations' });
    H.check(`balanced-ternary-addition ${mu.kind} ${mu.where}`, dyn.caught, { summary: dyn.measure });
  }
}

const kinds = [...new Set(table.map((t) => t.kind))];
H.check('all three defect kinds planted', ['summer sign', 'coefficient', 'initial condition'].every((k) => kinds.includes(k)), { summary: kinds.join(', ') });
H.extra.mutants = table;
H.extra.score = { planted: total, caught_by_oracle: caughtDyn, caught_by_model_check: caughtStatic };
console.log(`mutation score: ${caughtDyn}/${total} caught by the oracle comparison; ${caughtStatic} also refused by the static model check`);
H.finish();
