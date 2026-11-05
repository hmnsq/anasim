// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Patches (ANA-01, P11.1): loading and validation. The JSON Schema spec/patch.schema.json states the form;
// this module makes the same structural checks in the browser and Node.js, and the graph checks a schema
// cannot state:
//   UNCONNECTED      an input with no source named
//   UNKNOWN_ELEMENT  an input, control, output or patch input naming no element
//   ARITY            the wrong number of inputs for the element kind
//   ALGEBRAIC_LOOP   a cycle of elements with no integrator in it (Guidelines 7: an error, never solved)
//   DUPLICATE        two elements whose names differ only by case (SPICE ignores case)
//   PARSE / UNBOUND  an expression that does not parse, or reads a name the model does not declare
// Every error carries a code and the path of the field that caused it.

import { SubcoreError, loadYaml, parse, identifiers, INDEPENDENT } from './core.js';
import { ELEMENTS, KINDS } from './elements/index.js';

export const PATCH_FORMAT = 'anasim-patch 1';
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TOP = new Set(['_notice', 'format', 'patch', 'machine', 'inputs', 'elements', 'outputs', 'run', 'notes']);
const EL_KEYS = new Set(['id', 'kind', 'represents', 'max', 'inputs', 'ic', 'k', 'value', 'low', 'high', 'levels', 'breakpoints', 'control', 'label', 'position']);
const REQUIRED = {
  integrator: ['inputs', 'ic', 'max', 'represents'],
  summer: ['inputs', 'max', 'represents'],
  inverter: ['inputs', 'represents'],
  coefficient: ['inputs', 'k', 'represents'],
  multiplier: ['inputs', 'max', 'represents'],
  comparator: ['inputs', 'levels', 'max', 'represents'],
  limiter: ['inputs', 'low', 'high', 'represents'],
  function_generator: ['inputs', 'breakpoints', 'max', 'represents'],
  sample_hold: ['inputs', 'control', 'represents'],
  constant: ['value', 'represents'],
};

export function loadPatch(text, path = '') {
  const p = loadYaml(text, path);
  return p;
}

// Names a patch expression may read: the model's parameters, initial values <state>_0, and for the
// represents expressions also its states, t, and (function models) the independent variable.
export function modelNames(model) {
  const params = (model.parameters || []).map((p) => p.name);
  const states = (model.states || []).map((s) => s.name);
  const coeff = new Set([...params, ...states.map((s) => `${s}_0`)]);
  const rep = new Set([...coeff, ...states, INDEPENDENT]);
  if (model.kind === 'function' && model.independent) rep.add(model.independent.name);
  // a discrete model is stated by its reference function, not by equations: represents is descriptive there
  return { coeff, rep: model.kind === 'discrete' ? null : rep };
}

