// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Function generator (Guidelines 9.1): piecewise linear through breakpoints (x, y) in problem units, x strictly
// increasing; the end segments extend linearly beyond the outer breakpoints. Machine breakpoints (x / M_in, y / M).

export function pwl(xs, ys, x) {
  const n = xs.length;
  let j;
  if (x <= xs[0]) j = 0;
  else if (x >= xs[n - 1]) j = n - 2;
  else { let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; } j = lo; }
  return ys[j] + ((ys[j + 1] - ys[j]) * (x - xs[j])) / (xs[j + 1] - xs[j]);
}

export default {
  kind: 'function_generator',
  minInputs: 1, maxInputs: 1, weighted: false,
  state: null, opamp: null, needsMax: true, inverting: false,
  defaultMax: null,
  scale(el, c) {
    return { xs: el.breakpoints.map((b) => b[0] / c.inMax(0)), ys: el.breakpoints.map((b) => b[1] / c.M),
      factors: { breakpoints: `(x/M_in, y/M), M_in = ${c.inMax(0)}, M = ${c.M}` } };
  },
  out(m, out) { return pwl(m.xs, m.ys, out[m.src[0]]); },
  relation(w, rep, el) { return pwl(el.breakpoints.map((b) => b[0]), el.breakpoints.map((b) => b[1]), rep[0]); },
};
