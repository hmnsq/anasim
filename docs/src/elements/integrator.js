// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Integrator (Guidelines 9.1): dv/dt = -sum(w_i u_i) from its initial condition; frozen in hold mode, held at
// its initial condition in IC mode. Machine form, in machine units and machine time tau = T t:
//   dV/dtau = -sum(a_i U_i),  a_i = w_i M_i / (M T)   (machine s^-1; realised as 1/(R_i C))
// Non-ideal realisation: an op-amp with capacitive feedback and one input resistor per weight (see nonideal.js).

export default {
  kind: 'integrator',
  minInputs: 1, maxInputs: Infinity, weighted: true,
  state: 'continuous', opamp: 'integrator', needsMax: true, inverting: true,
  defaultMax: null,
  scale(el, c) {
    const a = el.inputs.map((inp, k) => (c.weight(k) * c.inMax(k)) / (c.M * c.T));
    return { a, ic: c.ev(el.ic, 'ic') / c.M, factors: { a: el.inputs.map((inp, k) => `w*M_in/(M*T) = ${c.weight(k)}*${c.inMax(k)}/(${c.M}*${c.T})`) } };
  },
  // derivative in machine units per machine second
  der(m, out) {
    let s = 0;
    for (let k = 0; k < m.src.length; k++) s += m.a[k] * out[m.src[k]];
    return -s;
  },
  // problem-level relation: d(represents)/dt = -sum(w_i rep_i)
  relation(w, rep) { let s = 0; for (let k = 0; k < rep.length; k++) s += w[k] * rep[k]; return -s; },
};
