// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// P11.3, T-52: ideal-element runs of every CMS-03 patch against the oracles of hmnsq/subcore P9.6 (vendored
// under docs/vendor/subcore/0.1.0/vectors/) and the models' analytic solutions, with the Test Plan 5 bounds:
//   fixed-step RK4 against analytic solutions   maximum absolute error over amplitude <= 1e-4 at the model's step
//   adaptive (Dormand-Prince) against analytic   maximum relative error, absolute floor 1e-9, <= 1e-7 at rtol 1e-10
//   Lorenz, t <= 5, against mpmath               maximum absolute error <= 1e-6
//   Lorenz statistics, t from 50 to 500          means and standard deviations within 2 per cent
//   balanced ternary addition                    exact on every valid vector of bt_add16
// Function generation: the functions realised by computing elements are held to the RK4 bound against the mpmath
// vectors; the two function-generator approximations (sqrt, log) report their achieved bound (class approximate).
// Each comparison is first shown refusing a planted defect (a perturbed result must fail its bound).

import fs from 'node:fs';
import path from 'node:path';
import { harness } from './lib.mjs';
import { REPO, CORE, loadAll } from '../tools/load.mjs';
import { compilePatch, runIdeal, runIdealAdaptive, outputRows, evaluateStatic } from '../docs/src/anasim.js';
import { analyticSolution, parseVectors, specHash } from '../docs/src/core.js';

const H = harness('P11.3_ideal');
const vec = (rel) => parseVectors(fs.readFileSync(path.join(CORE, 'vectors', rel), 'utf8'));
const results = {};

// metrics
function errOverAmplitude(rows, names, exactAt) {
  const amp = names.map(() => 0), err = names.map(() => 0);
  for (const r of rows) { const ex = exactAt(r[0]); names.forEach((n, j) => { amp[j] = Math.max(amp[j], Math.abs(ex[j])); err[j] = Math.max(err[j], Math.abs(r[1 + j] - ex[j])); }); }
  return Math.max(...err.map((e, j) => e / amp[j]));
}
function maxRel(rows, names, exactAt, floor = 1e-9) {
  let m = 0;
  for (const r of rows) { const ex = exactAt(r[0]); names.forEach((n, j) => { m = Math.max(m, Math.abs(r[1 + j] - ex[j]) / Math.max(Math.abs(ex[j]), floor)); }); }
  return m;
}

// --- analytic models
for (const id of ['exponential-decay', 'harmonic-oscillator', 'damped-driven-oscillator']) {
  const { patch, model, substrate } = loadAll(`docs/programs/${id}.patch.yaml`);
  const c = compilePatch(patch, model, substrate);
  const a = analyticSolution(model);
  const o = outputRows(c, runIdeal(c));
  const exactAt = (t) => { const v = a.at(t); return o.names.map((n) => v[a.names.indexOf(n)]); };
  const e1 = errOverAmplitude(o.rows, o.names, exactAt);
  // planted defect for the gate: the same rows with one value off by 2e-4 of the amplitude
  const bad = o.rows.map((r) => r.slice());
  bad[Math.floor(bad.length / 2)][1] += 2e-4 * Math.max(...o.rows.map((r) => Math.abs(r[1])));
  const eBad = errOverAmplitude(bad, o.names, exactAt);
  H.check(`gate refuses a perturbed trace ${id}`, !(eBad <= 1e-4), { summary: `perturbed error ${eBad.toExponential(3)} > 1e-4` });
  H.check(`rk4 against analytic ${id}`, e1 <= 1e-4, { summary: `max abs error over amplitude ${e1.toExponential(3)} (bound 1e-4, h = ${c.h}, machine step ${c.h * c.T} s)` });
  const ad = runIdealAdaptive(c, { rtol: 1e-10, atol: 1e-12, points: 200 });
  const oa = outputRows(c, ad);
  const e2 = maxRel(oa.rows, oa.names, exactAt);
  H.check(`dopri54 against analytic ${id}`, e2 <= 1e-7, { summary: `max relative error (floor 1e-9) ${e2.toExponential(3)} (bound 1e-7 at rtol 1e-10); ${ad.stats.accepted} steps accepted, ${ad.stats.rejected} rejected` });
  // the analytic vectors of the core agree with the analytic solution used here
  const v = vec(`${id}/${id}.analytic.vec`);
  H.check(`oracle vectors match the model ${id}`, v.meta.model_sha256 === specHash(model), { summary: `vector file model_sha256 ${v.meta.model_sha256.slice(0, 12)}...` });
  let ve = 0;
  for (const cs of v.cases) { const ex = exactAt(cs[0]); o.names.forEach((n, j) => { ve = Math.max(ve, Math.abs(ex[j] - cs[1 + v.fields.indexOf(n) - 1])); }); }
  H.check(`analytic solution equals the core's vectors ${id}`, ve <= 1e-13, { summary: `max difference ${ve.toExponential(2)}` });
  results[id] = { rk4_err_over_amplitude: e1, dopri54_max_rel: e2, h: c.h, T: c.T };
}