// Returns a list of { code, path, message }; empty when the patch is valid. model is the computational model
// the patch realises (its parameters bind the expressions); without it, only names are not checked.
export function checkPatch(p, model = null) {
  const errs = [];
  const err = (code, path, message) => errs.push({ code, path, message });
  if (!p || typeof p !== 'object' || Array.isArray(p)) { err('PATCH', '', 'a patch is a mapping'); return errs; }
  for (const k of Object.keys(p)) if (!TOP.has(k)) err('PATCH', k, `unknown key '${k}'`);
  if (typeof p._notice !== 'string' || !p._notice.startsWith('© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.')) err('NOTICE', '_notice', 'the copyright notice is missing');
  if (p.format !== PATCH_FORMAT) err('PATCH', 'format', `expected '${PATCH_FORMAT}'`);
  const meta = p.patch || {};
  if (!meta.id || !NAME.test(meta.id)) err('PATCH', 'patch.id', 'missing or not a name');
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(meta.version || ''))) err('PATCH', 'patch.version', 'a semantic version is required');
  if (!meta.model || !meta.model.id) err('PATCH', 'patch.model', 'the patch names the computational model it realises');
  if (model && meta.model && (meta.model.id !== model.identity.id || meta.model.version !== model.identity.version)) {
    err('MODEL', 'patch.model', `patch is for ${meta.model.id} ${meta.model.version}, model given is ${model.identity.id} ${model.identity.version}`);
  }
  const names = model ? modelNames(model) : null;
  const exprCheck = (v, path, allowed) => {
    if (typeof v === 'number') { if (!Number.isFinite(v)) err('VALUE', path, 'not finite'); return; }
    if (typeof v !== 'string' || v === '') { err('VALUE', path, 'a number or an expression is required'); return; }
    try {
      const ast = parse(v);
      if (allowed) for (const n of identifiers(ast)) if (!allowed.has(n)) err('UNBOUND', path, `name '${n}' is not declared by the model`);
    } catch (e) { err(e.code || 'PARSE', path, e.message); }
  };
  const els = Array.isArray(p.elements) ? p.elements : [];
  if (!Array.isArray(p.elements) || els.length === 0) err('PATCH', 'elements', 'a patch has at least one element');
  const index = new Map(), lower = new Map();
  els.forEach((e, i) => {
    const path = `elements[${i}]`;
    if (!e || typeof e !== 'object') { err('PATCH', path, 'an element is a mapping'); return; }
    if (!NAME.test(e.id || '')) { err('NAME', `${path}.id`, `'${e.id}' is not a valid name`); return; }
    const low = e.id.toLowerCase();
    if (lower.has(low)) err('DUPLICATE', `${path}.id`, `'${e.id}' clashes with ${lower.get(low)} (names differ by more than case)`);
    else lower.set(low, `elements[${index.size}] '${e.id}'`);
    index.set(e.id, i);
  });
  els.forEach((e, i) => {
    const path = `elements[${i}]`;
    if (!e || typeof e !== 'object' || !NAME.test(e.id || '')) return;
    for (const k of Object.keys(e)) if (!EL_KEYS.has(k)) err('PATCH', `${path}.${k}`, `unknown key '${k}'`);
    const def = ELEMENTS[e.kind];
    if (!def) { err('KIND', `${path}.kind`, `unknown element kind '${e.kind}' (known: ${KINDS.join(', ')})`); return; }
    for (const r of REQUIRED[e.kind]) if (e[r] === undefined) err('REQUIRED', `${path}.${r}`, `a ${e.kind} needs '${r}'`);
    if (e.max !== undefined && !(typeof e.max === 'number' && e.max > 0 && Number.isFinite(e.max))) err('VALUE', `${path}.max`, 'a scale bound is a positive number');
    const inputs = e.inputs === undefined ? [] : e.inputs;
    if (!Array.isArray(inputs)) { err('PATCH', `${path}.inputs`, 'a list'); return; }
    if (inputs.length < def.minInputs || inputs.length > def.maxInputs) {
      err(inputs.length < def.minInputs ? 'UNCONNECTED' : 'ARITY', `${path}.inputs`,
        `a ${e.kind} takes ${def.minInputs}${def.maxInputs === Infinity ? ' or more' : def.maxInputs === def.minInputs ? '' : ` to ${def.maxInputs}`} input(s), found ${inputs.length}`);
    }
    const conn = (inp, ipath) => {
      if (!inp || typeof inp !== 'object' || inp.from === undefined || inp.from === null || inp.from === '') {
        err('UNCONNECTED', ipath, 'input is not connected to any element');
        return;
      }
      if (!index.has(inp.from)) err('UNKNOWN_ELEMENT', `${ipath}.from`, `no element named '${inp.from}'`);
      for (const k of Object.keys(inp)) if (k !== 'from' && k !== 'weight') err('PATCH', `${ipath}.${k}`, `unknown key '${k}'`);
      if (inp.weight !== undefined) {
        if (!def.weighted) err('PATCH', `${ipath}.weight`, `a ${e.kind} input carries no weight`);
        exprCheck(inp.weight, `${ipath}.weight`, names && names.coeff);
      }
    };
    inputs.forEach((inp, k) => conn(inp, `${path}.inputs[${k}]`));
    if (e.kind === 'sample_hold' && e.control !== undefined) conn(e.control, `${path}.control`);
    for (const f of ['ic', 'k', 'value', 'low', 'high']) if (e[f] !== undefined) exprCheck(e[f], `${path}.${f}`, names && names.coeff);
    if (e.levels) { exprCheck(e.levels.below, `${path}.levels.below`, names && names.coeff); exprCheck(e.levels.above, `${path}.levels.above`, names && names.coeff); }
    if (e.represents !== undefined) exprCheck(e.represents, `${path}.represents`, names && names.rep);
    if (e.kind === 'function_generator' && Array.isArray(e.breakpoints)) {
      e.breakpoints.forEach((b, k) => {
        if (!Array.isArray(b) || b.length !== 2 || !b.every((x) => typeof x === 'number' && Number.isFinite(x))) err('VALUE', `${path}.breakpoints[${k}]`, 'a breakpoint is [x, y]');
        else if (k > 0 && !(b[0] > e.breakpoints[k - 1][0])) err('VALUE', `${path}.breakpoints[${k}]`, 'breakpoint x values increase strictly');
      });
    }
  });
  // outputs and inputs
  (Array.isArray(p.outputs) ? p.outputs : []).forEach((o, k) => {
    if (!o || !index.has(o.element)) err('UNKNOWN_ELEMENT', `outputs[${k}].element`, `no element named '${o && o.element}'`);
    if (o && o.expression !== undefined) exprCheck(o.expression, `outputs[${k}].expression`, names && names.rep);
  });
  if (!Array.isArray(p.outputs) || p.outputs.length === 0) err('PATCH', 'outputs', 'a patch names at least one output');
  (p.inputs || []).forEach((u, k) => {
    if (!index.has(u.element)) err('UNKNOWN_ELEMENT', `inputs[${k}].element`, `no element named '${u.element}'`);
    else if (els[index.get(u.element)].kind !== 'constant') err('PATCH', `inputs[${k}].element`, 'a patch input names a constant element');
  });
  if (p.run && p.run.modes) {
    let last = -1;
    p.run.modes.forEach((m, k) => {
      if (!['ic', 'operate', 'hold'].includes(m.mode)) err('MODE', `run.modes[${k}].mode`, `unknown mode '${m.mode}'`);
      if (m.until !== undefined) { if (!(m.until >= last)) err('MODE', `run.modes[${k}].until`, 'mode times do not decrease'); last = m.until; }
    });
  }
  // algebraic loops: edges from each input source to the element, except into integrators (whose outputs are
  // states). A strongly connected component with more than one element, or a self-loop, is a loop.
  if (!errs.some((e) => e.code === 'UNKNOWN_ELEMENT' || e.code === 'UNCONNECTED' || e.code === 'KIND')) {
    const loops = algebraicLoops(els);
    for (const loop of loops) {
      err('ALGEBRAIC_LOOP', `elements[${index.get(loop[0])}]`, `algebraic loop without an integrator: ${[...loop, loop[0]].join(' -> ')}`);
    }
  }
  return errs;
}

