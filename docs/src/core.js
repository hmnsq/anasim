// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The one place that names the vendored shared core (hmnsq/subcore, docs/vendor/subcore/<version>/). Every
// other module imports the core through here, so re-vendoring a new core version changes one line.

export { SubcoreError, notImplemented } from '../vendor/subcore/0.1.0/src/errors.js';
export { parse, compile, evaluate, identifiers, substitute, toText, toModelica, toSpice, astEqual, roundTrip, INDEPENDENT } from '../vendor/subcore/0.1.0/src/expr.js';
export { rk4Step, rk4Work, integrateFixed, dopri54, grid } from '../vendor/subcore/0.1.0/src/solve.js';
export { bisect, integrateWithEvents } from '../vendor/subcore/0.1.0/src/events.js';
export { createRng, SplitMix64, Xoshiro128ss } from '../vendor/subcore/0.1.0/src/prng.js';
export { writeTrace, parseTrace, compareTraces, fmt17 } from '../vendor/subcore/0.1.0/src/trace.js';
export { parseVectors } from '../vendor/subcore/0.1.0/src/vectors.js';
export { loadYaml, checkModel, compileModel, analyticSolution, compileFunctions, specHash } from '../vendor/subcore/0.1.0/src/spec.js';
export { sha256Hex, canonicalJson } from '../vendor/subcore/0.1.0/src/hash.js';
export { toSI } from '../vendor/subcore/0.1.0/src/units.js';
export { CORE_VERSION } from '../vendor/subcore/0.1.0/src/cli.js';

export const CORE_PATH = 'vendor/subcore/0.1.0';
