// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// ODE assembly (P11.2, Guidelines 7 and 9.2): the scaled patch becomes a system in machine units and machine
// time. Integrator outputs are the continuous states; summers, inverters, potentiometers, multipliers,
// limiters and function generators are algebraic relations evaluated in dependency order (an algebraic loop
// was refused at validation); comparators and sample-and-holds carry discrete states changed only at located
// events. Mode control: in IC mode integrators sit at their initial conditions, in operate mode they
// integrate, in hold mode they are frozen.
//
// The system object is what sim.js runs:
//   { names, ny, y0, d0(), f(mode, d) -> (t, y, dydt), outputs(y, d, out), events, icState(y), columns, n }

import { ELEMENTS } from '../elements/index.js';
import { evaluationOrder } from '../patch.js';

export function assembleIdeal(scaled, patch) {
  const m = scaled.machine;
  const n = m.length;
  const idx = new Map(m.map((e, i) => [e.id, i]));
  const integ = [], yOf = new Int32Array(n).fill(-1);
  m.forEach((e, i) => { if (e.kind === 'integrator') { yOf[i] = integ.length; integ.push(i); } });
  const order = evaluationOrder(patch.elements).map((id) => idx.get(id)).filter((i) => m[i].kind !== 'integrator');
  const defs = m.map((e) => ELEMENTS[e.kind]);
  const discrete = m.map((e, i) => i).filter((i) => defs[i].state === 'discrete');
  const ny = integ.length;
  const y0 = Float64Array.from(integ.map((i) => m[i].ic));

  // Evaluate every element output into out (length n). With settle, discrete states are first set from their
  // inputs (comparators from the sign of their switching function, sample-and-holds tracking or holding).
  const outputs = (y, d, out, settle = false) => {
    for (let k = 0; k < ny; k++) out[integ[k]] = y[k];
    for (let j = 0; j < order.length; j++) {
      const i = order[j], def = defs[i];
      if (settle && def.state === 'discrete') {
        if (m[i].kind === 'comparator') d[i] = def.g(m[i], out) > 0;
        else d[i] = { track: out[m[i].ctl] > 0, held: m[i].g * out[m[i].src[0]] };
      }
      out[i] = def.out(m[i], out, d[i]);
    }
    return out;
  };
  const d0 = () => {
    const d = new Array(n).fill(null);
    const out = new Float64Array(n);
    outputs(y0, d, out, true);
    return d;
  };
  const f = (mode, d) => {
    const out = new Float64Array(n);
    if (mode !== 'operate') return (t, y, dydt) => { dydt.fill(0); };
    return (t, y, dydt) => {
      outputs(y, d, out);
      for (let k = 0; k < ny; k++) { const i = integ[k]; dydt[k] = defs[i].der(m[i], out); }
    };
  };
  // events: comparator switching, sample-and-hold control, overload onset and recovery of every element
  const events = [];
  for (const i of discrete) {
    if (m[i].kind === 'comparator') {
      events.push({ name: 'switch', element: m[i].id, direction: 'both', g: (out) => defs[i].g(m[i], out),
        action: (d) => { d[i] = !d[i]; } });
    } else {
      events.push({ name: 'control', element: m[i].id, direction: 'both', g: (out) => out[m[i].ctl],
        action: (d, out) => { if (d[i].track) d[i] = { track: false, held: m[i].g * out[m[i].src[0]] }; else d[i] = { track: true, held: d[i].held }; } });
    }
  }
  m.forEach((e, i) => {
    events.push({ name: 'overload', element: e.id, direction: 'rising', overload: true, g: (out) => Math.abs(out[i]) - 1 });
    events.push({ name: 'recover', element: e.id, direction: 'falling', overload: true, g: (out) => Math.abs(out[i]) - 1 });
  });
  return {
    level: 'ideal', n, ny, names: integ.map((i) => m[i].id), columns: m.map((e) => e.id), y0, d0, f, outputs, events,
    icState: () => Float64Array.from(y0),
    // element index -> state index (or -1)
    yOf,
  };
}
