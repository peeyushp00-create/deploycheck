import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../../src/checks/case/scan.js';
import { applyFixes } from '../../src/checks/case/fix.js';
import { parseJsonc } from '../../src/checks/case/config.js';
import { makeProject, tmpIsCaseInsensitive } from '../helpers.js';

const pick = (/** @type {ReturnType<typeof scan>} */ r) => r.issues.map((i) => [i.specifier, i.corrected]);

test('passes a project with correct imports', () => {
  const root = makeProject({
    'src/main.ts': `import { App } from './App';\nimport helper from './utils/helper.js';\nimport react from 'react';`,
    'src/App.tsx': 'export const App = 1;',
    'src/utils/helper.js': 'export default 1;',
  });
  const result = scan(root);
  assert.deepEqual(result.issues, []);
  assert.equal(result.filesScanned, 3);
  assert.equal(result.importsChecked, 2); // "react" is a package and is skipped
});

test('flags a wrong-case file name and suggests the fix', () => {
  const root = makeProject({
    'src/index.ts': `import Studio from './components/Contentstudio';`,
    'src/components/ContentStudio.tsx': 'export default 1;',
  });
  const { issues } = scan(root);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].corrected, './components/ContentStudio');
  assert.equal(issues[0].actual, 'src/components/ContentStudio.tsx');
  assert.equal(issues[0].file, 'src/index.ts');
});

test('flags a wrong-case folder name', () => {
  const root = makeProject({
    'src/index.ts': `import x from './Components/button';`,
    'src/components/button.ts': '',
  });
  assert.deepEqual(pick(scan(root)), [['./Components/button', './components/button']]);
});

test('keeps the extension style the import was written with', () => {
  const root = makeProject({
    'src/a.ts': [
      `import a from './Widget.svelte';`, // full name
      `import b from './helper.js';`, // .js pointing at .ts (TypeScript ESM)
      `import c from './Data.json';`,
    ].join('\n'),
    'src/widget.svelte': '',
    'src/Helper.ts': '',
    'src/data.json': '{}',
  });
  assert.deepEqual(pick(scan(root)), [
    ['./Widget.svelte', './widget.svelte'],
    ['./helper.js', './Helper.js'],
    ['./Data.json', './data.json'],
  ]);
});

test('resolves directory imports through index files', () => {
  const root = makeProject({
    'src/a.ts': `import ok from './charts';\nimport bad from './Charts';`,
    'src/charts/index.ts': '',
  });
  assert.deepEqual(pick(scan(root)), [['./Charts', './charts']]);
});

test('keeps ?query and #hash suffixes', () => {
  const root = makeProject({
    'src/a.ts': `import svg from './Logo.svg?raw';`,
    'src/logo.svg': '<svg/>',
  });
  // .svg isn't a source file, but the import still has to resolve on Linux.
  assert.deepEqual(pick(scan(root)), [['./Logo.svg?raw', './logo.svg?raw']]);
});

test('ignores imports it cannot resolve (packages, generated or virtual modules)', () => {
  const root = makeProject({
    'src/a.ts': `import t from './$types';\nimport v from 'virtual:pwa';\nimport s from '$app/stores';`,
  });
  assert.deepEqual(scan(root).issues, []);
});

test('checks tsconfig path aliases, including extends and comments', () => {
  const root = makeProject({
    'tsconfig.base.json': `{
      // shared settings
      "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], }, },
    }`,
    'tsconfig.json': `{ "extends": "./tsconfig.base.json" }`,
    'src/pages/home.ts': `import Nav from '@/components/nav';`,
    'src/components/Nav.tsx': '',
  });
  assert.deepEqual(pick(scan(root)), [['@/components/nav', '@/components/Nav']]);
});

test('understands SvelteKit $lib without any config', () => {
  const root = makeProject({
    'svelte.config.js': 'export default {};',
    'src/routes/+page.svelte': `<script>\n  import Card from '$lib/ui/card.svelte';\n</script>`,
    'src/lib/ui/Card.svelte': '',
  });
  const { issues } = scan(root);
  assert.deepEqual(pick({ ...scan(root) }), [['$lib/ui/card.svelte', '$lib/ui/Card.svelte']]);
  assert.equal(issues[0].line, 2);
});

test('monorepos: each app uses its own tsconfig / SvelteKit aliases', () => {
  const root = makeProject({
    'frontend/svelte.config.js': 'export default {};',
    'frontend/src/routes/+page.svelte': `<script>\n  import Card from '$lib/Card.svelte';\n</script>`,
    'frontend/src/lib/card.svelte': '',
    'admin/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
    'admin/src/pages/home.ts': `import Nav from '@/Nav';`,
    'admin/src/nav.ts': '',
  });
  assert.deepEqual(pick(scan(root)), [
    ['@/Nav', '@/nav'],
    ['$lib/Card.svelte', '$lib/card.svelte'],
  ]);
});

test('supports extra aliases passed in options', () => {
  const root = makeProject({
    'src/a.ts': `import x from '~/Utils/x';`,
    'src/utils/x.ts': '',
  });
  assert.deepEqual(pick(scan(root, { aliases: { '~': 'src' } })), [['~/Utils/x', '~/utils/x']]);
});

test('skips node_modules, build output and ignored folders', () => {
  const root = makeProject({
    'node_modules/pkg/index.js': `import x from './Wrong';`,
    'node_modules/pkg/wrong.js': '',
    'dist/out.js': `import x from './Wrong';`,
    'dist/wrong.js': '',
    'generated/a.ts': `import x from './Wrong';`,
    'generated/wrong.ts': '',
  });
  const result = scan(root, { ignore: ['generated'] });
  assert.deepEqual(result.issues, []);
  assert.equal(result.filesScanned, 0);
});

test('--fix rewrites only the wrong imports', () => {
  const original = `import a from './Alpha';\nimport b from './beta';\nimport c from "./Gamma/Index";\n`;
  const root = makeProject({
    'src/a.ts': original,
    'src/alpha.ts': '',
    'src/beta.ts': '',
    'src/gamma/index.ts': '',
  });
  const { issues } = scan(root);
  const { fixed } = applyFixes(root, issues);
  assert.equal(fixed, 2);
  assert.equal(
    fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8'),
    `import a from './alpha';\nimport b from './beta';\nimport c from "./gamma/index";\n`,
  );
  assert.deepEqual(scan(root).issues, []);
});

test('reports names that differ only by case', { skip: tmpIsCaseInsensitive() && 'filesystem is case-insensitive' }, () => {
  const root = makeProject({ 'src/Button.tsx': '', 'src/button.tsx': '' });
  assert.deepEqual(scan(root).collisions, [{ dir: 'src', names: ['Button.tsx', 'button.tsx'] }]);
});

test('parseJsonc handles comments, trailing commas and slashes in strings', () => {
  assert.deepEqual(parseJsonc(`{ /* c */ "a": "http://x", // c\n "b": [1, 2,], }`), { a: 'http://x', b: [1, 2] });
});
