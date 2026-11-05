// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Limiter (Guidelines 9.1): v = min(max(u, low), high). Its scale is its input's unless declared.

export default {
  kind: 'limiter',
  minInputs: 1, maxInputs: 1, weighted: false,
  state: null, opamp: null, needsMax: false, inverting: false,
  defaultMax: (el, c) => c.inMax(0),
  scale(el, c) {
    return { g: c.inMax(0) / c.M, low: c.ev(el.low, 'low') / c.M, high: c.ev(el.high, 'high') / c.M,
      factors: { g: `M_in/M = ${c.inMax(0)}/${c.M}`, bounds: `/M, M = ${c.M}` } };
  },
  out(m, out) { return Math.min(Math.max(m.g * out[m.src[0]], m.low), m.high); },
  relation(w, rep, el, ev) { return Math.min(Math.max(rep[0], ev(el.low)), ev(el.high)); },
};
