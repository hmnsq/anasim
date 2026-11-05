// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The simulator's programmatic surface, shared by the page, the Web Worker and Node.js (WEB-06). It reads no
// files itself: callers pass texts or parsed documents, so the same module runs everywhere unchanged.
//
//   compilePatch(patch, model, substrate, { overrides, inputs, check }) -> compiled
//   runIdeal(compiled, { h, t1, every, modes, events, cancel }) -> run (machine and problem units)
//   traceText(compiled, run, { units: 'problem' | 'machine', level, seed }) -> CSV trace (Guidelines 13)

import { SubcoreError, writeTrace, sha256Hex, canonicalJson, specHash, dopri54, grid } from './core.js';
import { scalePatch, COMPILER_VERSION } from './compile/scale.js';
import { assembleIdeal } from './compile/assemble.js';
import { checkAgainstModel } from './compile/predict.js';
import { runSystem, SIM_VERSION } from './sim.js';

export const ANASIM_VERSION = '0.1.0';

export function horizonOf(patch, model) {
  const run = patch.run || {};
  const t1 = run.t1 !== undefined ? run.t1 : model.kind === 'function' ? (model.domain.to - model.domain.from) : (model.horizon && model.horizon.t1);
  const h = run.h !== undefined ? run.h : (model.solver_defaults && model.solver_defaults.rk4_step) || (model.kind === 'function' ? t1 / ((model.domain.points - 1) * 10) : undefined);
  if (!(t1 > 0) || !(h > 0)) throw new SubcoreError('RUN', 'run', 'no horizon or step: state run.t1 and run.h');
  return { t1, h };
}

export function compilePatch(patch, model, substrate, { overrides = {}, inputs = {}, check = true } = {}) {
  const scaled = scalePatch(patch, model, substrate, { overrides, inputs });
  const sys = assembleIdeal(scaled, patch);
  const { t1, h } = horizonOf(patch, model);
  let modelCheck = null;
  if (check && (model.kind === 'continuous' || model.kind === 'function')) {
    modelCheck = checkAgainstModel(patch, model, scaled, { t1, h });
    if (modelCheck.errors.length) {
      const e = modelCheck.errors[0];
      throw new SubcoreError(e.code, e.path, e.message, modelCheck.errors);
    }
  }
  return {
    patch, model, substrate, scaled, sys, T: scaled.T, t1, h, modelCheck,
    patchHash: specHash(patch), modelHash: specHash(model),
    parameterHash: sha256Hex(canonicalJson({ env: scaled.env, inputs, T: scaled.T, scales: scaled.scales })),
  };
}

// Problem-time modes from the patch (until in problem time) to machine time.
export function machineModes(compiled, modes) {
  const list = modes || (compiled.patch.run && compiled.patch.run.modes) || [{ mode: 'operate' }];
  return list.map((m) => (m.until === undefined ? { mode: m.mode } : { mode: m.mode, until: m.until * compiled.T }));
}

// An ideal run over the problem horizon with the problem step h; machine step T h.
export function runIdeal(compiled, { h = compiled.h, t1 = compiled.t1, every = 1, modes, events = true, cancel } = {}) {
  const steps = Math.round(t1 / h);
  if (Math.abs(steps * h - t1) > 1e-9 * Math.max(1, t1)) throw new SubcoreError('RUN', 'h', `the horizon ${t1} is not a whole number of steps of ${h}`);
  const run = runSystem(compiled.sys, { h: h * compiled.T, steps, every, modes: machineModes(compiled, modes), events, cancel });
  return toProblem(compiled, run, { level: 'ideal', h, solver: 'rk4' });
}

// An adaptive accuracy run (Dormand-Prince 5(4) from the core) in operate mode, with output at points + 1
// equally spaced problem times. Only for patches without discrete elements (comparators, sample-and-holds),
// whose switching needs located events; overloads are not located in adaptive runs.
export function runIdealAdaptive(compiled, { rtol = 1e-10, atol = 1e-12, points = 200, t1 = compiled.t1 } = {}) {
  const sys = compiled.sys;
  if (compiled.scaled.machine.some((m) => m.kind === 'comparator' || m.kind === 'sample_hold')) {
    throw new SubcoreError('RUN', 'solver', 'adaptive runs need a patch without comparators or sample-and-holds');
  }
  const d = sys.d0();
  const T = compiled.T;
  const res = dopri54({ f: sys.f('operate', d), t0: 0, y0: sys.y0, tOut: grid(0, t1 * T, points), rtol, atol, names: sys.names });
  const out = new Float64Array(sys.n);
  const run = { t: res.t, rows: res.y.map((y) => Float64Array.from(sys.outputs(y, d, out))), events: [], stats: res.stats };
  return toProblem(compiled, run, { level: 'ideal', solver: 'dopri54', rtol, atol });
}

