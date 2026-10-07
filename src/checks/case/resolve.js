// Walks an import path one segment at a time and compares each segment with
// the real directory listing. This is how a case-sensitive filesystem (Linux,
// Vercel, Render, Docker) sees it, even when casecheck runs on Windows or macOS.

import fs from 'node:fs';
import path from 'node:path';

/** Extensions tried for extensionless imports, in resolution order. */
export const RESOLVE_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts', '.d.ts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.svelte', '.vue', '.json',
];

/** `import "./a.js"` may point at a.ts in TypeScript ESM projects. */
const TS_SWAPS = /** @type {Record<string, string[]>} */ ({
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
});

/**
 * @typedef {object} Resolution
 * @property {'ok' | 'mismatch' | 'missing'} status
 * @property {string} [corrected]  The specifier tail rewritten with on-disk casing
 * @property {string} [resolved]   Absolute path of the file the import resolves to
 */

export class DirCache {
  constructor() {
    /** @type {Map<string, string[] | null>} */
    this.entries = new Map();
  }

  /**
   * Real names in a directory (null if it can't be read).
   * @param {string} dir
   */
  list(dir) {
    let names = this.entries.get(dir);
    if (names === undefined) {
      try {
        names = fs.readdirSync(dir);
      } catch {
        names = null;
      }
      this.entries.set(dir, names);
    }
    return names;
  }

  /**
   * Find `name` in `dir`: exact match first, then a case-insensitive one.
   * @param {string} dir
   * @param {string} name
   * @returns {{ actual: string, exact: boolean } | null}
   */
  lookup(dir, name) {
    const names = this.list(dir);
    if (!names) return null;
    if (names.includes(name)) return { actual: name, exact: true };
    const lower = name.toLowerCase();
    const hit = names.find((n) => n.toLowerCase() === lower);
    return hit ? { actual: hit, exact: false } : null;
  }

  /** @param {string} p */
  isDir(p) {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }
}

/**
 * Candidate file names for the last path segment, each with the suffix that
 * should be removed again when writing the corrected specifier.
 * @param {string} name
 * @returns {{ file: string, strip: string, keep: string }[]}
 */
function lastSegmentCandidates(name) {
  /** @type {{ file: string, strip: string, keep: string }[]} */
  const list = [{ file: name, strip: '', keep: '' }];
  for (const ext of RESOLVE_EXTENSIONS) list.push({ file: name + ext, strip: ext, keep: '' });
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const ext = name.slice(dot);
    for (const swap of TS_SWAPS[ext] ?? []) {
      list.push({ file: name.slice(0, dot) + swap, strip: swap, keep: ext });
    }
  }
  return list;
}

/**
 * Check `spec` (a relative path like "../components/Button") starting from `baseDir`.
 * @param {DirCache} cache
 * @param {string} baseDir  Absolute directory the path is relative to
 * @param {string} spec     Path to check, using "/" separators, without query/hash
 * @returns {Resolution}
 */
export function resolveCase(cache, baseDir, spec) {
  const segments = spec.split('/');
  /** @type {string[]} */
  const corrected = [];
  let dir = baseDir;
  let mismatch = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    if (seg === '' || seg === '.') { corrected.push(seg); continue; }
    if (seg === '..') { corrected.push(seg); dir = path.dirname(dir); continue; }

    if (!isLast) {
      const hit = cache.lookup(dir, seg);
      if (!hit) return { status: 'missing' };
      if (!hit.exact) mismatch = true;
      corrected.push(hit.actual);
      dir = path.join(dir, hit.actual);
      continue;
    }

    // Last segment: try the name as written, then with extensions.
    const candidates = lastSegmentCandidates(seg);
    /** @type {{ cand: (typeof candidates)[number], hit: { actual: string, exact: boolean } } | null} */
    let fuzzy = null;
    for (const cand of candidates) {
      const hit = cache.lookup(dir, cand.file);
      if (!hit) continue;
      const full = path.join(dir, hit.actual);
      // A directory import resolves to its index file; a same-named dir without one is not a match.
      if (cache.isDir(full)) {
        if (cand.strip) continue;
        const index = resolveCase(cache, full, 'index');
        if (index.status === 'missing') continue;
        if (hit.exact) {
          corrected.push(hit.actual);
          return finish(corrected, mismatch || index.status === 'mismatch', index.resolved);
        }
        fuzzy ??= { cand, hit };
        continue;
      }
      if (hit.exact) {
        corrected.push(seg);
        return finish(corrected, mismatch, full);
      }
      fuzzy ??= { cand, hit };
    }
    if (!fuzzy) return { status: 'missing' };

    const { cand, hit } = fuzzy;
    const base = cand.strip ? hit.actual.slice(0, hit.actual.length - cand.strip.length) : hit.actual;
    corrected.push(base + cand.keep);
    const full = path.join(dir, hit.actual);
    const resolved = cache.isDir(full) ? resolveCase(cache, full, 'index').resolved : full;
    return finish(corrected, true, resolved);
  }

  // Path ended in "/" or "." (e.g. "./" or ".."): treat as a directory import.
  return { status: mismatch ? 'mismatch' : 'ok', corrected: corrected.join('/') };
}

/**
 * @param {string[]} corrected
 * @param {boolean} mismatch
 * @param {string | undefined} resolved
 * @returns {Resolution}
 */
function finish(corrected, mismatch, resolved) {
  return { status: mismatch ? 'mismatch' : 'ok', corrected: corrected.join('/'), resolved };
}
