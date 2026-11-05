// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Magnitude and time scaling (ANA-03, Guidelines 9.2, MRD 9.12). Every element output x (problem units) is held
// on the machine as X = x / M, with M the element's declared bound (or, for inverters, potentiometers,
// limiters, sample-and-holds and constants, the bound its input or value implies). Machine time is tau = T t.
// T is either stated by the patch or chosen as the smallest power of ten for which the fastest integrator gain
// sum(|a_i|) stays at or below 2 pi GBW / margin, the elements' bandwidth with a margin (default 1000).
// Every factor is returned, with the expression that produced it, so it can be recorded and undone.

import { SubcoreError, parse, compile, toSI } from '../core.js';
import { ELEMENTS } from '../elements/index.js';
import { assertPatch } from '../patch.js';

export const COMPILER_VERSION = '0.1.0';
export const DEFAULT_MARGIN = 1000;

// The problem-level environment: model parameters (SI) and initial values <state>_0, plus overrides.
export function problemEnv(model, overrides = {}) {
  const env = {};
  for (const p of model.parameters || []) env[p.name] = toSI(p.value, p.unit);
  for (const s of model.states || []) env[`${s.name}_0`] = toSI(s.initial, s.unit);
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in env)) throw new SubcoreError('MODEL', `overrides.${k}`, 'not a parameter or initial value of the model');
    env[k] = v;
  }
  return env;
}

export function evaluator(env) {
  const names = Object.keys(env);
  const slots = new Map(names.map((n, k) => [n, k]));
  const vec = new Float64Array(names.map((n) => env[n]));
  const cache = new Map();
  return (v, path = '') => {
    if (typeof v === 'number') return v;
    let fn = cache.get(v);
    if (!fn) {
      try { fn = compile(parse(String(v)), slots); } catch (e) { throw new SubcoreError(e.code || 'PARSE', path, e.message); }
      cache.set(v, fn);
    }
    const x = fn(vec);
    if (!Number.isFinite(x)) throw new SubcoreError('VALUE', path, `expression '${v}' is ${x}`);
    return x;
  };
}

// The analogue substrate parameters the compiler reads (from the vendored substrate specification).
export function substrateParams(substrate) {
  const get = (n) => (substrate.parameters || []).find((p) => p.name === n);
  const gbw = get('opamp_gbw'), mu = get('machine_unit_voltage');
  if (!gbw || typeof gbw.value !== 'number') throw new SubcoreError('SUBSTRATE', 'parameters.opamp_gbw', 'the substrate states no op-amp gain-bandwidth');
  if (!mu || typeof mu.value !== 'number') throw new SubcoreError('SUBSTRATE', 'parameters.machine_unit_voltage', 'the substrate states no machine unit voltage');
  return { gbw: gbw.value, gbwEvidence: gbw.evidence, unitVolts: mu.value, unitEvidence: mu.evidence, substrate: `${substrate.identity.id} ${substrate.identity.version}` };
}

