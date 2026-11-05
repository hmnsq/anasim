// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// P11.1, T-50: every patch validates (JSON Schema 2020-12 and the graph checks), there is a patch for every
// CMS-03 model, and the planted defects are refused with their codes and paths: an algebraic loop without an
// integrator (two forms), an unconnected input (two forms) and an input naming no element.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { harness } from './lib.mjs';
import { REPO, CORE, PATCHES, loadAll } from '../tools/load.mjs';
import { checkPatch } from '../docs/src/patch.js';

const H = harness('P11.1_patches');
const schemaRun = (files) => {
  try { execFileSync('python3', ['tools/validate_patches.py', '--json', '.cache/tmp/schema.json', ...files], { cwd: REPO, stdio: 'pipe' }); } catch (e) { /* exit 1 when a file is invalid */ }
  return JSON.parse(fs.readFileSync(path.join(REPO, '.cache/tmp/schema.json'), 'utf8')).results;
};
fs.mkdirSync(path.join(REPO, '.cache/tmp'), { recursive: true });

// valid patches
const patches = PATCHES();
const schema = schemaRun(patches);
const covered = new Set();
for (const f of patches) {
  const { patch, model } = loadAll(f);
  const errs = checkPatch(patch, model);
  covered.add(patch.patch.model.id);
  H.check(`valid ${f}`, errs.length === 0 && schema[f].length === 0, {
    summary: `${patch.elements.length} elements; graph check ${errs.length} error(s), schema ${schema[f].length} error(s)`,
    graph_errors: errs, schema_errors: schema[f],
  });
}
const models = fs.readdirSync(path.join(CORE, 'spec', 'models')).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, '')).sort();
const missing = models.filter((m) => !covered.has(m));
H.check('a patch for every CMS-03 model', missing.length === 0, { summary: `${models.length} models; missing: ${missing.join(', ') || 'none'}`, models });

// planted defects
const defects = fs.readdirSync(path.join(REPO, 'tests', 'defects')).filter((f) => f.endsWith('.patch.yaml')).sort().map((f) => path.join('tests', 'defects', f));
const dschema = schemaRun(defects);
const planted = {};
for (const f of defects) {
  const { patch, model } = loadAll(f);
  const want = patch.patch.planted_defect;
  const errs = checkPatch(patch, model);
  const hit = errs.filter((e) => e.code === want);
  planted[f] = { planted: want, refused_by_graph_check: errs, refused_by_schema: dschema[f] };
  H.check(`refused ${f}`, hit.length > 0, { summary: `planted ${want}; refused with ${errs.map((e) => `${e.code} at ${e.path}: ${e.message}`).join('; ') || 'nothing (NOT REFUSED)'}; schema: ${dschema[f].length ? dschema[f].join('; ') : 'accepts (graph check needed)'}` });
}
H.extra.planted = planted;
H.extra.defect_kinds = [...new Set(Object.values(planted).map((p) => p.planted))];
H.check('both required defect kinds planted', ['ALGEBRAIC_LOOP', 'UNCONNECTED'].every((k) => H.extra.defect_kinds.includes(k)), { summary: H.extra.defect_kinds.join(', ') });
H.finish();
