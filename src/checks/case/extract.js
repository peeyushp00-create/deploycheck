// Finds import specifiers in source files without a full parser.
// Comments are blanked out (positions preserved) so commented-out imports
// are ignored, then a few targeted patterns pick up every import form.

/**
 * @typedef {object} ImportRef
 * @property {string} specifier  The text between the quotes, e.g. "./Button.svelte"
 * @property {number} start      Offset of the first character inside the quotes
 * @property {number} end        Offset just past the last character inside the quotes
 * @property {number} line       1-based line number
 * @property {number} column     1-based column of the first character inside the quotes
 */

/** Replace every character except newlines with a space. */
const blank = (/** @type {string} */ s) => s.replace(/[^\n]/g, ' ');

/**
 * Blank out // and /* *\/ comments and the text of template literals, leaving
 * quoted strings untouched, so offsets in the result match the original text.
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  /** @type {number[]} brace depth for each open template `${` */
  const templateStack = [];
  let braceDepth = 0;

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '`' || (ch === '}' && templateStack.length && templateStack[templateStack.length - 1] === braceDepth)) {
      // Inside a template literal: copy until the closing backtick or a `${`.
      if (ch === '}') templateStack.pop();
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') { j++; break; }
        if (src[j] === '$' && src[j + 1] === '{') { templateStack.push(braceDepth); j += 2; break; }
        j++;
      }
      // Template text is blanked too: code samples inside it aren't real imports.
      out += src[i] + blank(src.slice(i + 1, j));
      i = j;
      continue;
    }
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    out += ch;
    i++;
  }
  return out;
}

/**
 * For .svelte / .vue files only the <script> blocks contain imports.
 * Everything else is blanked so markup text (apostrophes, URLs) can't confuse the scan.
 * @param {string} src
 * @returns {string}
 */
export function keepScriptBlocks(src) {
  let out = '';
  let last = 0;
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) {
    const contentStart = m.index + m[0].indexOf('>') + 1;
    const contentEnd = contentStart + m[1].length;
    out += blank(src.slice(last, contentStart)) + src.slice(contentStart, contentEnd);
    last = contentEnd;
  }
  return out + blank(src.slice(last));
}

const PATTERNS = [
  // import x from '..' / import { a } from '..' / import type X from '..' / import '..'
  // export * from '..' / export { a } from '..'
  /(?<![.\w$])(?:import|export)\s+(?:[^'"`;]*?\bfrom\s*)?(['"])([^'"\n]+)\1/g,
  // import('..')
  /(?<![.\w$])import\s*\(\s*(['"])([^'"\n]+)\1\s*[,)]/g,
  // require('..'), also covers `import x = require('..')`
  /(?<![.\w$])require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
];

/**
 * Extract every static import specifier from a source file.
 * @param {string} source  File contents
 * @param {string} filename Used to decide whether to look only inside <script> blocks
 * @returns {ImportRef[]}
 */
export function extractImports(source, filename = '') {
  let text = source;
  if (/\.(svelte|vue)$/i.test(filename)) text = keepScriptBlocks(text);
  text = stripComments(text);

  /** @type {Map<number, ImportRef>} */
  const found = new Map();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text))) {
      const quoteIndex = m.index + m[0].lastIndexOf(m[1] + m[2] + m[1]);
      const start = quoteIndex + 1;
      if (found.has(start)) continue;
      found.set(start, { specifier: m[2], start, end: start + m[2].length, line: 0, column: 0 });
    }
  }

  const refs = [...found.values()].sort((a, b) => a.start - b.start);
  // Convert offsets to line/column in one pass.
  let line = 1;
  let lineStart = 0;
  let pos = 0;
  for (const ref of refs) {
    while (pos < ref.start) {
      if (source[pos] === '\n') { line++; lineStart = pos + 1; }
      pos++;
    }
    ref.line = line;
    ref.column = ref.start - lineStart + 1;
  }
  return refs;
}
