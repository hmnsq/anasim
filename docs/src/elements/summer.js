// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Summer (Guidelines 9.1): v = -sum(w_i u_i). Machine form V = -sum(a_i U_i), a_i = w_i M_i / M.
// Realised by an op-amp with resistive feedback, a_i = R_f / R_i.

export default {
  kind: 'summer',
  minInputs: 1, maxInputs: Infinity, weighted: true,
  state: null, opamp: 'summer', needsMax: true, inverting: true,
  defaultMax: null,
  scale(el, c) {
    const a = el.inputs.map((inp, k) => (c.weight(k) * c.inMax(k)) / c.M);
    return { a, factors: { a: el.inputs.map((inp, k) => `w*M_in/M = ${c.weight(k)}*${c.inMax(k)}/${c.M}`) } };
  },
  out(m, out) {
    let s = 0;
    for (let k = 0; k < m.src.length; k++) s += m.a[k] * out[m.src[k]];
    return -s;
  },
  relation(w, rep) { let s = 0; for (let k = 0; k < rep.length; k++) s += w[k] * rep[k]; return -s; },
};
