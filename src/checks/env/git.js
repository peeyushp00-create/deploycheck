// Asks git whether env files are committed or missing from .gitignore.
// If git isn't installed or the folder isn't a repository, these checks are skipped.

import { spawnSync } from 'node:child_process';

/**
 * @param {string} root
 * @param {string[]} args
 * @param {string} [input]
 */
function git(root, args, input) {
  const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', input });
  if (res.error) return null;
  return res;
}

/**
 * @param {string} root      Project root
 * @param {string[]} files   Env files, relative to root, "/" separated
 * @returns {{ tracked: Set<string>, unignored: Set<string> } | null}  null when git can't be used
 */
export function gitStatus(root, files) {
  const inside = git(root, ['rev-parse', '--show-toplevel']);
  if (!inside || inside.status !== 0) return null;

  const tracked = new Set();
  const unignored = new Set();
  if (!files.length) return { tracked, unignored };

  const ls = git(root, ['ls-files', '-z', '--', ...files]);
  if (ls && ls.status === 0) {
    for (const f of ls.stdout.split('\0')) if (f) tracked.add(f);
  }

  // check-ignore prints the files that ARE ignored; the rest are not.
  const ci = git(root, ['check-ignore', '--no-index', '-z', '--stdin'], files.join('\0') + '\0');
  const ignored = new Set((ci?.stdout ?? '').split('\0').filter(Boolean));
  for (const f of files) if (!ignored.has(f)) unignored.add(f);

  return { tracked, unignored };
}
