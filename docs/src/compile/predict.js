// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Overload prediction (ANA-03, T-51) and the check of a patch against its model.
//
// Prediction works in the problem domain, from the computational model alone: the model's own equations (compiled
// by the core, not the patch network) are integrated with the core's event-locating RK4, and for every element
// the expression it represents is divided by its bound M. An overload is predicted wherever |represents| / M
// rises through 1 (and a recovery wherever it falls back). The simulator finds overloads independently, in
// machine units and machine time, on the patch network itself; T-51 requires the two lists to agree.
//
// checkAgainstModel evaluates every element's represents expression along the model's trajectory and checks the
// element relation in problem units: a summer's represents equals -sum(w_i rep_i), an integrator's time
// derivative equals -sum(w_i rep_i) and its initial value its ic, and so on. A wrong sign, coefficient or
// initial condition in a patch is refused here (code SEMANTIC) before anything is simulated.

import { SubcoreError, parse, compile, compileModel, integrateFixed, integrateWithEvents, rk4Step, rk4Work, bisect, INDEPENDENT } from '../core.js';
import { ELEMENTS } from '../elements/index.js';

// Compile each element's represents over (t, states, environment). Returns { names, at(t, y) -> number[] }.
export function representsFns(patch, model, env) {
  const states = (model.states || []).map((s) => s.name);
  const extra = model.kind === 'function' && model.independent ? [model.independent.name] : [];
  const names = [INDEPENDENT, ...states, ...extra, ...Object.keys(env)];
  const slots = new Map(names.map((n, k) => [n, k]));
  const vec = new Float64Array(names.length);
  Object.entries(env).forEach(([k, v]) => { vec[slots.get(k)] = v; });
  const fns = patch.elements.map((e, i) => {
    try { return compile(parse(e.represents), slots); } catch (err) { throw new SubcoreError(err.code || 'PARSE', `elements[${i}].represents`, err.message); }
  });
  return {
    ids: patch.elements.map((e) => e.id),
    at(t, y, out = new Float64Array(fns.length)) {
      vec[0] = t;
      for (let i = 0; i < states.length; i++) vec[1 + i] = y[i];
      if (extra.length) vec[1 + states.length] = t; // function models: the independent variable runs as time (x = t)
      for (let i = 0; i < fns.length; i++) out[i] = fns[i](vec);
      return out;
    },
  };
}

// Predicted overloads over the problem horizon [0, t1] with step h (problem time).
export function predictOverloads(patch, model, scaled, { t1, h, overrides = {} }) {
  const rep = representsFns(patch, model, scaled.env);
  const M = patch.elements.map((e) => scaled.scales[e.id]);
  const steps = Math.round(t1 / h);
  const initial = [];
  const log = [];
  if (model.kind === 'continuous') {
    const c = compileModel(model, Object.fromEntries(Object.entries(overrides).filter(([k]) => !k.endsWith('_0'))));
    const y0 = c.stateNames.map((s) => scaled.env[`${s}_0`]);
    const r0 = rep.at(0, y0);
    patch.elements.forEach((e, i) => { if (Math.abs(r0[i]) / M[i] > 1) initial.push({ element: e.id, t: 0, initial: true }); });
    const tmp = new Float64Array(M.length);
    // the model's own trajectory, every step kept; each element's crossings are located independently by
    // bisection on RK4 sub-steps from the step's start (so simultaneous crossings are all found)
    const res = integrateFixed({ f: c.f, t0: 0, y0, h, steps, names: c.stateNames });
    const w = rk4Work(y0.length);
    patch.elements.forEach((e, i) => {
      const g = (t, y) => Math.abs(rep.at(t, y, tmp)[i]) / M[i] - 1;
      for (let k = 1; k <= steps; k++) {
        const ta = res.t[k - 1], tb = res.t[k], ya = res.y[k - 1];
        const ga = g(ta, ya), gb = g(tb, res.y[k]);
        for (const [name, dir, hit] of [['overload', 'rising', ga < 0 && gb >= 0], ['recover', 'falling', ga > 0 && gb <= 0]]) {
          if (!hit) continue;
          const r = bisect(g, ta, ya, tb, (dt) => rk4Step(c.f, ta, ya, dt, new Float64Array(ya.length), w), { direction: dir });
          log.push({ name, element: e.id, t: r.t });
        }
      }
    });
    log.sort((a, b) => a.t - b.t);
  } else if (model.kind === 'function') {
    const r0 = rep.at(0, []);
    patch.elements.forEach((e, i) => { if (Math.abs(r0[i]) / M[i] > 1) initial.push({ element: e.id, t: 0, initial: true }); });
    const tmp = new Float64Array(M.length);
    patch.elements.forEach((e, i) => {
      const g = (t) => Math.abs(rep.at(t, [], tmp)[i]) / M[i] - 1;
      for (let k = 1; k <= steps; k++) {
        const ta = (k - 1) * h, tb = k * h, ga = g(ta), gb = g(tb);
        for (const [name, dir, hit] of [['overload', 'rising', ga < 0 && gb >= 0], ['recover', 'falling', ga > 0 && gb <= 0]]) {
          if (!hit) continue;
          const r = bisect((t) => g(t), ta, [], tb, () => [], { direction: dir });
          log.push({ name, element: e.id, t: r.t });
        }
      }
    });
    log.sort((a, b) => a.t - b.t);
  } else {
    throw new SubcoreError('MODEL', 'kind', `overload prediction over time needs a continuous or function model, not ${model.kind}`);
  }
  return { initial, events: log, onsets: [...initial, ...log.filter((e) => e.name === 'overload')] };
}