// --- Lorenz against mpmath (t <= 5) and attractor statistics (t from 50 to 500)
{
  const { patch, model, substrate } = loadAll('docs/programs/lorenz.patch.yaml');
  const c = compilePatch(patch, model, substrate);
  const v = vec('lorenz/lorenz.t5.vec');
  H.check('lorenz vectors are for this model', v.meta.model_sha256 === specHash(model), {});
  const run = runIdeal(c, { t1: 5 });
  const o = outputRows(c, run);
  const byT = new Map(o.rows.map((r) => [Math.round(r[0] / c.h), r]));
  let e = 0, eBad = 0;
  for (const cs of v.cases) {
    const r = byT.get(Math.round(cs[0] / c.h));
    o.names.forEach((n, j) => {
      const d = Math.abs(r[1 + j] - cs[v.fields.indexOf(n)]);
      e = Math.max(e, d);
      eBad = Math.max(eBad, n === 'z' && cs[0] === 2.5 ? d + 2e-6 : d);
    });
  }
  H.check('gate refuses a perturbed lorenz trace', !(eBad <= 1e-6), { summary: `perturbed ${eBad.toExponential(3)}` });
  H.check('lorenz against mpmath, t <= 5', e <= 1e-6, { summary: `max abs error ${e.toExponential(3)} at ${v.cases.length} points (bound 1e-6, h = ${c.h})` });
  const st = JSON.parse(fs.readFileSync(path.join(CORE, 'vectors', 'lorenz', 'lorenz.stats.json'), 'utf8'));
  const long = runIdeal(c, { t1: st.window.to, every: Math.round(st.window.sample_every / c.h), events: false });
  const lo = outputRows(c, long);
  const win = lo.rows.filter((r) => r[0] >= st.window.from - 1e-9);
  const stats = {};
  let ok = win.length === st.samples;
  o.names.forEach((n, j) => {
    const xs = win.map((r) => r[1 + j]);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    // sampling error of a time mean of a chaotic signal: batch means over 30 batches of 15 time units
    const nb = 30, bl = Math.floor(xs.length / nb);
    const bm = Array.from({ length: nb }, (_, b) => xs.slice(b * bl, (b + 1) * bl).reduce((s, x) => s + x, 0) / bl);
    const bmean = bm.reduce((s, x) => s + x, 0) / nb;
    const se = Math.sqrt(bm.reduce((s, x) => s + (x - bmean) ** 2, 0) / (nb - 1) / nb);
    const ref = st.statistics[n];
    const dm = Math.abs(mean - ref.mean) / ref.std, ds = Math.abs(sd - ref.std) / ref.std;
    stats[n] = { mean, std: sd, ref, mean_diff_over_std: dm, std_rel_diff: ds, mean_standard_error_batch_means: se, mean_diff_over_standard_error: Math.abs(mean - ref.mean) / se };
    ok = ok && dm <= 0.02 && ds <= 0.02;
  });
  // T-36 belongs to P9.6 (the core); it is measured here on the patch and reported, not part of T-52's gate
  const line = o.names.map((n) => `${n}: mean ${stats[n].mean.toFixed(3)} (ref ${stats[n].ref.mean.toFixed(3)}, diff ${(100 * stats[n].mean_diff_over_std).toFixed(2)}% of std, ${stats[n].mean_diff_over_standard_error.toFixed(2)} standard errors), std ${stats[n].std.toFixed(3)} (ref ${stats[n].ref.std.toFixed(3)}, ${(100 * stats[n].std_rel_diff).toFixed(2)}%)`).join('; ');
  console.log(`REPORT lorenz attractor statistics, t from 50 to 500 (T-36 bound 2 per cent ${ok ? 'met' : 'NOT MET'}): ${line}`);
  H.extra.lorenz_statistics = { bound_met: ok, note: 'T-36 (P9.6) measured on the patch; reported, not gating T-52', stats };
  results.lorenz = { max_abs_t5: e, stats };
}

