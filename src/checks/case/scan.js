// Public API: scan a project and report imports whose letter case does not
// match the file on disk, plus files that differ only by case.

import fs from 'node:fs';
import path from 'node:path';
import { extractImports } from './extract.js';
import { loadAliases } from './config.js';
import { DirCache, resolveCase } from './resolve.js';

export { extractImports } from './extract.js';
export { loadAliases } from './config.js';

/** File types that are scanned for imports. */
export const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.svelte', '.vue',
]);

/** Folders that are never scanned. */
export const DEFAULT_IGNORE = [
  'node_modules', '.git', '.svelte-kit', '.next', '.nuxt', '.output', '.vercel',
  '.netlify', '.turbo', '.cache', 'dist', 'build', 'coverage', 'out',
];

/**
 * @typedef {object} CaseIssue
 * @property {string} file        File containing the import, relative to the root, "/" separated
 * @property {number} line
 * @property {number} column
 * @property {string} specifier   The import as written
 * @property {string} corrected   The import with on-disk casing ("" when only a rename can fix it)
 * @property {string} [actual]    The file on disk it should point to, relative to the root
 * @property {number} start       Offset of the specifier text inside the file
 * @property {number} end
 */

/**
 * @typedef {object} Collision
 * @property {string} dir     Directory, relative to the root
 * @property {string[]} names Entries that differ only by case
 */

/**
 * @typedef {object} ScanOptions
 * @property {string[]} [ignore]              Extra folder names to skip
 * @property {Record<string, string>} [aliases] Extra aliases, prefix → path relative to root
 */

/**
 * @typedef {object} ScanResult
 * @property {CaseIssue[]} issues
 * @property {Collision[]} collisions
 * @property {number} filesScanned
 * @property {number} importsChecked
 */

/** @param {string} p */
const toPosix = (p) => p.split(path.sep).join('/');

/**
 * Scan a project directory.
 * @param {string} rootDir
 * @param {ScanOptions} [options]
 * @returns {ScanResult}
 */
export function scan(rootDir, options = {}) {
  const root = path.resolve(rootDir);
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])]);
  const aliasesFor = projectAliases(root, options.aliases);
  const cache = new DirCache();

  /** @type {string[]} */
  const files = [];
  /** @type {Collision[]} */
  const collisions = [];

  /** @param {string} dir */
  const walk = (dir) => {
    const names = cache.list(dir) ?? [];
    /** @type {Map<string, string[]>} */
    const byLower = new Map();
    for (const name of names) {
      const key = name.toLowerCase();
      byLower.set(key, [...(byLower.get(key) ?? []), name]);
    }
    for (const group of byLower.values()) {
      if (group.length > 1) collisions.push({ dir: toPosix(path.relative(root, dir)) || '.', names: group.sort() });
    }

    for (const name of names) {
      const full = path.join(dir, name);
      let stat;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!ignore.has(name)) walk(full);
      } else if (stat.isFile() && SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase())) {
        files.push(full);
      }
    }
  };
  walk(root);

  /** @type {CaseIssue[]} */
  const issues = [];
  let importsChecked = 0;

  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const ref of extractImports(source, file)) {
      const target = locate(ref.specifier, path.dirname(file), aliasesFor(path.dirname(file)));
      if (!target) continue;
      importsChecked++;

      const result = resolveCase(cache, target.baseDir, target.rest);
      if (result.status !== 'mismatch') continue;

      const corrected = target.head + result.corrected + target.suffix;
      issues.push({
        file: toPosix(path.relative(root, file)),
        line: ref.line,
        column: ref.column,
        specifier: ref.specifier,
        corrected: corrected === ref.specifier ? '' : corrected,
        actual: result.resolved ? toPosix(path.relative(root, result.resolved)) : undefined,
        start: ref.start,
        end: ref.end,
      });
    }
  }

  return { issues, collisions, filesScanned: files.length, importsChecked };
}

/** Files that mark the root of a (sub)project with its own aliases. */
const PROJECT_MARKERS = ['tsconfig.json', 'jsconfig.json', 'svelte.config.js', 'svelte.config.mjs', 'svelte.config.ts'];

/**
 * In a monorepo each app (frontend/, apps/web/ …) has its own tsconfig and
 * aliases. Returns a lookup that finds the nearest project folder for a
 * directory and loads that project's aliases (cached).
 * @param {string} root
 * @param {Record<string, string> | undefined} extra  CLI aliases, relative to the scan root
 */
function projectAliases(root, extra) {
  /** @type {Map<string, import('./config.js').Alias[]>} */
  const byProject = new Map();
  /** @type {Map<string, string>} */
  const projectOfDir = new Map();
  const extraAbs = Object.fromEntries(Object.entries(extra ?? {}).map(([k, v]) => [k, path.resolve(root, v)]));

  /** @param {string} dir */
  const projectFor = (dir) => {
    const known = projectOfDir.get(dir);
    if (known) return known;
    let project = root;
    if (dir !== root && dir.startsWith(root)) {
      project = PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m))) ? dir : projectFor(path.dirname(dir));
    }
    projectOfDir.set(dir, project);
    return project;
  };

  return (/** @type {string} */ dir) => {
    const project = projectFor(dir);
    let aliases = byProject.get(project);
    if (!aliases) {
      aliases = loadAliases(project, extraAbs);
      byProject.set(project, aliases);
    }
    return aliases;
  };
}

/**
 * Work out where an import points: a relative path or a known alias.
 * Package imports ("react", "@sveltejs/kit") return null and are skipped.
 * @param {string} specifier
 * @param {string} fromDir
 * @param {import('./config.js').Alias[]} aliases
 * @returns {{ baseDir: string, head: string, rest: string, suffix: string } | null}
 */
function locate(specifier, fromDir, aliases) {
  // Keep "?raw", "?url", "#hash" out of the path check but put them back in the fix.
  const q = specifier.search(/[?#]/);
  const pathPart = q === -1 ? specifier : specifier.slice(0, q);
  const suffix = q === -1 ? '' : specifier.slice(q);
  if (!pathPart) return null;

  if (pathPart.startsWith('./') || pathPart.startsWith('../') || pathPart === '.' || pathPart === '..') {
    return { baseDir: fromDir, head: '', rest: pathPart, suffix };
  }

  for (const alias of aliases) {
    // An exact alias like "$lib" has nothing after it to check, and the alias name itself is fixed.
    if (alias.exact) {
      if (pathPart === alias.prefix) return null;
      continue;
    }
    if (pathPart.startsWith(alias.prefix) && pathPart.length > alias.prefix.length) {
      return { baseDir: alias.target, head: alias.prefix, rest: pathPart.slice(alias.prefix.length), suffix };
    }
  }
  return null;
}
