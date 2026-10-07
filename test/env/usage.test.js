import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEnvUsage } from '../../src/checks/env/usage.js';
import { parseEnvKeys, isSecretEnvFile } from '../../src/checks/env/envfile.js';

const names = (/** @type {string} */ src, file = 'a.ts') => findEnvUsage(src, file).map((u) => u.name);

test('Node: process.env in every form', () => {
  const src = `
const a = process.env.API_KEY;
const b = process.env['DB_URL'];
const c = process.env["REDIS_URL"];
const d = process.env?.OPTIONAL_FLAG;
const { STRIPE_KEY, SENTRY_DSN: dsn, PORT = 3000, ...rest } = process.env;
`;
  assert.deepEqual(names(src), ['API_KEY', 'DB_URL', 'REDIS_URL', 'OPTIONAL_FLAG', 'STRIPE_KEY', 'SENTRY_DSN', 'PORT']);
});

test('Vite, Bun and Deno', () => {
  const src = `
const url = import.meta.env.VITE_API_URL;
const k = import.meta.env['VITE_KEY'];
const b = Bun.env.BUN_TOKEN;
const d = Deno.env.get("DENO_TOKEN");
`;
  assert.deepEqual(names(src), ['VITE_API_URL', 'VITE_KEY', 'BUN_TOKEN', 'DENO_TOKEN']);
});

test('SvelteKit $env modules, static and dynamic', () => {
  const src = `<script>
  import { SUPABASE_URL, SUPABASE_KEY as key } from '$env/static/private';
  import { PUBLIC_SITE } from '$env/static/public';
  import { env } from '$env/dynamic/private';
  import { env as pub } from '$env/dynamic/public';
  const s = env.STRIPE_SECRET;
  const m = pub.PUBLIC_MAPS_KEY;
  const x = env['WEBHOOK_SECRET'];
</script>`;
  assert.deepEqual(names(src, 'page.svelte'), [
    'SUPABASE_URL', 'SUPABASE_KEY', 'PUBLIC_SITE', 'STRIPE_SECRET', 'PUBLIC_MAPS_KEY', 'WEBHOOK_SECRET',
  ]);
});

test('Python: os.environ and getenv', () => {
  const src = `
import os
from os import getenv, environ
A = os.environ["DATABASE_URL"]
B = os.environ.get('REDIS_URL', 'x')
C = os.getenv("SECRET_KEY")
D = getenv('DEBUG')
E = environ["PLAIN_ENVIRON"]
F = os.environ.setdefault("TZ_NAME", "UTC")
`;
  assert.deepEqual(names(src, 'app.py'), ['DATABASE_URL', 'REDIS_URL', 'SECRET_KEY', 'DEBUG', 'PLAIN_ENVIRON', 'TZ_NAME']);
});

test('Prisma env()', () => {
  const src = `datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n  // directUrl = env("OLD_URL")\n}`;
  assert.deepEqual(names(src, 'schema.prisma'), ['DATABASE_URL']);
});

test('ignores comments, docstrings and text inside template literals', () => {
  const js = `
// process.env.LINE_COMMENT
/* process.env.BLOCK_COMMENT */
const help = \`set process.env.IN_TEMPLATE_TEXT first\`;
const real = \`\${process.env.IN_TEMPLATE_EXPR}\`;
<!-- process.env.HTML_COMMENT -->
`;
  assert.deepEqual(names(js, 'a.svelte'), ['IN_TEMPLATE_EXPR']);

  const py = `"""Use os.getenv("IN_DOCSTRING")."""\nx = os.getenv("REAL")  # os.getenv("IN_COMMENT")`;
  assert.deepEqual(names(py, 'a.py'), ['REAL']);
});

test('does not confuse similar-looking code', () => {
  const src = `config.process.env.NOPE; myprocess.env.NOPE2; process.env.hasOwnProperty('x');`;
  assert.deepEqual(names(src), []);
});

test('reports line and column of the name', () => {
  const [u] = findEnvUsage(`const a = 1;\nconst key = process.env.API_KEY;`, 'a.js');
  assert.deepEqual(u, { name: 'API_KEY', line: 2, column: 25 });
});

test('parseEnvKeys handles comments, export, quotes and multi-line values', () => {
  const text = [
    '# comment',
    'A=1',
    'export B="two"',
    '  C = spaced',
    'PRIVATE_KEY="-----BEGIN',
    'NOT_A_KEY=inside the value',
    '-----END"',
    "D='single'",
    'not valid line',
    'E=',
  ].join('\r\n');
  assert.deepEqual(parseEnvKeys(text).map((k) => k.name), ['A', 'B', 'C', 'PRIVATE_KEY', 'D', 'E']);
  assert.equal(parseEnvKeys(text).find((k) => k.name === 'D')?.line, 8);
});

test('isSecretEnvFile tells real env files from templates', () => {
  for (const f of ['.env', '.env.local', '.env.production', '.env.development.local']) assert.ok(isSecretEnvFile(f), f);
  for (const f of ['.env.example', '.env.sample', '.env.template', '.env.dist', 'example.env', '.envrc', 'env.ts', '.env.defaults'])
    assert.ok(!isSecretEnvFile(f), f);
});
