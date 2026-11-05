// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The element catalogue (Guidelines 9.1): one module per element kind.

import integrator from './integrator.js';
import summer from './summer.js';
import inverter from './inverter.js';
import coefficient from './coefficient.js';
import multiplier from './multiplier.js';
import comparator from './comparator.js';
import limiter from './limiter.js';
import function_generator from './function_generator.js';
import sample_hold from './sample_hold.js';
import constant from './constant.js';

export const ELEMENTS = Object.freeze({ integrator, summer, inverter, coefficient, multiplier, comparator, limiter, function_generator, sample_hold, constant });
export const KINDS = Object.freeze(Object.keys(ELEMENTS));
