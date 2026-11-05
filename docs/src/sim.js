// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The run loop (ANA-01, Guidelines 7): fixed-step classical RK4 from the core (rk4Step), with events located by
// the core's bisection (to 1e-12 of the step) and integration restarted from each event. It runs any system
// assembled by compile/assemble.js (ideal) or nonideal.js (op-amp level), under a mode schedule (IC, operate,
// hold). Mode changes fall on grid points. Every step checks finiteness; a non-finite value stops the run with
// NONFINITE naming the state and the time. A per-step hook lets the non-ideal level hold its seeded noise
// constant through each step, so a seed reproduces a run exactly.
//
//   runSystem(sys, { h, steps, every, modes, tol, onStep, cancel }) ->
//     { t: number[] (machine time), rows: Float64Array[] (element outputs, machine units), events, stats }

import { SubcoreError, rk4Step, rk4Work, bisect } from './core.js';

export const SIM_VERSION = '0.1.0';

function crossed(ga, gb, direction) {
  if (direction === 'rising') return ga < 0 && gb >= 0;
  if (direction === 'falling') return ga > 0 && gb <= 0;
  return (ga < 0 && gb >= 0) || (ga > 0 && gb <= 0);
}

// modes: [{ mode, until }] in machine time, the last without until (or until >= the end). Default: operate.
export function modeSchedule(modes, h) {
  const list = (modes && modes.length ? modes : [{ mode: 'operate' }]).map((m) => ({ ...m }));
  return (t, k) => {
    for (const m of list) if (m.until === undefined || t < m.until - 1e-9 * h) return m.mode;
    return list[list.length - 1].mode;
  };
}

export function runSystem(sys, opts) {
  const { h, steps, every = 1, tol = 1e-12, onStep, cancel, events: wantEvents = true } = opts;
  if (!(h > 0) || !Number.isFinite(h)) throw new SubcoreError('SOLVER', 'h', `step must be positive and finite, got ${h}`);
  if (!Number.isInteger(steps) || steps < 0) throw new SubcoreError('SOLVER', 'steps', `a whole number of steps, got ${steps}`);
  const modeAt = modeSchedule(opts.modes, h);
  const n = sys.n, ny = sys.ny;
  const w = rk4Work(ny);
  let y = Float64Array.from(sys.y0);
  const d = sys.d0();
  const out = new Float64Array(n), outA = new Float64Array(n), outB = new Float64Array(n), tmp = new Float64Array(n);
  const ystart = new Float64Array(ny), yend = new Float64Array(ny);
  const evs = wantEvents ? sys.events : sys.events.filter((e) => !e.overload);
  const log = [];
  const ts = [0], rows = [Float64Array.from(sys.outputs(y, d, out))];
  let prevMode = null, nEvents = 0;
  // overloads present at the start (an initial condition beyond the machine unit)
  if (wantEvents) for (const e of evs) if (e.name === 'overload' && e.g(out, d) > 0) log.push({ name: 'overload', element: e.element, t: 0, initial: true });
  const check = (yv, t) => {
    for (let i = 0; i < ny; i++) if (!Number.isFinite(yv[i])) {
      throw new SubcoreError('NONFINITE', sys.names[i], `state ${sys.names[i]} is ${yv[i]} at machine time t=${t}`, { t, index: i });
    }
  };
  for (let k = 1; k <= steps; k++) {
    if (cancel && cancel()) return { t: ts, rows, events: log, stats: { steps: k - 1, h, cancelled: true, events: nEvents } };
    let t = (k - 1) * h;
    const tn = k * h;
    const mode = modeAt(t, k);
    if (mode !== prevMode) {
      if (mode === 'ic') y = sys.icState(y, d);
      if (prevMode !== null) log.push({ name: 'mode', mode, t });
      prevMode = mode;
    }
    if (onStep) onStep(k, t, y, d);
    const f = sys.f(mode, d);
    for (let guard = 0; ; guard++) {
      if (guard > 1000) throw new SubcoreError('EVENT', 'sim', `more than 1000 events in the step ending at t=${tn}`);
      ystart.set(y);
      rk4Step(f, t, ystart, tn - t, yend, w);
      check(yend, tn);
      if (evs.length === 0) { y.set(yend); break; }
      sys.outputs(ystart, d, outA);
      sys.outputs(yend, d, outB);
      const found = [];
      for (const e of evs) {
        const ga = e.g(outA, d), gb = e.g(outB, d);
        if (!crossed(ga, gb, e.direction)) continue;
        const tA = t, yA = Float64Array.from(ystart);
        const g = (tt, yy) => e.g(sys.outputs(yy, d, tmp), d);
        const r = bisect(g, tA, yA, tn, (dt) => rk4Step(f, tA, yA, dt, new Float64Array(ny), w), { tol, direction: e.direction });
        found.push({ e, r });
      }
      if (found.length === 0) { y.set(yend); break; }
      found.sort((a, b) => a.r.t - b.r.t);
      // events located at the same instant (within the bisection width) are taken together
      const window = 4 * tol * (tn - t);
      const group = found.filter((x) => x.r.t - found[0].r.t <= window);
      const last = group[group.length - 1];
      y.set(last.r.y);
      t = last.r.t;
      sys.outputs(y, d, tmp);
      for (const { e } of group) {
        nEvents++;
        if (e.action) e.action(d, tmp);
        log.push({ name: e.name, element: e.element, t });
      }
      if (t >= tn) break;
    }
    if (k % every === 0 || k === steps) { ts.push(tn); rows.push(Float64Array.from(sys.outputs(y, d, out))); }
  }
  return { t: ts, rows, events: log, stats: { steps, h, every, events: nEvents } };
}

// Overload onsets from an event log: [{ element, t }]
export function overloads(events) {
  return events.filter((e) => e.name === 'overload').map((e) => ({ element: e.element, t: e.t }));
}
