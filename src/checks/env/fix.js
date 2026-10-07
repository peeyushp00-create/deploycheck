// --fix: add every missing variable to the right .env.example (created if needed).

import path from 'node:path';
import { appendToEnvFile } from './envfile.js';

/**
 * @param {string} rootDir
 * @param {import('./scan.js').MissingVar[]} missing
 * @returns {{ added: number, files: string[] }}
 */
export function addMissingToExamples(rootDir, missing) {
  /** @type {Map<string, { name: string, firstUse: string }[]>} */
  const byExample = new Map();
  for (const m of missing) {
    const first = m.usages[0];
    const list = byExample.get(m.example) ?? [];
    list.push({ name: m.name, firstUse: `${first.file}:${first.line}` });
    byExample.set(m.example, list);
  }
  for (const [example, vars] of byExample) {
    appendToEnvFile(path.join(rootDir, example), vars);
  }
  return { added: missing.length, files: [...byExample.keys()] };
}
