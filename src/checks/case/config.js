// Reads path aliases (like "@/*" or "$lib") from tsconfig.json / jsconfig.json
// so aliased imports get checked too, not just relative ones.

import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} Alias
 * @property {string} prefix   Specifier prefix, e.g. "@/" or "$lib"
 * @property {string} target   Absolute directory (or file) the prefix maps to
 * @property {boolean} exact   True when the alias has no wildcard and only matches exactly
 */

/**
 * Parse JSON that may contain comments and trailing commas (tsconfig style).
 * @param {string} text
 */
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') { out += text[++i] ?? ''; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i === -1) break;
      i++;
      continue;
    }
    out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * Load compilerOptions.baseUrl / paths, following relative "extends" chains.
 * @param {string} configPath
 * @param {Set<string>} [seen]
 * @returns {{ baseUrl?: string, paths?: Record<string, string[]>, pathsBase?: string }}
 */
function loadCompilerPaths(configPath, seen = new Set()) {
  if (seen.has(configPath) || !fs.existsSync(configPath)) return {};
  seen.add(configPath);
  let json;
  try {
    json = parseJsonc(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
  const dir = path.dirname(configPath);

  /** @type {{ baseUrl?: string, paths?: Record<string, string[]>, pathsBase?: string }} */
  let result = {};
  const extendsList = Array.isArray(json.extends) ? json.extends : json.extends ? [json.extends] : [];
  for (const ext of extendsList) {
    if (typeof ext !== 'string' || !ext.startsWith('.')) continue; // package configs are skipped
    let extPath = path.resolve(dir, ext);
    if (!extPath.endsWith('.json')) extPath += '.json';
    result = { ...result, ...loadCompilerPaths(extPath, seen) };
  }

  const opts = json.compilerOptions ?? {};
  if (typeof opts.baseUrl === 'string') result.baseUrl = path.resolve(dir, opts.baseUrl);
  if (opts.paths && typeof opts.paths === 'object') {
    result.paths = opts.paths;
    result.pathsBase = dir;
  }
  return result;
}

/**
 * Build the alias list for a project.
 * @param {string} root  Project root directory
 * @param {Record<string, string>} [extra] Extra aliases from the CLI, prefix → path relative to root
 * @returns {Alias[]}
 */
export function loadAliases(root, extra = {}) {
  /** @type {Alias[]} */
  const aliases = [];

  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const { baseUrl, paths, pathsBase } = loadCompilerPaths(path.join(root, name));
    if (!paths) continue;
    const base = baseUrl ?? pathsBase ?? root;
    for (const [key, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets) || typeof targets[0] !== 'string') continue;
      const wildcard = key.endsWith('*');
      const prefix = wildcard ? key.slice(0, -1) : key;
      const target = path.resolve(base, wildcard ? targets[0].replace(/\*$/, '') : targets[0]);
      aliases.push({ prefix, target, exact: !wildcard });
    }
    break; // tsconfig wins over jsconfig, like TypeScript itself
  }

  // SvelteKit's $lib lives in a generated config, so add it when the project looks like SvelteKit.
  const hasLib = aliases.some((a) => a.prefix.startsWith('$lib'));
  const isSvelteKit = ['svelte.config.js', 'svelte.config.mjs', 'svelte.config.ts'].some((f) =>
    fs.existsSync(path.join(root, f)),
  );
  if (!hasLib && isSvelteKit) {
    const lib = path.join(root, 'src', 'lib');
    aliases.push({ prefix: '$lib', target: lib, exact: true });
    aliases.push({ prefix: '$lib/', target: lib, exact: false });
  }

  for (const [prefix, rel] of Object.entries(extra)) {
    const target = path.resolve(root, rel);
    const p = prefix.endsWith('/') ? prefix : prefix + '/';
    aliases.push({ prefix: p, target, exact: false });
    aliases.push({ prefix: p.slice(0, -1), target, exact: true });
  }

  // Longest prefix first so "@/components/" beats "@/".
  return aliases.sort((a, b) => b.prefix.length - a.prefix.length);
}
