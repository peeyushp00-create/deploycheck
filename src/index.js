// Public API: run every deploy check on a project.

import caseCheck from './checks/case/index.js';
import envCheck from './checks/env/index.js';

export { scan as scanImports } from './checks/case/scan.js';
export { scan as scanEnv } from './checks/env/scan.js';

/**
 * Options shared by all checks. Each check reads the ones it needs.
 * @typedef {object} Options
 * @property {string[]} [ignoreDirs]            Extra folder names to skip
 * @property {Record<string, string>} [aliases] import case: extra path aliases, prefix → path
 * @property {boolean} [collisions]             import case: report names differing only by case (default true)
 * @property {string} [example]                 env: one example file for the whole project
 * @property {string[]} [ignoreVars]            env: variable names to skip (trailing * = prefix)
 * @property {boolean} [unused]                 env: report unused variables (default true)
 * @property {boolean} [git]                    env: check .env files against git (default true)
 * @property {boolean} [strict]                 Treat warnings as errors
 * @property {boolean} [color]                  Colored text output
 */

/**
 * A check plugs into the runner by implementing this shape.
 * @template R
 * @typedef {object} Check
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {(root: string, opts: Options) => R} run
 * @property {(result: R, opts: Options) => { errors: number, warnings: number }} count
 * @property {(root: string, result: R) => string | null} fix  Applies fixes, updates `result`, returns a summary
 * @property {(result: R, opts: Options) => string} text
 * @property {(result: R, opts: Options) => string} github
 */

/** All available checks, in the order they run. */
export const CHECKS = /** @type {Check<any>[]} */ ([caseCheck, envCheck]);

/**
 * @typedef {object} CheckRun
 * @property {Check<any>} check
 * @property {any} result
 * @property {number} errors
 * @property {number} warnings
 * @property {string | null} fixed  Summary of what --fix changed
 */

/**
 * Run checks on a project.
 * @param {string} root
 * @param {Options & { only?: string[], skip?: string[], fix?: boolean }} [opts]
 * @returns {{ runs: CheckRun[], errors: number, warnings: number }}
 */
export function runChecks(root, opts = {}) {
  const selected = CHECKS.filter(
    (c) => (!opts.only?.length || opts.only.includes(c.id)) && !opts.skip?.includes(c.id),
  );
  /** @type {CheckRun[]} */
  const runs = [];
  for (const check of selected) {
    const result = check.run(root, opts);
    const fixed = opts.fix ? check.fix(root, result) : null;
    runs.push({ check, result, fixed, ...check.count(result, opts) });
  }
  return {
    runs,
    errors: runs.reduce((n, r) => n + r.errors, 0),
    warnings: runs.reduce((n, r) => n + r.warnings, 0),
  };
}