// Compare predicted and simulated onsets: the same elements with the same number of onsets, each pair within
// bound * horizon (Test Plan 5: 1 per cent of the horizon).
export function compareOverloads(predicted, simulated, horizon, bound = 0.01) {
  const group = (list) => {
    const m = new Map();
    for (const e of list) { if (!m.has(e.element)) m.set(e.element, []); m.get(e.element).push(e.t); }
    for (const v of m.values()) v.sort((a, b) => a - b);
    return m;
  };
  const P = group(predicted), S = group(simulated);
  const problems = [];
  let maxDiff = 0, pairs = 0;
  for (const el of new Set([...P.keys(), ...S.keys()])) {
    const p = P.get(el) || [], s = S.get(el) || [];
    if (p.length !== s.length) { problems.push(`${el}: ${p.length} predicted onset(s), ${s.length} simulated`); continue; }
    for (let k = 0; k < p.length; k++) {
      const dlt = Math.abs(p[k] - s[k]);
      maxDiff = Math.max(maxDiff, dlt); pairs++;
      if (dlt > bound * horizon) problems.push(`${el}: onset ${k + 1} predicted at ${p[k]}, simulated at ${s[k]} (difference ${dlt} > ${bound * horizon})`);
    }
  }
  return { agree: problems.length === 0, pairs, maxDiff, maxDiffOverHorizon: maxDiff / horizon, bound, problems };
}

// The patch against its model, along the model's trajectory (continuous) or the domain (function models).
export function checkAgainstModel(patch, model, scaled, { t1, h, samples = 64, tol = 1e-6 } = {}) {
  const errs = [];
  const rep = representsFns(patch, model, scaled.env);
  const els = patch.elements;
  const idx = new Map(els.map((e, i) => [e.id, i]));
  const ev = scaled.ev;
  const M = els.map((e) => scaled.scales[e.id]);
  const weights = els.map((e, i) => (e.inputs || []).map((inp, k) => (inp.weight === undefined ? 1 : ev(inp.weight, `elements[${i}].inputs[${k}].weight`))));
  let pts = [];
  let deriv = null;
  if (model.kind === 'continuous') {
    const c = compileModel(model);
    const y0 = c.stateNames.map((s) => scaled.env[`${s}_0`]);
    const steps = Math.round(t1 / h);
    const every = Math.max(1, Math.floor(steps / samples));
    const res = integrateWithEvents({ f: c.f, t0: 0, y0, h, steps, events: [], every });
    pts = res.t.map((t, k) => [t, res.y[k]]);
    const dy = new Float64Array(y0.length), yp = new Float64Array(y0.length), ym = new Float64Array(y0.length);
    // d/dt represents along the flow, by a central difference of step delta in time and state
    deriv = (t, y, i) => {
      const delta = 1e-5 * Math.max(1, t1);
      c.f(t, y, dy);
      for (let j = 0; j < y.length; j++) { yp[j] = y[j] + delta * dy[j]; ym[j] = y[j] - delta * dy[j]; }
      return (rep.at(t + delta, yp)[i] - rep.at(t - delta, ym)[i]) / (2 * delta);
    };
  } else if (model.kind === 'function') {
    for (let k = 0; k <= samples; k++) pts.push([(k * t1) / samples, []]);
    deriv = (t, y, i) => { const delta = 1e-5 * Math.max(1, t1); return (rep.at(t + delta, y)[i] - rep.at(t - delta, y)[i]) / (2 * delta); };
  } else {
    return { errors: [], approximations: [], note: `no time-domain check for a ${model.kind} model` };
  }
  const worst = new Map();
  const approx = new Map();
  for (const [t, y] of pts) {
    const r = Float64Array.from(rep.at(t, y));
    els.forEach((e, i) => {
      const def = ELEMENTS[e.kind];
      if (def.state === 'discrete') return;
      const ins = (e.inputs || []).map((inp) => r[idx.get(inp.from)]);
      const expect = def.relation(weights[i], ins, e, (v) => ev(v));
      const got = e.kind === 'integrator' ? deriv(t, y, i) : r[i];
      const scale = e.kind === 'integrator' ? Math.max(M[i], ...ins.map((v, k) => Math.abs(weights[i][k]) * M[idx.get(e.inputs[k].from)])) : M[i];
      const dev = Math.abs(got - expect) / scale;
      const store = e.kind === 'function_generator' ? approx : worst;
      if (!store.has(i) || dev > store.get(i).dev) store.set(i, { dev, t, got, expect });
    });
  }
  // integrator initial conditions
  els.forEach((e, i) => {
    if (e.kind !== 'integrator') return;
    const r0 = model.kind === 'continuous' ? rep.at(0, pts[0][1])[i] : rep.at(0, [])[i];
    const ic = ev(e.ic, `elements[${i}].ic`);
    if (Math.abs(r0 - ic) / M[i] > 1e-12) errs.push({ code: 'SEMANTIC', path: `elements[${i}].ic`, message: `initial condition ${ic} differs from represents '${e.represents}' = ${r0} at t = 0` });
  });
  for (const [i, w] of worst) {
    const e = els[i];
    if (w.dev > tol) {
      const what = e.kind === 'integrator' ? `d/dt(${e.represents})` : e.represents;
      errs.push({ code: 'SEMANTIC', path: `elements[${i}]`, message: `${e.kind} ${e.id}: ${what} = ${w.got} but its inputs give ${w.expect} at t = ${w.t} (deviation ${w.dev.toExponential(3)} of its scale > ${tol})` });
    }
  }
  return {
    errors: errs,
    worst: Object.fromEntries([...worst].map(([i, w]) => [els[i].id, w.dev])),
    approximations: [...approx].map(([i, w]) => ({ element: els[i].id, represents: els[i].represents, max_deviation_over_scale: w.dev, at: w.t })),
  };
}
