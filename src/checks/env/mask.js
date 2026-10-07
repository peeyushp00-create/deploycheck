// Blank out comments (and documentation text) so commented-out code is never
// reported. Every character keeps its position, so offsets map straight back
// to the original file for line/column numbers.

/** Replace every character except newlines with a space. */
const blank = (/** @type {string} */ s) => s.replace(/[^\n]/g, ' ');

/**
 * JavaScript / TypeScript / Svelte / Vue: blank // and /* *\/ comments and the
 * text part of template literals (their ${...} expressions are kept).
 * Quoted strings are kept because env names can appear inside them.
 * @param {string} src
 */
export function maskJs(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  /** @type {number[]} */
  const templateStack = [];
  let depth = 0;

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
    if (ch === '<' && src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const stop = end === -1 ? n : end + 3;
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
    if (ch === '`' || (ch === '}' && templateStack.length && templateStack[templateStack.length - 1] === depth)) {
      if (ch === '}') templateStack.pop();
      let j = i + 1;
      let closer = '';
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') { closer = '`'; j++; break; }
        if (src[j] === '$' && src[j + 1] === '{') { templateStack.push(depth); closer = '${'; j += 2; break; }
        j++;
      }
      out += ch + blank(src.slice(i + 1, j - closer.length)) + closer;
      i = j;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    out += ch;
    i++;
  }
  return out;
}

/**
 * Python: blank # comments and triple-quoted strings (docstrings).
 * Normal quoted strings are kept.
 * @param {string} src
 */
export function maskPython(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '#') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if ((ch === '"' || ch === "'") && src.startsWith(ch.repeat(3), i)) {
      const end = src.indexOf(ch.repeat(3), i + 3);
      const stop = end === -1 ? n : end + 3;
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
    out += ch;
    i++;
  }
  return out;
}

/**
 * Prisma schema: blank // comments.
 * @param {string} src
 */
export function maskPrisma(src) {
  return src.replace(/\/\/[^\n]*/g, (m) => blank(m));
}