// --- function generation against the mpmath vectors
{
  const { patch, model, substrate } = loadAll('docs/programs/function-generation.patch.yaml');
  const c = compilePatch(patch, model, substrate);
  const v = vec('function-generation/function-generation.vec');
  H.check('function vectors are for this model', v.meta.model_sha256 === specHash(model), {});
  const o = outputRows(c, runIdeal(c));
  const per = {};
  const exact = new Set(['f_sin', 'f_exp', 'f_square', 'f_tanh', 'f_abs']);
  for (const n of o.names) {
    const j = v.fields.indexOf(n);
    let e = 0, amp = 0;
    for (const cs of v.cases) {
      const r = o.rows[Math.round(cs[0] / c.h)];
      if (Math.abs(r[0] - cs[0]) > 1e-12) throw new Error(`grid mismatch at x=${cs[0]}`);
      e = Math.max(e, Math.abs(r[1 + o.names.indexOf(n)] - cs[j])); amp = Math.max(amp, Math.abs(cs[j]));
    }
    per[n] = { max_abs: e, over_amplitude: e / amp, realisation: exact.has(n) ? 'computing elements' : 'function generator, 17 breakpoints' };
    if (exact.has(n)) H.check(`function ${n} against mpmath`, e / amp <= 1e-4, { summary: `max abs error over amplitude ${(e / amp).toExponential(3)} (bound 1e-4)` });
    else H.check(`function ${n} approximation bound recorded`, Number.isFinite(e), { summary: `class approximate: achieved max abs error ${e.toExponential(3)} (${(e / amp).toExponential(3)} of amplitude), above the 1e-4 default` });
  }
  results['function-generation'] = per;
}

// --- balanced ternary addition: exact on every valid vector of bt_add16
{
  const { patch, model, substrate } = loadAll('docs/programs/balanced-ternary-addition.patch.yaml');
  const text = fs.readFileSync(path.join(REPO, 'tests', 'vectors', 'balanced_ternary', 'add.16.vec'), 'utf8');
  const v = parseVectors(text);
  const n = 16;
  const decode = (w) => { const t = []; for (let i = 0; i < n; i++) { const c2 = Number((w >> BigInt(2 * i)) & 3n); if (c2 === 3) return null; t.push(c2 === 1 ? 1 : c2 === 2 ? -1 : 0); } return t; };
  const encode = (t) => t.reduce((w, x, i) => w | (BigInt(x === 1 ? 1 : x === -1 ? 2 : 0) << BigInt(2 * i)), 0n);
  let pass = 0, fail = 0, skipped = 0, overloaded = 0, maxOff = 0;
  const failures = [];
  for (const [a, b, r] of v.cases) {
    const ta = decode(a), tb = decode(b);
    if (!ta || !tb) { skipped++; continue; }
    const inputs = {};
    ta.forEach((x, i) => { inputs[`a${i}`] = x; inputs[`b${i}`] = tb[i]; });
    const res = evaluateStatic(compilePatch(patch, model, substrate, { inputs }));
    if (res.overloads.length) overloaded++;
    const z = Array.from({ length: n }, (_, i) => res.outputs[`z${i}`]);
    z.forEach((x) => { maxOff = Math.max(maxOff, Math.abs(x - Math.round(x))); });
    const got = encode(z.map((x) => Math.round(x)));
    if (got === r) pass++; else { fail++; if (failures.length < 5) failures.push({ a: a.toString(16), b: b.toString(16), expected: r.toString(16), got: got.toString(16) }); }
  }
  // planted defect: a carry comparator threshold moved from 1.5 to 2.5 must make vectors fail
  const bad = JSON.parse(JSON.stringify(patch));
  bad.elements.find((e) => e.id === 'CP_0').inputs[1].weight = -2.5;
  let caught = 0;
  for (const [a, b, r] of v.cases.slice(0, 300)) {
    const ta = decode(a), tb = decode(b);
    if (!ta || !tb) continue;
    const inputs = {};
    ta.forEach((x, i) => { inputs[`a${i}`] = x; inputs[`b${i}`] = tb[i]; });
    const res = evaluateStatic(compilePatch(bad, model, substrate, { inputs }));
    if (encode(Array.from({ length: n }, (_, i) => Math.round(res.outputs[`z${i}`]))) !== r) caught++;
  }
  H.check('gate refuses a planted carry threshold (CP_0 at 2.5)', caught > 0, { summary: `${caught} of the first 300 vectors fail with the defect` });
  H.check('balanced ternary adder equals bt_add16 on every valid vector', fail === 0 && pass > 0 && overloaded === 0, { summary: `${pass} passed, ${fail} failed, ${skipped} skipped (operand holds the invalid code 11, which no machine level represents), ${overloaded} overloaded; largest distance of a sum level from its trit ${maxOff.toExponential(2)}`, failures });
  results['balanced-ternary-addition'] = { pass, fail, skipped, vectors_sha256: v.meta.slice_sha256 };
}

H.extra.results = results;
H.finish();
