#!/usr/bin/env node
// deploycheck command-line interface.

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CHECKS, runChecks } from './index.js';
import { colors } from './colors.js';

const CHECK_LIST = CHECKS.map((c) => `  ${c.id.padEnd(6)} ${c.description}`).join('\n');

const HELP = `deploycheck: catch the bugs that work on your laptop and break when you deploy

Usage
  deploycheck [dir] [options]

Checks
${CHECK_LIST}

General options
  --fix                 Fix everything that can be fixed automatically
  --only <checks>       Run only these checks, e.g. --only env  (comma separated)
  --skip <checks>       Skip these checks, e.g. --skip case
  --ignore <folder>     Extra folder name to skip (repeatable)
  --strict              Treat warnings as errors
  --format <type>       text (default), json, or github (auto in GitHub Actions)
  --no-color            Disable colors
  -v, --version         Print version
  -h, --help            Show this help

Import case options
  --alias <key=path>    Extra path alias, e.g. --alias ~=src  (repeatable)
  --no-collisions       Don't report files whose names differ only by case

Environment variable options
  --example <file>      Use one example file for the whole project
  --ignore-var <name>   Variable to skip, e.g. --ignore-var SENTRY_*  (repeatable)
  --no-unused           Don't report unused variables
  --no-git              Skip the .gitignore / committed .env checks

Exit codes
  0  ready to deploy   1  problems found   2  invalid usage

Examples
  npx deploycheck
  npx deploycheck --fix
  npx deploycheck ./backend --only env`;

/** @param {string[]} argv */
export function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        fix: { type: 'boolean' },
        only: { type: 'string', multiple: true },
        skip: { type: 'string', multiple: true },
        ignore: { type: 'string', multiple: true },
        strict: { type: 'boolean' },
        format: { type: 'string' },
        'no-color': { type: 'boolean' },
        alias: { type: 'string', multiple: true },
        'no-collisions': { type: 'boolean' },
        example: { type: 'string' },
        'ignore-var': { type: 'string', multiple: true },
        'no-unused': { type: 'boolean' },
        'no-git': { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    return usageError(/** @type {Error} */ (err).message);
  }
  const { values, positionals } = parsed;

  if (values.help) { console.log(HELP); return 0; }
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
    return 0;
  }

  const ids = CHECKS.map((c) => c.id);
  const list = (/** @type {string[] | undefined} */ v) => (v ?? []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  const only = list(values.only);
  const skip = list(values.skip);
  const unknown = [...only, ...skip].find((id) => !ids.includes(id));
  if (unknown) return usageError(`unknown check "${unknown}" (available: ${ids.join(', ')})`);

  /** @type {Record<string, string>} */
  const aliases = {};
  for (const pair of values.alias ?? []) {
    const eq = pair.indexOf('=');
    if (eq < 1) return usageError(`--alias expects key=path, got "${pair}"`);
    aliases[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  const format = values.format ?? (process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'text');
  if (!['text', 'json', 'github'].includes(format)) return usageError(`unknown --format "${format}" (use text, json or github)`);

  const color = !values['no-color'] && !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR !== undefined);
  const opts = {
    only,
    skip,
    fix: values.fix,
    ignoreDirs: values.ignore,
    strict: values.strict,
    aliases,
    collisions: !values['no-collisions'],
    example: values.example,
    ignoreVars: values['ignore-var'],
    unused: !values['no-unused'],
    git: !values['no-git'],
    color,
  };

  const root = path.resolve(positionals[0] ?? '.');
  const outcome = runChecks(root, opts);

  if (format === 'json') {
    const checks = Object.fromEntries(
      outcome.runs.map((r) => [r.check.id, { errors: r.errors, warnings: r.warnings, fixed: r.fixed, ...stripOffsets(r.result) }]),
    );
    console.log(JSON.stringify({ ok: outcome.errors === 0, errors: outcome.errors, warnings: outcome.warnings, checks }, null, 2));
    return outcome.errors ? 1 : 0;
  }

  const c = colors(color);
  const out = [];
  if (format === 'github') {
    for (const r of outcome.runs) {
      const annotations = r.check.github(r.result, opts);
      if (annotations) out.push(annotations);
    }
  }
  for (const r of outcome.runs) {
    out.push(c.bold(`▸ ${r.check.title}`));
    if (r.fixed) out.push(c.green(r.fixed));
    out.push(r.check.text(r.result, opts));
    out.push('');
  }

  const names = outcome.runs.length === 1 ? 'the check' : `all ${outcome.runs.length} checks`;
  if (outcome.errors) {
    const detail = outcome.runs.filter((r) => r.errors).map((r) => `${r.check.title.toLowerCase()}: ${r.errors}`).join(', ');
    out.push(c.red(c.bold(`✖ Not ready to deploy: ${outcome.errors} problem${outcome.errors === 1 ? '' : 's'}`)) + c.dim(` (${detail})`));
  } else {
    const warn = outcome.warnings ? c.yellow(` with ${outcome.warnings} warning${outcome.warnings === 1 ? '' : 's'}`) : '';
    out.push(c.green(c.bold(`✔ Ready to deploy: ${names} passed`)) + warn);
  }
  console.log(out.join('\n'));
  return outcome.errors ? 1 : 0;
}

/** @param {string} message */
function usageError(message) {
  console.error(`deploycheck: ${message}\nRun "deploycheck --help" for usage.`);
  return 2;
}

/**
 * Drop internal file offsets from JSON output.
 * @param {any} result
 */
function stripOffsets(result) {
  if (!Array.isArray(result.issues)) return result;
  return { ...result, issues: result.issues.map((/** @type {{ start: number, end: number }} */ { start, end, ...rest }) => rest) };
}

process.exitCode = run(process.argv.slice(2));
