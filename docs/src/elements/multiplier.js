// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Multiplier (Guidelines 9.1): v = u1 u2. Machine form V = c U1 U2 with c = M_1 M_2 / M (recorded; the
// realisation is a four-quadrant multiplier, whose own output is U1 U2, followed by a gain of c).

export default {
  kind: 'multiplier',
  minInputs: 2, maxInputs: 2, weighted: false,
  state: null, opamp: null, needsMax: true, inverting: false,
  defaultMax: null,
  scale(el, c) {
    const g = (c.inMax(0) * c.inMax(1)) / c.M;
    return { c: g, factors: { c: `M_1*M_2/M = ${c.inMax(0)}*${c.inMax(1)}/${c.M}` } };
  },
  out(m, out) { return m.c * out[m.src[0]] * out[m.src[1]]; },
  relation(w, rep) { return rep[0] * rep[1]; },
};
