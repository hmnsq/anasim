// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Constant (the machine's reference voltage through a potentiometer): v = value. Its scale defaults to
// |value| (1 when the value is 0). A patch input names a constant whose value a run may set.

export default {
  kind: 'constant',
  minInputs: 0, maxInputs: 0, weighted: false,
  state: null, opamp: null, needsMax: false, inverting: false,
  defaultMax: (el, c) => Math.abs(c.ev(el.value, 'value')) || 1,
  scale(el, c) { return { v: c.ev(el.value, 'value') / c.M, factors: { v: `value/M, M = ${c.M}` } }; },
  out(m) { return m.v; },
  relation(w, rep, el, ev) { return ev(el.value); },
};
