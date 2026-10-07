import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../../src/checks/env/scan.js';
import { addMissingToExamples } from '../../src/checks/env/fix.js';
import { makeProject, gitInit, hasGit } from '../helpers.js';

const missingNames = (/** @type {ReturnType<typeof scan>} */ r) => r.missing.map((m) => m.name);

test('passes when every variable is documented', () => {
  const root = makeProject({
    '.env.example': 'API_KEY=\nDB_URL=\n',
    'src/a.ts': 'process.env.API_KEY; process.env.DB_URL;',
  });
  const r = scan(root, { git: false });
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.unused, []);
  assert.equal(r.variablesUsed, 2);
});

test('reports missing variables with every place they are used', () => {
  const root = makeProject({
    '.env.example': 'API_KEY=\n',
    'src/a.ts': 'process.env.API_KEY;\nprocess.env.STRIPE_KEY;',
    'src/b.ts': 'const x = process.env.STRIPE_KEY;',
  });
  const r = scan(root, { git: false });
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].name, 'STRIPE_KEY');
  assert.equal(r.missing[0].example, '.env.example');
  assert.deepEqual(r.missing[0].usages.map((u) => `${u.file}:${u.line}`), ['src/a.ts:2', 'src/b.ts:1']);
});

test('reports variables listed but never used', () => {
  const root = makeProject({
    '.env.example': '# old\nAPI_KEY=\nOLD_TOKEN=\n',
    'src/a.ts': 'process.env.API_KEY',
  });
  assert.deepEqual(scan(root, { git: false }).unused, [{ name: 'OLD_TOKEN', example: '.env.example', line: 3 }]);
});

test('skips built-in variables like NODE_ENV, CI and VERCEL_*', () => {
  const root = makeProject({
    'src/a.ts': 'process.env.NODE_ENV; process.env.CI; process.env.VERCEL_URL; import.meta.env.DEV; process.env.npm_package_version;',
  });
  assert.deepEqual(scan(root, { git: false }).missing, []);
});

test('--ignore-var supports exact names and prefixes', () => {
  const root = makeProject({
    'src/a.ts': 'process.env.SENTRY_DSN; process.env.SENTRY_ORG; process.env.FEATURE_X; process.env.KEEP_ME;',
  });
  assert.deepEqual(missingNames(scan(root, { git: false, ignoreVars: ['SENTRY_*', 'FEATURE_X'] })), ['KEEP_ME']);
});

test('monorepos: each folder is checked against its own .env.example', () => {
  const root = makeProject({
    'frontend/.env.example': 'PUBLIC_URL=\n',
    'frontend/src/app.ts': 'import.meta.env.PUBLIC_URL; import.meta.env.VITE_MAPS_KEY;',
    'backend/.env.example': 'DATABASE_URL=\n',
    'backend/app/main.py': 'import os\nos.environ["DATABASE_URL"]\nos.getenv("REDIS_URL")',
  });
  const r = scan(root, { git: false });
  assert.deepEqual(r.missing.map((m) => `${m.example}:${m.name}`), ['backend/.env.example:REDIS_URL', 'frontend/.env.example:VITE_MAPS_KEY']);
  assert.deepEqual(r.examples, ['backend/.env.example', 'frontend/.env.example']);
});

test('without any example file, everything is missing from a root .env.example', () => {
  const root = makeProject({ 'src/a.ts': 'process.env.API_KEY' });
  const [m] = scan(root, { git: false }).missing;
  assert.equal(m.example, '.env.example');
  assert.equal(m.exampleExists, false);
});

test('--example uses one file for the whole project', () => {
  const root = makeProject({
    'config/env.template': 'API_KEY=\n',
    'src/a.ts': 'process.env.API_KEY',
    'web/.env.example': 'OTHER=\n',
  });
  const r = scan(root, { git: false, example: 'config/env.template' });
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.examples, ['config/env.template']);
});

test('skips node_modules, venv and ignored folders', () => {
  const root = makeProject({
    'node_modules/pkg/index.js': 'process.env.FROM_DEP',
    'venv/lib/x.py': 'os.getenv("FROM_VENV")',
    'scripts/old.js': 'process.env.FROM_SCRIPTS',
  });
  const r = scan(root, { git: false, ignoreDirs: ['scripts'] });
  assert.deepEqual(r.missing, []);
  assert.equal(r.filesScanned, 0);
});

test('--fix appends missing variables and creates the file if needed', () => {
  const root = makeProject({
    'web/.env.example': 'API_KEY=1',
    'web/src/a.ts': 'process.env.API_KEY; process.env.NEW_ONE;',
    'api/main.py': 'os.getenv("DB")',
  });
  const r = scan(root, { git: false });
  addMissingToExamples(root, r.missing);
  assert.equal(
    fs.readFileSync(path.join(root, 'web/.env.example'), 'utf8'),
    'API_KEY=1\n\n# Used in web/src/a.ts:1\nNEW_ONE=\n',
  );
  assert.equal(fs.readFileSync(path.join(root, '.env.example'), 'utf8'), '# Used in api/main.py:1\nDB=\n');
  assert.deepEqual(scan(root, { git: false }).missing, []);
});

test('git: flags committed and un-ignored .env files', { skip: !hasGit && 'git not installed' }, () => {
  const root = makeProject({
    '.gitignore': 'web/.env.local\n',
    'api/.env': 'SECRET=1',
    'web/.env.local': 'SECRET=1',
    'web/.env.production': 'SECRET=1',
    '.env.example': 'SECRET=',
  });
  gitInit(root, ['api/.env', '.gitignore']);
  const r = scan(root);
  assert.equal(r.gitChecked, true);
  assert.deepEqual(r.secrets.sort((a, b) => a.file.localeCompare(b.file)), [
    { file: 'api/.env', problem: 'committed' },
    { file: 'web/.env.production', problem: 'not-ignored' },
  ]);
});

test('git checks are skipped outside a repository', () => {
  const root = makeProject({ '.env': 'SECRET=1' });
  const r = scan(root);
  assert.equal(r.gitChecked, false);
  assert.deepEqual(r.secrets, []);
});