// Dependencies of an element's output on other outputs at the same instant (integrators have none).
export function algebraicDeps(e) {
  if (e.kind === 'integrator') return [];
  const d = (e.inputs || []).map((i) => i.from);
  if (e.kind === 'sample_hold' && e.control) d.push(e.control.from);
  return d;
}

// Tarjan's strongly connected components over the algebraic dependency graph.
export function algebraicLoops(els) {
  const ids = els.map((e) => e.id);
  const deps = new Map(els.map((e) => [e.id, algebraicDeps(e)]));
  let idx = 0;
  const num = new Map(), low = new Map(), on = new Set(), stack = [], loops = [];
  const visit = (v) => {
    num.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v);
    for (const w of deps.get(v) || []) {
      if (!num.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), num.get(w)));
    }
    if (low.get(v) === num.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1 || (deps.get(v) || []).includes(v)) loops.push(comp.reverse());
    }
  };
  for (const v of ids) if (!num.has(v)) visit(v);
  return loops;
}

// Dependency order for evaluating the algebraic elements (integrators first, as sources).
export function evaluationOrder(els) {
  const byId = new Map(els.map((e) => [e.id, e]));
  const done = new Set(), order = [];
  const visit = (id, trail) => {
    if (done.has(id)) return;
    if (trail.has(id)) throw new SubcoreError('ALGEBRAIC_LOOP', id, 'algebraic loop without an integrator');
    trail.add(id);
    for (const d of algebraicDeps(byId.get(id))) visit(d, trail);
    trail.delete(id);
    done.add(id);
    order.push(id);
  };
  for (const e of els) if (e.kind === 'integrator') { done.add(e.id); order.push(e.id); }
  for (const e of els) visit(e.id, new Set());
  return order;
}

export function assertPatch(p, model) {
  const errs = checkPatch(p, model);
  if (errs.length) throw new SubcoreError(errs[0].code, errs[0].path, errs[0].message, errs);
}
