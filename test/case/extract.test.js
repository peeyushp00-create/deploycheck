import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImports, stripComments } from '../../src/checks/case/extract.js';

const specs = (/** @type {string} */ src, file = 'a.ts') => extractImports(src, file).map((r) => r.specifier);

test('finds every import form', () => {
  const src = `
import a from './a';
import { b, c } from "./b";
import * as d from './d';
import type { E } from './e';
import './side-effect.css';
import f, {
  g,
  h,
} from './multi-line';
export * from './reexport';
export { i } from './reexport-named';
const j = await import('./dynamic');
const k = require('./required');
import l = require('./ts-require');
`;
  assert.deepEqual(specs(src), [
    './a', './b', './d', './e', './side-effect.css', './multi-line',
    './reexport', './reexport-named', './dynamic', './required', './ts-require',
  ]);
});

test('ignores imports inside comments', () => {
  const src = `
// import x from './line-comment';
/* import y from './block-comment'; */
/**
 * import z from './jsdoc';
 */
import real from './real';
`;
  assert.deepEqual(specs(src), ['./real']);
});

test('does not treat "//" inside strings as a comment', () => {
  const src = `const url = "https://example.com"; import a from './after-url';`;
  assert.deepEqual(specs(src), ['./after-url']);
});

test('handles template literals with nested expressions', () => {
  const src = 'const s = `a ${ {x: 1}.x } // not a comment`;\nimport a from "./after-template";';
  assert.deepEqual(specs(src), ['./after-template']);
});

test('ignores code samples inside template literals', () => {
  const src = 'const sample = `import Fake from "./Fake";`;\nimport real from "./real";';
  assert.deepEqual(specs(src), ['./real']);
});

test('ignores method calls named import/require', () => {
  assert.deepEqual(specs(`loader.import('./no'); obj.require('./no2');`), []);
});

test('only reads <script> blocks in .svelte and .vue files', () => {
  const src = `<script lang="ts">
  import Button from './Button.svelte';
</script>

<p>Don't import './NotReal' — it's just text</p>

<script context="module">
  export { load } from './load';
</script>`;
  assert.deepEqual(specs(src, 'Page.svelte'), ['./Button.svelte', './load']);
  assert.deepEqual(specs(src, 'Comp.vue'), ['./Button.svelte', './load']);
});

test('reports correct line and column', () => {
  const src = `const x = 1;\n\nimport Thing from './thing';`;
  const [ref] = extractImports(src, 'a.ts');
  assert.equal(ref.line, 3);
  assert.equal(ref.column, 20);
  assert.equal(src.slice(ref.start, ref.end), './thing');
});

test('stripComments keeps offsets identical', () => {
  const src = `a // b\n/* c\nd */ e "f // g"`;
  const out = stripComments(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.ok(out.includes('"f // g"'));
});
