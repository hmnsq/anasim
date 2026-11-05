// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Runs a gate on a planted defect and inverts its verdict: exits 0 only when the command exits non-zero (the
// gate refused the defect), 1 when it exits 0 (the gate let the defect through). Output passes through.
//   node tools/expect_fail.mjs -- <command> <args...>
import { spawnSync } from 'node:child_process';
const i = process.argv.indexOf('--');
const cmd = process.argv.slice(i + 1);
const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit' });
const code = r.status === null ? 128 : r.status;
console.log(`expect_fail: the gate exited ${code}; ${code !== 0 ? 'the planted defect was refused' : 'THE PLANTED DEFECT WAS NOT REFUSED'}`);
process.exit(code !== 0 ? 0 : 1);