// Undo the scale factors: problem time t = tau / T, problem value x = M X.
export function toProblem(compiled, run, info) {
  const M = compiled.scaled.machine.map((m) => m.M);
  const T = compiled.T;
  const t = run.t.map((tau) => tau / T);
  const values = run.rows.map((r) => Float64Array.from(r, (x, i) => x * M[i]));
  const events = run.events.map((e) => ({ ...e, tProblem: e.t / T }));
  return { ...info, columns: compiled.sys.columns, machine: { t: run.t, rows: run.rows }, t, values, events, stats: run.stats };
}

// The patch outputs (by output name) from a run, problem units: { names, rows: [t, ...] }
export function outputRows(compiled, run) {
  const idx = new Map(compiled.sys.columns.map((c, i) => [c, i]));
  const outs = compiled.patch.outputs.map((o) => idx.get(o.element));
  return { names: compiled.patch.outputs.map((o) => o.name), rows: run.t.map((t, k) => [t, ...outs.map((i) => run.values[k][i])]) };
}

export function traceText(compiled, run, { units = 'problem', columns = 'outputs', seed } = {}) {
  const meta = {
    model: `${compiled.model.identity.id} ${compiled.model.identity.version}`,
    model_sha256: compiled.modelHash,
    substrate: compiled.scaled.substrate.substrate,
    parameter_sha256: compiled.parameterHash,
    solver: run.solver || 'rk4',
    step: run.h !== undefined ? String(run.h) : undefined,
    seed: seed === undefined ? 'none' : String(seed),
    generator: `anasim ${ANASIM_VERSION} (compile ${COMPILER_VERSION}, sim ${SIM_VERSION})`,
    extra: { patch: `${compiled.patch.patch.id} ${compiled.patch.patch.version}`, patch_sha256: compiled.patchHash, level: run.level, units, time_scale: String(compiled.T) },
  };
  if (columns === 'outputs' && units === 'problem') {
    const o = outputRows(compiled, run);
    return writeTrace(meta, ['t', ...o.names], o.rows);
  }
  const tcol = units === 'problem' ? run.t : run.machine.t;
  const rows = units === 'problem' ? run.values : run.machine.rows;
  return writeTrace(meta, [units === 'problem' ? 't' : 'tau', ...run.columns], tcol.map((t, k) => [t, ...rows[k]]));
}

// A network without integrators (or at its initial state): discrete states settled from their inputs, every
// element evaluated once in dependency order. Returns problem-unit values by element id, the patch outputs, and
// the elements beyond the machine unit.
export function evaluateStatic(compiled) {
  const sys = compiled.sys;
  const d = sys.d0();
  const out = sys.outputs(sys.y0, d, new Float64Array(sys.n));
  const M = compiled.scaled.machine.map((m) => m.M);
  const byId = Object.fromEntries(sys.columns.map((c, i) => [c, out[i] * M[i]]));
  return {
    values: byId,
    outputs: Object.fromEntries(compiled.patch.outputs.map((o) => [o.name, byId[o.element]])),
    overloads: sys.columns.filter((c, i) => Math.abs(out[i]) > 1),
  };
}

// Set patch inputs (constants with declared bounds) on a compiled patch without recompiling it: the machine
// value of each named constant becomes value / M. A constant whose bound is implied by its value needs a
// recompilation and is refused here.
export function setInputs(compiled, inputs) {
  const p = compiled.patch;
  for (const [name, value] of Object.entries(inputs)) {
    const u = (p.inputs || []).find((x) => x.name === name);
    if (!u) throw new SubcoreError('INPUT', name, 'not an input of the patch');
    const i = p.elements.findIndex((e) => e.id === u.element);
    if (p.elements[i].max === undefined) throw new SubcoreError('INPUT', name, `constant ${u.element} has no declared bound; recompile with the input instead`);
    const m = compiled.scaled.machine[i];
    m.v = value / m.M;
  }
  return compiled;
}
