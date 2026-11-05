// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Inverter (Guidelines 9.1): v = -u. Its scale is its input's unless declared; V = -(M_in / M) U.
// Realised as a summer with one unit-weight input.

export default {
  kind: 'inverter',
  minInputs: 1, maxInputs: 1, weighted: false,
  state: null, opamp: 'summer', needsMax: false, inverting: true,
  defaultMax: (el, c) => c.inMax(0),
  scale(el, c) { return { a: [c.inMax(0) / c.M], factors: { a: [`M_in/M = ${c.inMax(0)}/${c.M}`] } }; },
  out(m, out) { return -m.a[0] * out[m.src[0]]; },
  relation(w, rep) { return -rep[0]; },
};
