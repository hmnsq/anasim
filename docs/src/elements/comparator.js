// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Comparator (Guidelines 9.1): switches between two levels when sum(w_i u_i) crosses zero (for two inputs
// with weights 1 and -1, when u1 - u2 crosses zero). The output is a discrete state, changed only at located
// events (bisection to 1e-12 of the step), so the derivative function stays smooth between events.
// Machine form: the sign of sum(w_i M_i U_i); levels L / M.

export default {
  kind: 'comparator',
  minInputs: 1, maxInputs: Infinity, weighted: true,
  state: 'discrete', opamp: null, needsMax: true, inverting: false,
  defaultMax: null,
  scale(el, c) {
    const s = el.inputs.map((inp, k) => c.weight(k) * c.inMax(k));
    const norm = Math.max(...s.map(Math.abs));
    return {
      a: s.map((x) => x / norm),
      below: c.ev(el.levels.below, 'levels.below') / c.M,
      above: c.ev(el.levels.above, 'levels.above') / c.M,
      factors: { a: s.map((x, k) => `w*M_in/max = ${c.weight(k)}*${c.inMax(k)}/${norm}`), levels: `L/M, M = ${c.M}` },
    };
  },
  // the switching function, machine units
  g(m, out) { let s = 0; for (let k = 0; k < m.src.length; k++) s += m.a[k] * out[m.src[k]]; return s; },
  out(m, out, st) { return st ? m.above : m.below; },
  relation(w, rep, el, ev) { let s = 0; for (let k = 0; k < rep.length; k++) s += w[k] * rep[k]; return s > 0 ? ev(el.levels.above) : ev(el.levels.below); },
};
