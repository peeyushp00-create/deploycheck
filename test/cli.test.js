import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

/** @param {string[]} args */
function run(args, env = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: '', NO_COLOR: '1', ...env },
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

const clean = () =>
  makeProject({
    '.env.example': 'API_KEY=\n',
    'src/a.ts': `import h from './helper';\nconst k = process.env.API_KEY;`,
    'src/helper.ts': '',
  });

const broken = () =>
  makeProject({
    '.env.example': 'API_KEY=\nOLD=\n',
    'src/a.ts': `import h from './Helper';\nconst k = process.env.API_KEY;\nconst s = process.env.STRIPE_KEY;`,
    'src/helper.ts': '',
  });

test('exits 0 and says ready when every check passes', () => {
  const root = clean();
  const { code, out } = run([root, '--no-git']);
  assert.equal(code, 0);
  assert.match(out, /▸ Import case/);
  assert.match(out, /▸ Environment variables/);
  assert.match(out, /✔ Ready to deploy: all 2 checks passed/);
});

test('exits 1 and reports problems from every check', () => {
  const { code, out } = run([broken(), '--no-git']);
  assert.equal(code, 1);
  assert.match(out, /src\/a\.ts:1:16 {2}✖ import "\.\/Helper"/);
  assert.match(out, /STRIPE_KEY\s+src\/a\.ts:3:23/);
  assert.match(out, /✖ Not ready to deploy: 2 problems \(import case: 1, environment variables: 1\)/);
});

test('warnings alone pass, but fail with --strict', () => {
  const root = makeProject({ '.env.example': 'API_KEY=\nOLD=\n', 'src/a.ts': 'process.env.API_KEY' });
  const normal = run([root, '--no-git']);
  assert.equal(normal.code, 0);
  assert.match(normal.out, /Ready to deploy: all 2 checks passed with 1 warning/);
  assert.equal(run([root, '--no-git', '--strict']).code, 1);
});

test('--fix repairs both kinds of problems', () => {
  const root = broken();
  const { code, out } = run([root, '--no-git', '--fix']);
  assert.equal(code, 0);
  assert.match(out, /Fixed 1 import in 1 file/);
  assert.match(out, /Added 1 variable to \.env\.example/);
  assert.match(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8'), /from '\.\/helper'/);
  assert.match(fs.readFileSync(path.join(root, '.env.example'), 'utf8'), /STRIPE_KEY=/);
  assert.equal(run([root, '--no-git']).code, 0);
});

test('--only and --skip choose checks', () => {
  const root = broken();
  const only = run([root, '--no-git', '--only', 'env']);
  assert.doesNotMatch(only.out, /Import case/);
  assert.match(only.out, /Not ready to deploy: 1 problem /);
  assert.match(only.out, /\(the check\)|environment variables: 1/);

  const skip = run([root, '--no-git', '--skip', 'env']);
  assert.doesNotMatch(skip.out, /Environment variables/);
  assert.match(run([root, '--no-git', '--only', 'case,env']).out, /2 problems/);
});

test('--format json reports each check', () => {
  const data = JSON.parse(run([broken(), '--no-git', '--format', 'json']).out);
  assert.equal(data.ok, false);
  assert.equal(data.errors, 2);
  assert.equal(data.checks.case.issues[0].corrected, './helper');
  assert.equal(data.checks.case.issues[0].start, undefined);
  assert.equal(data.checks.env.missing[0].name, 'STRIPE_KEY');
  assert.equal(data.checks.env.unused[0].name, 'OLD');
});

test('emits GitHub annotations inside GitHub Actions', () => {
  const { out } = run([broken(), '--no-git'], { GITHUB_ACTIONS: 'true' });
  assert.match(out, /^::error file=src\/a\.ts,line=1,col=16,title=deploycheck \(import case\)::/m);
  assert.match(out, /^::error file=src\/a\.ts,line=3,col=23,title=deploycheck \(env\)::STRIPE_KEY/m);
});

test('rejects bad options with exit code 2', () => {
  assert.equal(run(['--nope']).code, 2);
  assert.equal(run(['--only', 'lint']).code, 2);
  assert.equal(run(['--alias', 'oops']).code, 2);
  assert.equal(run(['--format', 'xml']).code, 2);
});

test('prints help and version', () => {
  const help = run(['--help']).out;
  assert.match(help, /Usage/);
  assert.match(help, /case\s+Imports whose letter case/);
  assert.match(run(['--version']).out, /^\d+\.\d+\.\d+/);
});
