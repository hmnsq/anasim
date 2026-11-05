// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Sample and hold (Guidelines 9.1): tracks its input while the control input is positive, holds the value it
// had when the control fell to zero or below. The held value is a discrete state set at a located event.

export default {
  kind: 'sample_hold',
  minInputs: 1, maxInputs: 1, weighted: false,
  state: 'discrete', opamp: null, needsMax: false, inverting: false,
  defaultMax: (el, c) => c.inMax(0),
  scale(el, c) { return { g: c.inMax(0) / c.M, factors: { g: `M_in/M = ${c.inMax(0)}/${c.M}` } }; },
  // control function: positive means track
  g(m, out) { return out[m.ctl]; },
  out(m, out, st) { return st.track ? m.g * out[m.src[0]] : st.held; },
  relation(w, rep) { return rep[0]; },
};