// Scale a validated patch. Returns { T, scales: {id: M}, machine: [per-element machine parameters], factors }
export function scalePatch(patch, model, substrate, { overrides = {}, inputs = {} } = {}) {
  assertPatch(patch, model);
  const env = problemEnv(model, overrides);
  const ev = evaluator(env);
  const els = patch.elements;
  const byId = new Map(els.map((e, i) => [e.id, i]));
  // values of patch inputs (settable constants)
  const inputValue = new Map();
  for (const u of patch.inputs || []) if (inputs[u.name] !== undefined) inputValue.set(u.element, inputs[u.name]);
  for (const k of Object.keys(inputs)) if (!(patch.inputs || []).some((u) => u.name === k)) throw new SubcoreError('INPUT', k, 'not an input of the patch');
  const elValue = (e) => (inputValue.has(e.id) ? inputValue.get(e.id) : e.value);
  // magnitudes, resolved through inputs where a bound is implied
  const M = new Map();
  const resolving = new Set();
  const scaleOf = (id) => {
    if (M.has(id)) return M.get(id);
    const i = byId.get(id), e = els[i], def = ELEMENTS[e.kind];
    if (resolving.has(id)) throw new SubcoreError('SCALE', `elements[${i}].max`, 'the bound depends on itself; declare max');
    resolving.add(id);
    let m;
    if (e.max !== undefined) m = e.max;
    else if (def.defaultMax) {
      const c = { inMax: (k) => scaleOf(e.inputs[k].from), ev: (v, f) => ev(f === 'value' ? elValue(e) : v, `elements[${i}].${f}`) };
      m = def.defaultMax(e, c);
    } else throw new SubcoreError('REQUIRED', `elements[${i}].max`, `a ${e.kind} declares its bound`);
    if (!(m > 0 && Number.isFinite(m))) throw new SubcoreError('SCALE', `elements[${i}].max`, `bound ${m} is not positive`);
    resolving.delete(id);
    M.set(id, m);
    return m;
  };
  for (const e of els) scaleOf(e.id);
  const weight = (e, k, i) => (e.inputs[k].weight === undefined ? 1 : ev(e.inputs[k].weight, `elements[${i}].inputs[${k}].weight`));
  // time scale
  const sp = substrateParams(substrate);
  const margin = (patch.machine && patch.machine.bandwidth_margin) || DEFAULT_MARGIN;
  const gLimit = (2 * Math.PI * sp.gbw) / margin;
  let rateMax = 0, rateAt = null;
  els.forEach((e, i) => {
    if (e.kind !== 'integrator') return;
    let r = 0;
    e.inputs.forEach((inp, k) => { r += Math.abs(weight(e, k, i)) * M.get(inp.from) / M.get(e.id); });
    if (r > rateMax) { rateMax = r; rateAt = e.id; }
  });
  const ts = patch.machine && patch.machine.time_scale;
  let T, tChoice;
  if (typeof ts === 'number') { T = ts; tChoice = 'stated by the patch'; }
  else if (rateMax === 0) { T = 1; tChoice = 'no integrator: machine time equals problem time'; }
  else { T = Number(`1e${Math.ceil(Math.log10(rateMax / gLimit) - 1e-12)}`); tChoice = `smallest power of ten with fastest gain ${rateMax}/T <= 2 pi GBW / margin = ${gLimit}`; }
  // machine parameters per element
  const machine = els.map((e, i) => {
    const def = ELEMENTS[e.kind];
    const c = {
      M: M.get(e.id), T,
      inMax: (k) => M.get(e.inputs[k].from),
      weight: (k) => weight(e, k, i),
      ev: (v, f) => ev(f === 'value' ? elValue(e) : v, `elements[${i}].${f}`),
    };
    const m = def.scale(e, c, `elements[${i}]`);
    m.id = e.id; m.kind = e.kind; m.M = M.get(e.id);
    m.src = (e.inputs || []).map((inp) => byId.get(inp.from));
    if (e.kind === 'sample_hold') m.ctl = byId.get(e.control.from);
    if (e.kind === 'integrator' && Math.abs(m.ic) > 1) m.icOverload = true;
    return m;
  });
  const gainMax = Math.max(0, ...machine.filter((m) => m.kind === 'integrator').map((m) => m.a.reduce((s, x) => s + Math.abs(x), 0)));
  const factors = {
    compiler: `anasim.compile ${COMPILER_VERSION}`,
    machine_unit: { value: 1, shown_as_volts: sp.unitVolts, evidence: sp.unitEvidence },
    time_scale: { T, meaning: 'machine seconds per problem second (tau = T t)', choice: tChoice, fastest_problem_rate: rateMax, fastest_at: rateAt,
      gain_limit: gLimit, gbw_hz: sp.gbw, gbw_evidence: sp.gbwEvidence, margin, fastest_machine_gain: gainMax },
    magnitude: els.map((e, i) => ({ id: e.id, kind: e.kind, represents: e.represents, M: M.get(e.id), declared: e.max !== undefined,
      volts_per_problem_unit: sp.unitVolts / M.get(e.id), machine: Object.fromEntries(Object.entries(machine[i]).filter(([k]) => !['id', 'kind', 'M', 'src', 'ctl', 'factors'].includes(k))),
      from: machine[i].factors })),
  };
  if (gainMax > gLimit * (1 + 1e-12) && tChoice.startsWith('stated')) factors.time_scale.warning = `fastest machine gain ${gainMax} exceeds ${gLimit}`;
  return { T, scales: Object.fromEntries(M), machine, factors, env, ev, substrate: sp };
}
