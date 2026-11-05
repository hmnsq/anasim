// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Vendors the shared core hmnsq/subcore into docs/vendor/subcore/<version>/ (Guidelines 4.1 and 4.4).
//   node tools/vendor_subcore.mjs [--from ../subcore] [--check]
// Tracked files are taken from the core's committed tree (git archive of HEAD), never from its working tree,
// so the copy is named by one commit. Files the core has not committed yet but this simulator needs (the
// analogue substrate specification) are copied from the working tree and marked "untracked" in PROVENANCE
// with their sha256; they are re-vendored once the core commits them.
// The vendored copy is never edited. --check recomputes the hashes and compares them with PROVENANCE.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './record.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const SUB = path.resolve(REPO, opt('--from', '../subcore'));
const CHECK = args.includes('--check');

// core path -> vendored path (relative to docs/vendor/subcore/<version>/)
const TRACKED = [
  ['LICENSE', 'LICENCE'],
  ['VERSION', 'VERSION'],
  ['docs/API.md', 'API.md'],
  ['docs/src', 'src'],
  ['docs/vendor/js-yaml/5.5.0', 'vendor/js-yaml/5.5.0'],
  ['spec/models', 'spec/models'],
  ['spec/grammar', 'spec/grammar'],
  ['spec/substrates/analogue-electronic.yaml', 'spec/substrates/analogue-electronic.yaml'],
  ['spec/schema', 'spec/schema'],
  ['vectors', 'vectors'],
];

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const git = (...a) => execFileSync('git', ['-C', SUB, ...a], { encoding: 'utf8' }).trim();

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base)); else out.push(path.relative(base, p));
  }
  return out;
}

const commit = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
const version = git('show', 'HEAD:VERSION');
const tracked = new Set(git('ls-tree', '-r', '--name-only', 'HEAD').split('\n'));
const dest = path.join(REPO, 'docs', 'vendor', 'subcore', version);

// file list: [corePath, vendoredPath, origin]
const files = [];
for (const [src, dst] of TRACKED) {
  const inTree = [...tracked].filter((f) => f === src || f.startsWith(src + '/'));
  if (inTree.length) {
    for (const f of inTree) files.push([f, dst + f.slice(src.length), 'commit']);
  } else if (fs.existsSync(path.join(SUB, src))) {
    const abs = path.join(SUB, src);
    const list = fs.statSync(abs).isDirectory() ? walk(abs).map((r) => path.join(src, r)) : [src];
    for (const f of list) files.push([f, dst + f.slice(src.length), 'untracked']);
  } else {
    console.error(`vendor_subcore: ${src} is neither committed nor present in ${SUB}; skipped`);
  }
}

const content = (f, origin) => (origin === 'commit'
  ? execFileSync('git', ['-C', SUB, 'show', `HEAD:${f}`])
  : fs.readFileSync(path.join(SUB, f)));

const lines = files.map(([f, d, o]) => [sha256(content(f, o)), d, o]);
const prov = [
  '© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. (this PROVENANCE file only)',
  'SPDX-License-Identifier: CC0-1.0 (this PROVENANCE file only; the vendored files keep their own notices)',
  '',
  'library: subcore (hmnsq/subcore, the shared web core)',
  `version: ${version}`,
  'licence: GPL-3.0-or-later (LICENCE is a byte copy of the core\'s LICENSE); js-yaml under vendor/ is MIT',
  `upstream: ${SUB} (local repository of hmnsq/subcore in this build)`,
  `commit: ${commit}`,
  `tree: ${tree}`,
  'generator: tools/vendor_subcore.mjs',
  'rule: never edited here; re-vendored when the core changes',
  `untracked: ${lines.filter((l) => l[2] === 'untracked').length} file(s) copied from the core's working tree because they are not committed at this commit`,
  '',
  'sha256 of every vendored file (path relative to this folder) and its origin (commit or untracked):',
  ...lines.map(([h, d, o]) => `${h}  ${d}  ${o}`),
  '',
].join('\n');

if (CHECK) {
  const have = fs.readFileSync(path.join(dest, 'PROVENANCE'), 'utf8');
  let bad = 0;
  for (const l of have.split('\n')) {
    const m = /^([0-9a-f]{64})  (\S+)  (commit|untracked)$/.exec(l);
    if (!m) continue;
    const p = path.join(dest, m[2]);
    const h = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : 'missing';
    if (h !== m[1]) { console.error(`vendor_subcore --check: ${m[2]}: ${h} != ${m[1]}`); bad++; }
  }
  const ok = have === prov;
  console.log(`vendor_subcore --check: ${bad} file(s) differ from PROVENANCE; the core ${ok ? 'has not changed' : 'HAS CHANGED since vendoring (re-vendor)'} (commit ${commit})`);
  process.exit(bad ? 1 : 0);
}

fs.rmSync(dest, { recursive: true, force: true });
for (const [f, d, o] of files) {
  const p = path.join(dest, d);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content(f, o));
}
fs.writeFileSync(path.join(dest, 'PROVENANCE'), prov);
console.log(`vendor_subcore: ${files.length} files from ${commit} into ${path.relative(REPO, dest)}`);
