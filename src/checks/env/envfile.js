// Reading and updating .env-style files.

import fs from 'node:fs';

/** File names treated as the documented list of variables, in priority order. */
export const EXAMPLE_FILES = ['.env.example', '.env.sample', '.env.template', '.env.dist', 'example.env'];

/**
 * Is this a real (secret) env file, as opposed to an example/template?
 * Matches .env, .env.local, .env.production, .env.development.local, etc.
 * @param {string} name
 */
export function isSecretEnvFile(name) {
  if (EXAMPLE_FILES.includes(name)) return false;
  if (!/^\.env(\.[\w.-]+)?$/.test(name)) return false;
  return !/\.(example|sample|template|dist|defaults|schema)$/i.test(name);
}

/**
 * Parse variable names from .env text. Handles comments, `export KEY=`,
 * quoted values and multi-line quoted values.
 * @param {string} text
 * @returns {{ name: string, line: number }[]}
 */
export function parseEnvKeys(text) {
  /** @type {{ name: string, line: number }[]} */
  const keys = [];
  const lines = text.split(/\r?\n/);
  /** @type {string | null} */
  let openQuote = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (openQuote) {
      if (closesQuote(raw, openQuote)) openQuote = null;
      continue;
    }
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    if (!m) continue;
    keys.push({ name: m[1], line: i + 1 });
    const value = m[2];
    const q = value[0];
    if ((q === '"' || q === "'" || q === '`') && !closesQuote(value.slice(1), q)) openQuote = q;
  }
  return keys;
}

/**
 * @param {string} s
 * @param {string} quote
 */
function closesQuote(s, quote) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === quote) return true;
  }
  return false;
}

/**
 * Append variables to an example file (creating it if needed), with a comment
 * saying where each one is used.
 * @param {string} file
 * @param {{ name: string, firstUse: string }[]} vars
 */
export function appendToEnvFile(file, vars) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (text && !text.endsWith('\n')) text += eol;
  if (text.trim()) text += eol;
  for (const v of vars) {
    text += `# Used in ${v.firstUse}${eol}${v.name}=${eol}`;
  }
  fs.writeFileSync(file, text);
}
