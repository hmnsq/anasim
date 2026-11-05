// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Writes the two patches that are generated rather than written by hand (deterministic; no timestamps):
//   docs/programs/function-generation.patch.yaml   the seven functions of the function-generation model
//   docs/programs/balanced-ternary-addition.patch.yaml   a 16-trit ripple adder of summers and comparators
//   node tools/gen_patches.mjs [--check]
// --check regenerates in memory and fails if a file on disk differs.
//
// Function generation. The ramp x = t is an integrator of the reference. Four functions are realised exactly by
// computing elements, as an analogue programmer would: sin(pi x) by a two-integrator loop, exp(-x) by an
// integrator fed back on itself, x^2 by a multiplier, tanh(4x - 2) by integrating y' = 4 (1 - y^2) with a
// multiplier; |2x - 1| by a function generator whose three breakpoints make it exact. sqrt(x) and log(1 + x) have
// no such realisation with these elements and use function generators through breakpoints, so they are
// approximations whose bound is measured and reported (MRD 9.12, class approximate).
//
// Balanced ternary addition. Trits are machine levels of one problem unit. Stage i sums a_i + b_i + k_(i-1) in a
// summer S_i (output -(a + b + k)), two comparators give the carry k_i = [a + b + k > 1.5] - [a + b + k < -1.5],
// and a summer Z_i gives the sum trit a + b + k - 3 k_i. The last carry is dropped, so the word wraps modulo
// 3^16 as the reference function bt_add16 does.

import fs from 'node:fs';
import path from 'node:path';
import { REPO, loadModel } from './load.mjs';
import { compileFunctions, specHash } from '../docs/src/core.js';

const GEN = 'tools/gen_patches.mjs 0.1.0';
const NOTICE = '_notice: "© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC0-1.0"';
const num = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const flow = (o) => '{' + Object.entries(o).map(([k, v]) => `${k}: ${Array.isArray(v) ? '[' + v.map((x) => (typeof x === 'object' && !Array.isArray(x) ? flow(x) : Array.isArray(x) ? `[${x.map(num).join(', ')}]` : typeof x === 'number' ? num(x) : x)).join(', ') + ']' : typeof v === 'object' ? flow(v) : typeof v === 'number' ? num(v) : /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? v : JSON.stringify(v)}`).join(', ') + '}';

function functionPatch() {
  const model = loadModel('function-generation');
  const F = compileFunctions(model);
  const at = (name, x) => F.at(x)[F.names.indexOf(name)];
  const n = 16;
  const sqrtXs = Array.from({ length: n + 1 }, (_, k) => (k / n) ** 2);
  const logXs = Array.from({ length: n + 1 }, (_, k) => k / n);
  const bp = (name, xs) => xs.map((x) => [x, at(name, x)]);
  const els = [
    { id: 'K_m1', kind: 'constant', represents: '-1', value: -1, label: 'reference -1', position: [0, 0] },
    { id: 'I_x', kind: 'integrator', represents: 'x', max: 1.25, ic: 0, inputs: [{ from: 'K_m1', weight: 1 }], label: 'ramp x = t', position: [1, 0] },
    { id: 'I_S', kind: 'integrator', represents: 'sin(pi*x)', max: 1.25, ic: 0, inputs: [{ from: 'N_C', weight: 'pi' }], position: [1, 1] },
    { id: 'I_C', kind: 'integrator', represents: 'cos(pi*x)', max: 1.25, ic: 1, inputs: [{ from: 'I_S', weight: 'pi' }], position: [2, 1] },
    { id: 'N_C', kind: 'inverter', represents: '-cos(pi*x)', inputs: [{ from: 'I_C' }], position: [3, 1] },
    { id: 'I_E', kind: 'integrator', represents: 'exp(-x)', max: 1.25, ic: 1, inputs: [{ from: 'I_E', weight: 1 }], position: [1, 2] },
    { id: 'P_sq', kind: 'multiplier', represents: 'x^2', max: 1.25, inputs: [{ from: 'I_x' }, { from: 'I_x' }], position: [2, 0] },
    { id: 'I_T', kind: 'integrator', represents: 'tanh(4*x - 2)', max: 1.25, ic: 'tanh(0 - 2)', inputs: [{ from: 'K_m1', weight: 4 }, { from: 'P_TT', weight: 4 }], position: [1, 3] },
    { id: 'P_TT', kind: 'multiplier', represents: 'tanh(4*x - 2)^2', max: 1.25, inputs: [{ from: 'I_T' }, { from: 'I_T' }], position: [2, 3] },
    { id: 'G_abs', kind: 'function_generator', represents: 'abs(2*x - 1)', max: 1.25, inputs: [{ from: 'I_x' }], breakpoints: [[0, 1], [0.5, 0], [1, 1]], position: [3, 0] },
    { id: 'G_sqrt', kind: 'function_generator', represents: 'sqrt(x)', max: 1.25, inputs: [{ from: 'I_x' }], breakpoints: bp('f_sqrt', sqrtXs), position: [3, 2] },
    { id: 'G_log', kind: 'function_generator', represents: 'log(1 + x)', max: 1.25, inputs: [{ from: 'I_x' }], breakpoints: bp('f_log', logXs), position: [3, 3] },
  ];
  const outs = [['f_sin', 'I_S'], ['f_exp', 'I_E'], ['f_square', 'P_sq'], ['f_sqrt', 'G_sqrt'], ['f_log', 'G_log'], ['f_tanh', 'I_T'], ['f_abs', 'G_abs']];
  const lines = [
    NOTICE, 'format: anasim-patch 1', 'patch:', '  id: function_generation', '  version: 0.1.0', '  title: Function generation y = f(x)',
    '  description: >-',
    '    The seven functions of the model on 0 <= x <= 1, with x = t produced by a ramp. sin, exp, square and tanh are',
    '    exact realisations by integrators and multipliers; abs is a function generator with exact breakpoints; sqrt',
    `    and log are function generators through ${n + 1} breakpoints, approximations whose bound is measured.`,
    '  model: {id: function-generation, version: 1.0.0}',
    `  generator: "${GEN}, from model sha256 ${specHash(model)}"`,
    'machine: {time_scale: auto}',
    'elements:',
    ...els.map((e) => '  - ' + flow(e)),
    'outputs:',
    ...outs.map(([nm, el]) => `  - {name: ${nm}, element: ${el}}`),
    'run: {t1: 1.0, h: 0.001}',
    '',
  ];
  return lines.join('\n');
}

