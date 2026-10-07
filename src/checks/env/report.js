// Output formats: readable text, JSON, and GitHub Actions annotations.

import { colors } from '../../colors.js';

/** @param {number} n @param {string} word */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {import('./scan.js').ScanResult} r
 * @param {{ color?: boolean, showUnused?: boolean }} [opts]
 */
export function formatText(r, opts = {}) {
  const c = colors(!!opts.color);
  const showUnused = opts.showUnused !== false;
  const lines = [];

  /** @type {Map<string, import('./scan.js').MissingVar[]>} */
  const byExample = new Map();
  for (const m of r.missing) byExample.set(m.example, [...(byExample.get(m.example) ?? []), m]);
  for (const [example, list] of byExample) {
    const note = list[0].exampleExists ? '' : c.dim(' (file does not exist yet)');
    lines.push(`${c.red('✖')} ${c.bold(`Missing from ${example}`)}${note}`);
    const width = Math.max(...list.map((m) => m.name.length));
    for (const m of list) {
      const first = m.usages[0];
      const more = m.usages.length > 1 ? c.dim(` +${m.usages.length - 1} more`) : '';
      lines.push(`  ${c.red(m.name.padEnd(width))}  ${c.cyan(`${first.file}:${first.line}:${first.column}`)}${more}`);
    }
    if (!list[0].exampleExists) {
      lines.push(c.dim(`  → create it with --fix, or point to the file you already use with --example <file>`));
    }
    lines.push('');
  }

  for (const s of r.secrets) {
    const why = s.problem === 'committed'
      ? 'is committed to git — anyone with the repo can read it'
      : 'is not in .gitignore — one `git add .` away from being committed';
    lines.push(`${c.red('✖')} ${c.bold(s.file)} ${why}`);
    const fix = s.problem === 'committed'
      ? `run: git rm --cached ${s.file}  then add it to .gitignore and rotate the secrets inside`
      : `add "${s.file.split('/').pop()}" to .gitignore`;
    lines.push(`  ${c.dim('→')} ${c.green(fix)}`);
    lines.push('');
  }

  if (showUnused && r.unused.length) {
    /** @type {Map<string, import('./scan.js').UnusedVar[]>} */
    const unusedBy = new Map();
    for (const u of r.unused) unusedBy.set(u.example, [...(unusedBy.get(u.example) ?? []), u]);
    for (const [example, list] of unusedBy) {
      lines.push(`${c.yellow('⚠')} ${c.bold(`Not used anywhere, listed in ${example}`)}`);
      lines.push(`  ${list.map((u) => c.yellow(u.name)).join(c.dim(', '))}`);
      lines.push('');
    }
  }

  const summary = `${plural(r.filesScanned, 'file')}, ${plural(r.variablesUsed, 'variable')} in use`;
  const errors = r.missing.length + r.secrets.length;
  if (!errors && !(showUnused && r.unused.length)) {
    lines.push(`${c.green('✔')} All environment variables are documented ${c.dim(`(${summary})`)}`);
  } else {
    const parts = [];
    if (r.missing.length) parts.push(c.red(`${plural(r.missing.length, 'undocumented variable')}`));
    if (r.secrets.length) parts.push(c.red(`${plural(r.secrets.length, 'exposed env file')}`));
    if (showUnused && r.unused.length) parts.push(c.yellow(`${plural(r.unused.length, 'unused variable')}`));
    lines.push(`${parts.join(', ')} ${c.dim(`(${summary})`)}`);
    if (r.missing.length) lines.push(c.dim('Run with --fix to add the missing variables to .env.example.'));
  }
  return lines.join('\n');
}

/** @param {string} s */
const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/**
 * @param {import('./scan.js').ScanResult} r
 * @param {{ showUnused?: boolean }} [opts]
 */
export function formatGithub(r, opts = {}) {
  const out = [];
  for (const m of r.missing) {
    for (const u of m.usages) {
      out.push(`::error file=${u.file},line=${u.line},col=${u.column},title=deploycheck (env)::${esc(
        `${m.name} is used here but not listed in ${m.example}. Add it so the next person (and your deploy) knows to set it.`,
      )}`);
    }
  }
  for (const s of r.secrets) {
    out.push(`::error file=${s.file},title=deploycheck (env)::${esc(
      s.problem === 'committed' ? `${s.file} is committed to git. Remove it and rotate its secrets.` : `${s.file} is not in .gitignore.`,
    )}`);
  }
  if (opts.showUnused !== false) {
    for (const u of r.unused) {
      out.push(`::warning file=${u.example},line=${u.line},title=deploycheck (env)::${esc(`${u.name} is listed but never used.`)}`);
    }
  }
  return out.join('\n');
}

/** @param {import('./scan.js').ScanResult} r */
export function formatJson(r) {
  return JSON.stringify(r, null, 2);
}
