// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Node.js file access for the simulator modules (which read no files themselves): patches, the CMS-03 models
// and the analogue substrate specification from the vendored core.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYaml } from '../docs/src/core.js';
import { loadPatch } from '../docs/src/patch.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CORE = path.join(REPO, 'docs', 'vendor', 'subcore', '0.1.0');
export const PROGRAMS = path.join(REPO, 'docs', 'programs');

export const readText = (p) => fs.readFileSync(path.resolve(REPO, p), 'utf8');
export const loadModel = (id) => loadYaml(fs.readFileSync(path.join(CORE, 'spec', 'models', `${id}.yaml`), 'utf8'), `${id}.yaml`);
export const loadSubstrate = () => loadYaml(fs.readFileSync(path.join(CORE, 'spec', 'substrates', 'analogue-electronic.yaml'), 'utf8'), 'analogue-electronic.yaml');

export function loadAll(patchFile) {
  const p = path.resolve(REPO, patchFile);
  const patch = loadPatch(fs.readFileSync(p, 'utf8'), patchFile);
  const model = patch && patch.patch && patch.patch.model ? loadModel(patch.patch.model.id) : null;
  return { patch, model, substrate: loadSubstrate(), file: path.relative(REPO, p) };
}

export const PATCHES = () => fs.readdirSync(PROGRAMS).filter((f) => f.endsWith('.patch.yaml')).sort().map((f) => path.join('docs', 'programs', f));
