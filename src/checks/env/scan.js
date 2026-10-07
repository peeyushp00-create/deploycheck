// Public API: compare the environment variables a project uses with the ones
// documented in its .env.example, and check real .env files stay out of git.

import fs from 'node:fs';
import path from 'node:path';
import { findEnvUsage } from './usage.js';
import { EXAMPLE_FILES, isSecretEnvFile, parseEnvKeys } from './envfile.js';
import { gitStatus } from './git.js';

export { findEnvUsage } from './usage.js';
export { parseEnvKeys } from './envfile.js';

/** File types that are scanned for variable usage. */
export const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.svelte', '.vue', '.astro', '.py', '.prisma',
]);

/** Folders that are never scanned. */
export const DEFAULT_IGNORE_DIRS = [
  'node_modules', '.git', '.svelte-kit', '.next', '.nuxt', '.output', '.vercel', '.netlify',
  '.turbo', '.cache', 'dist', 'build', 'coverage', 'out',
  'venv', '.venv', '__pycache__', 'site-packages', '.pytest_cache', '.mypy_cache',
];

/**
 * Variables set by Node, Vite, frameworks, CI or hosting platforms — nobody
 * puts these in .env.example. Entries ending in * match by prefix.
 */
export const BUILT_IN_VARS = [
  'NODE_ENV', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'NEXT_RUNTIME', 'NEXT_PHASE',
  'CI', 'GITHUB_*', 'RUNNER_*', 'VERCEL', 'VERCEL_*', 'NETLIFY', 'RENDER', 'RENDER_*',
  'npm_*', 'HOME', 'PATH', 'PWD', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'APPDATA',
  'PYTHONPATH', 'VIRTUAL_ENV', 'NO_COLOR', 'FORCE_COLOR', 'TERM', 'LANG',
];

/**
 * @typedef {object} Location
 * @property {string} file   Relative to the root, "/" separated
 * @property {number} line
 * @property {number} column
 */

/**
 * @typedef {object} MissingVar
 * @property {string} name
 * @property {string} example   The .env.example this variable should be added to
 * @property {boolean} exampleExists
 * @property {Location[]} usages
 */

/**
 * @typedef {object} UnusedVar
 * @property {string} name
 * @property {string} example
 * @property {number} line
 */

/**
 * @typedef {object} SecretFileIssue
 * @property {string} file
 * @property {'committed' | 'not-ignored'} problem
 */

/**
 * @typedef {object} ScanResult
 * @property {MissingVar[]} missing     Used in code, not documented (error)
 * @property {UnusedVar[]} unused       Documented, never used (warning)
 * @property {SecretFileIssue[]} secrets Real .env files at risk of being committed (error)
 * @property {string[]} examples        Example files found
 * @property {number} filesScanned
 * @property {number} variablesUsed     Distinct variable names found in code
 * @property {boolean} gitChecked       False when git wasn't available
 */

/**
 * @typedef {object} ScanOptions
 * @property {string} [example]        Use this one example file (relative to root) for the whole project
 * @property {string[]} [ignoreVars]   Extra variable names to skip (trailing * = prefix)
 * @property {string[]} [ignoreDirs]   Extra folder names to skip
 * @property {boolean} [git]           Set false to skip the git checks
 */

/** @param {string} p */
const toPosix = (p) => p.split(path.sep).join('/');

/** @param {string[]} patterns */
function matcher(patterns) {
  const exact = new Set(patterns.filter((p) => !p.endsWith('*')));
  const prefixes = patterns.filter((p) => p.endsWith('*')).map((p) => p.slice(0, -1));
  return (/** @type {string} */ name) => exact.has(name) || prefixes.some((p) => name.startsWith(p));
}

/**
 * Scan a project.
 * @param {string} rootDir
 * @param {ScanOptions} [options]
 * @returns {ScanResult}
 */
