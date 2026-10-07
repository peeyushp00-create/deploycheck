// Finds every environment variable a source file reads.

import { maskJs, maskPython, maskPrisma } from './mask.js';

/**
 * @typedef {object} EnvUsage
 * @property {string} name    Variable name, e.g. "DATABASE_URL"
 * @property {number} line    1-based
 * @property {number} column  1-based column of the name
 */

const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const JS_ENV_OBJECTS = String.raw`(?:process\.env|import\.meta\.env|Bun\.env)`;

/** Patterns whose first capture group is the variable name. */
const JS_PATTERNS = [
  // process.env.API_KEY, import.meta.env.VITE_URL, process.env?.X, Bun.env.X
  new RegExp(String.raw`(?<![\w$.])${JS_ENV_OBJECTS}\??\.(${NAME})`, 'g'),
  // process.env['API_KEY'], process.env?.["X"]
  new RegExp(String.raw`(?<![\w$.])${JS_ENV_OBJECTS}(?:\?\.)?\[\s*['"](${NAME})['"]\s*\]`, 'g'),
  // Deno.env.get('API_KEY')
  new RegExp(String.raw`(?<![\w$.])Deno\.env\.get\(\s*['"](${NAME})['"]`, 'g'),
];

const PY_PATTERNS = [
  // os.environ["X"], os.environ.get("X"), environ["X"]
  new RegExp(String.raw`(?<![\w.])(?:os\.)?environ\s*(?:\[\s*|\.get\(\s*|\.setdefault\(\s*)['"](${NAME})['"]`, 'g'),
  // os.getenv("X"), getenv("X")
  new RegExp(String.raw`(?<![\w.])(?:os\.)?getenv\(\s*['"](${NAME})['"]`, 'g'),
];

// env("DATABASE_URL") in schema.prisma
const PRISMA_PATTERN = new RegExp(String.raw`\benv\(\s*"(${NAME})"\s*\)`, 'g');

/** Object methods that look like property reads but aren't variables. */
const NOT_ENV_PROPERTIES = new Set(['hasOwnProperty', 'toString', 'valueOf', 'constructor']);

/**
 * @param {string} source
 * @param {string} filename
 * @returns {EnvUsage[]}
 */
export function findEnvUsage(source, filename) {
  const lower = filename.toLowerCase();
  /** @type {{ name: string, index: number }[]} */
  const hits = [];

  /** @param {string} text @param {RegExp} re */
  const collect = (text, re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1];
      if (NOT_ENV_PROPERTIES.has(name)) continue;
      hits.push({ name, index: m.index + m[0].lastIndexOf(name) });
    }
  };

  if (lower.endsWith('.py')) {
    const text = maskPython(source);
    for (const re of PY_PATTERNS) collect(text, re);
  } else if (lower.endsWith('.prisma')) {
    collect(maskPrisma(source), PRISMA_PATTERN);
  } else {
    const text = maskJs(source);
    for (const re of JS_PATTERNS) collect(text, re);
    collectDestructuring(text, hits);
    collectSvelteKit(text, hits);
  }

  return toUsages(source, hits);
}

/**
 * const { API_KEY, DB_URL: url, PORT = 3000 } = process.env
 * @param {string} text
 * @param {{ name: string, index: number }[]} hits
 */
function collectDestructuring(text, hits) {
  const re = new RegExp(String.raw`\{([^{}]*)\}\s*=\s*${JS_ENV_OBJECTS}(?![\w$.\[])`, 'g');
  let m;
  while ((m = re.exec(text))) {
    const bodyStart = m.index + 1;
    addNamesFromBraces(m[1], bodyStart, hits, ':');
  }
}

/**
 * SvelteKit: import { API_KEY } from '$env/static/private'
 *            import { env } from '$env/dynamic/private'; env.API_KEY
 * @param {string} text
 * @param {{ name: string, index: number }[]} hits
 */
function collectSvelteKit(text, hits) {
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]\$env\/(static|dynamic)\/(?:private|public)['"]/g;
  let m;
  while ((m = re.exec(text))) {
    const bodyStart = m.index + m[0].indexOf('{') + 1;
    if (m[2] === 'static') {
      addNamesFromBraces(m[1], bodyStart, hits, ' as ');
      continue;
    }
    // Dynamic: find the local name of `env` and every `<local>.NAME` after it.
    const spec = m[1].split(',').map((s) => s.trim()).find((s) => /^env\b/.test(s));
    if (!spec) continue;
    const local = spec.includes(' as ') ? spec.split(' as ')[1].trim() : 'env';
    const use = new RegExp(String.raw`(?<![\w$.])${local.replace(/\$/g, '\\$')}\??\.(${NAME})|(?<![\w$.])${local.replace(/\$/g, '\\$')}\[\s*['"](${NAME})['"]\s*\]`, 'g');
    let u;
    while ((u = use.exec(text))) {
      const name = u[1] ?? u[2];
      hits.push({ name, index: u.index + u[0].lastIndexOf(name) });
    }
  }
}

/**
 * Pull names out of "A, B: b, C = 1, ...rest" (destructuring) or "A, B as b" (imports).
 * @param {string} body
 * @param {number} bodyStart   Offset of `body` in the file
 * @param {{ name: string, index: number }[]} hits
 * @param {string} renameToken ':' for destructuring, ' as ' for imports
 */
function addNamesFromBraces(body, bodyStart, hits, renameToken) {
  let offset = 0;
  for (const part of body.split(',')) {
    const key = part.split(renameToken)[0].split('=')[0];
    const name = key.trim();
    if (new RegExp(`^${NAME}$`).test(name)) {
      hits.push({ name, index: bodyStart + offset + part.indexOf(name) });
    }
    offset += part.length + 1;
  }
}

/**
 * @param {string} source
 * @param {{ name: string, index: number }[]} hits
 * @returns {EnvUsage[]}
 */
function toUsages(source, hits) {
  const seen = new Set();
  const sorted = hits.filter((h) => !seen.has(h.index) && seen.add(h.index)).sort((a, b) => a.index - b.index);
  /** @type {EnvUsage[]} */
  const usages = [];
  let line = 1;
  let lineStart = 0;
  let pos = 0;
  for (const h of sorted) {
    while (pos < h.index) {
      if (source[pos] === '\n') { line++; lineStart = pos + 1; }
      pos++;
    }
    usages.push({ name: h.name, line, column: h.index - lineStart + 1 });
  }
  return usages;
}