function ternaryPatch(n = 16) {
  const els = [{ id: 'R_p1', kind: 'constant', represents: '1', value: 1, label: 'reference +1', position: [0, -1] }];
  const inputs = [];
  for (let i = 0; i < n; i++) {
    els.push({ id: `A_${i}`, kind: 'constant', represents: `a_${i}`, max: 1.25, value: 0, position: [0, 2 * i] });
    els.push({ id: `B_${i}`, kind: 'constant', represents: `b_${i}`, max: 1.25, value: 0, position: [0, 2 * i + 1] });
    inputs.push({ name: `a${i}`, element: `A_${i}` }, { name: `b${i}`, element: `B_${i}` });
    const ins = [{ from: `A_${i}`, weight: 1 }, { from: `B_${i}`, weight: 1 }];
    if (i > 0) ins.push({ from: `CP_${i - 1}`, weight: 1 }, { from: `CN_${i - 1}`, weight: 1 });
    els.push({ id: `S_${i}`, kind: 'summer', represents: `-(a_${i} + b_${i} + k_${i - 1 < 0 ? 'in' : i - 1})`, max: 3.75, inputs: ins, position: [1, 2 * i] });
    els.push({ id: `CP_${i}`, kind: 'comparator', represents: `kp_${i}`, max: 1.25, inputs: [{ from: `S_${i}`, weight: -1 }, { from: 'R_p1', weight: -1.5 }], levels: { below: 0, above: 1 }, position: [2, 2 * i] });
    els.push({ id: `CN_${i}`, kind: 'comparator', represents: `kn_${i}`, max: 1.25, inputs: [{ from: `S_${i}`, weight: -1 }, { from: 'R_p1', weight: 1.5 }], levels: { below: -1, above: 0 }, position: [2, 2 * i + 1] });
    els.push({ id: `Z_${i}`, kind: 'summer', represents: `z_${i}`, max: 1.25, inputs: [{ from: `S_${i}`, weight: 1 }, { from: `CP_${i}`, weight: 3 }, { from: `CN_${i}`, weight: 3 }], position: [3, 2 * i] });
  }
  const lines = [
    NOTICE, 'format: anasim-patch 1', 'patch:', '  id: balanced_ternary_addition', '  version: 0.1.0', `  title: Balanced ternary addition, ${n} trits`,
    '  description: >-',
    `    A ${n}-trit ripple adder of summers and comparators. Trit levels are one problem unit; stage i forms`,
    '    a + b + k in S_i, its carry from two comparators at +1.5 and -1.5, and the sum trit a + b + k - 3 k in Z_i.',
    '    The final carry is dropped, so the word wraps modulo 3^n as the reference function does. The analogue column',
    '    of the build matrix marks balanced ternary not applicable; this patch is a demonstration of comparators,',
    '    checked exactly against the reference vectors.',
    '  model: {id: balanced-ternary-addition, version: 1.0.0}',
    `  generator: "${GEN}"`,
    'machine: {time_scale: 1.0}',
    'inputs:',
    ...inputs.map((u) => '  - ' + flow(u)),
    'elements:',
    ...els.map((e) => '  - ' + flow(e)),
    'outputs:',
    ...Array.from({ length: n }, (_, i) => `  - {name: z${i}, element: Z_${i}}`),
    'run: {t1: 1.0, h: 1.0}',
    '',
  ];
  return lines.join('\n');
}

const files = {
  'docs/programs/function-generation.patch.yaml': functionPatch(),
  'docs/programs/balanced-ternary-addition.patch.yaml': ternaryPatch(16),
};
let bad = 0;
for (const [f, text] of Object.entries(files)) {
  const p = path.join(REPO, f);
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    if (have !== text) { console.error(`gen_patches --check: ${f} differs from its generator`); bad++; } else console.log(`gen_patches --check: ${f} matches`);
  } else { fs.writeFileSync(p, text); console.log(`gen_patches: wrote ${f}`); }
}
process.exit(bad ? 1 : 0);
