import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Create a throwaway project from a map of relative path → file contents.
 * @param {Record<string, string>} files
 */
export function makeProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploycheck-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** True when a `git` command is available. */
export const hasGit = !spawnSync('git', ['--version']).error;

/**
 * Turn a folder into a git repo and commit the given files.
 * @param {string} root
 * @param {string[]} commit  Files to commit (paths relative to root)
 */
export function gitInit(root, commit = []) {
  const g = (/** @type {string[]} */ args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  g(['init', '-q']);
  if (commit.length) {
    g(['add', '-f', '--', ...commit]);
    g(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init']);
  }
}

/** True when the OS temp folder treats "a" and "A" as the same file (Windows, default macOS). */
export function tmpIsCaseInsensitive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploycheck-ci-'));
  fs.writeFileSync(path.join(dir, 'probe'), '');
  const insensitive = fs.existsSync(path.join(dir, 'PROBE'));
  fs.rmSync(dir, { recursive: true, force: true });
  return insensitive;
}
