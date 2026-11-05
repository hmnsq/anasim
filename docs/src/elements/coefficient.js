// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Coefficient potentiometer (Guidelines 9.1): v = k u with 0 <= k <= 1. Its scale is its input's unless
// declared; the machine setting k M_in / M must lie in [0, 1], or the patch is refused (COEFF_RANGE).

import { SubcoreError } from '../core.js';

export default {
  kind: 'coefficient',
  minInputs: 1, maxInputs: 1, weighted: false,
  state: null, opamp: null, needsMax: false, inverting: false,
  defaultMax: (el, c) => c.inMax(0),
  scale(el, c, path) {
    const k = c.ev(el.k, 'k');
    if (!(k >= 0 && k <= 1)) throw new SubcoreError('COEFF_RANGE', `${path}.k`, `a potentiometer setting is in [0, 1], got ${k}`);
    const s = (k * c.inMax(0)) / c.M;
    if (!(s >= 0 && s <= 1)) throw new SubcoreError('COEFF_RANGE', `${path}.k`, `machine setting k*M_in/M = ${s} is outside [0, 1]; change the scales or use a summer weight`);
    return { k: s, problemK: k, factors: { k: `k*M_in/M = ${k}*${c.inMax(0)}/${c.M}` } };
  },
  out(m, out) { return m.k * out[m.src[0]]; },
  relation(w, rep, el, ev) { return ev(el.k) * rep[0]; },
};