export function scan(rootDir, options = {}) {
  const root = path.resolve(rootDir);
  const skipDir = new Set([...DEFAULT_IGNORE_DIRS, ...(options.ignoreDirs ?? [])]);
  const isIgnoredVar = matcher([...BUILT_IN_VARS, ...(options.ignoreVars ?? [])]);

  /** @type {string[]} */
  const sources = [];
  /** @type {Map<string, string>} directory → its example file */
  const examplesByDir = new Map();
  /** @type {string[]} */
  const secretFiles = [];

  /** @param {string} dir */
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.map((e) => e.name));
    const example = EXAMPLE_FILES.find((f) => names.has(f));
    if (example) examplesByDir.set(dir, path.join(dir, example));

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDir.has(e.name)) walk(full);
      } else if (e.isFile()) {
        if (isSecretEnvFile(e.name)) secretFiles.push(toPosix(path.relative(root, full)));
        else if (SOURCE_EXTENSIONS.has(path.extname(e.name).toLowerCase())) sources.push(full);
      }
    }
  };
  walk(root);

  if (options.example) {
    examplesByDir.clear();
    examplesByDir.set(root, path.resolve(root, options.example));
  }
  const fallbackExample = path.join(root, '.env.example');

  /** Nearest example file at or above a source file's folder. @param {string} file */
  const exampleFor = (file) => {
    let dir = path.dirname(file);
    while (true) {
      const ex = examplesByDir.get(dir);
      if (ex) return ex;
      if (dir === root) return examplesByDir.get(root) ?? fallbackExample;
      const parent = path.dirname(dir);
      if (parent === dir) return fallbackExample;
      dir = parent;
    }
  };

  /** @type {Map<string, Map<string, Location[]>>} example → name → usages */
  const usedByExample = new Map();
  const allNames = new Set();

  for (const file of sources) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const usages = findEnvUsage(text, file);
    if (!usages.length) continue;
    const example = exampleFor(file);
    const bucket = usedByExample.get(example) ?? new Map();
    usedByExample.set(example, bucket);
    for (const u of usages) {
      allNames.add(u.name);
      if (isIgnoredVar(u.name)) continue;
      const list = bucket.get(u.name) ?? [];
      list.push({ file: toPosix(path.relative(root, file)), line: u.line, column: u.column });
      bucket.set(u.name, list);
    }
  }

  /** @type {MissingVar[]} */
  const missing = [];
  /** @type {UnusedVar[]} */
  const unused = [];
  const exampleFiles = new Set([...examplesByDir.values(), ...usedByExample.keys()]);

  for (const example of exampleFiles) {
    const exists = fs.existsSync(example);
    const documented = exists ? parseEnvKeys(fs.readFileSync(example, 'utf8')) : [];
    const documentedNames = new Set(documented.map((d) => d.name));
    const used = usedByExample.get(example) ?? new Map();
    const rel = toPosix(path.relative(root, example));

    for (const [name, usages] of used) {
      if (!documentedNames.has(name)) missing.push({ name, example: rel, exampleExists: exists, usages });
    }
    for (const d of documented) {
      if (!used.has(d.name) && !isIgnoredVar(d.name)) unused.push({ name: d.name, example: rel, line: d.line });
    }
  }

  /** @type {SecretFileIssue[]} */
  const secrets = [];
  let gitChecked = false;
  if (options.git !== false) {
    const status = gitStatus(root, secretFiles);
    if (status) {
      gitChecked = true;
      for (const f of secretFiles) {
        if (status.tracked.has(f)) secrets.push({ file: f, problem: 'committed' });
        else if (status.unignored.has(f)) secrets.push({ file: f, problem: 'not-ignored' });
      }
    }
  }

  const byName = (/** @type {{ example: string, name: string }} */ a, /** @type {{ example: string, name: string }} */ b) =>
    a.example.localeCompare(b.example) || a.name.localeCompare(b.name);

  return {
    missing: missing.sort(byName),
    unused: unused.sort(byName),
    secrets,
    examples: [...examplesByDir.values()].filter((f) => fs.existsSync(f)).map((f) => toPosix(path.relative(root, f))).sort(),
    filesScanned: sources.length,
    variablesUsed: [...allNames].filter((n) => !isIgnoredVar(n)).length,
    gitChecked,
  };
}
