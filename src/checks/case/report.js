// Output formats: readable text for terminals, JSON for tools, and
// GitHub Actions annotations so problems show inline on pull requests.

import { colors } from '../../colors.js';

/**
 * @param {import('./scan.js').CaseIssue} issue
 */
function advice(issue) {
  if (issue.corrected) return `use "${issue.corrected}"`;
  return `rename the file on disk${issue.actual ? ` ("${issue.actual}")` : ''} to match the import`;
}

/**
 * Human-readable report.
 * @param {import('./scan.js').ScanResult} result
 * @param {{ color?: boolean }} [opts]
 */
export function formatText(result, opts = {}) {
  const c = colors(!!opts.color);
  const lines = [];

  for (const issue of result.issues) {
    lines.push(`${c.cyan(`${issue.file}:${issue.line}:${issue.column}`)}  ${c.red('✖')} import "${issue.specifier}"`);
    lines.push(`  ${c.dim('→')} file on disk is ${c.bold(`"${issue.actual ?? '?'}"`)} — ${c.green(advice(issue))}`);
  }
  for (const col of result.collisions) {
    lines.push(`${c.cyan(col.dir + '/')}  ${c.yellow('⚠')} names differ only by case: ${col.names.join(', ')}`);
    lines.push(`  ${c.dim('→')} only one of these survives a checkout on Windows or macOS`);
  }

  const summary = `${result.filesScanned} files, ${result.importsChecked} imports checked`;
  if (!result.issues.length && !result.collisions.length) {
    lines.push(`${c.green('✔')} No case problems found ${c.dim(`(${summary})`)}`);
  } else {
    lines.push('');
    const parts = [];
    if (result.issues.length) parts.push(c.red(`${result.issues.length} import${result.issues.length === 1 ? '' : 's'} with wrong case`));
    if (result.collisions.length) parts.push(c.yellow(`${result.collisions.length} case collision${result.collisions.length === 1 ? '' : 's'}`));
    lines.push(`${parts.join(', ')} ${c.dim(`(${summary})`)}`);
    if (result.issues.some((i) => i.corrected)) lines.push(c.dim('Run with --fix to rewrite the imports automatically.'));
  }
  return lines.join('\n');
}

/** @param {string} s */
const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/**
 * GitHub Actions workflow commands, rendered as inline annotations on the PR diff.
 * @param {import('./scan.js').ScanResult} result
 */
export function formatGithub(result) {
  const lines = [];
  for (const issue of result.issues) {
    const msg = `Import "${issue.specifier}" does not match the file on disk ("${issue.actual ?? '?'}"). This works on Windows/macOS but fails on Linux. Fix: ${advice(issue)}.`;
    lines.push(`::error file=${issue.file},line=${issue.line},col=${issue.column},title=deploycheck (import case)::${esc(msg)}`);
  }
  for (const col of result.collisions) {
    lines.push(`::warning title=deploycheck (import case)::${esc(`${col.dir}/ contains names that differ only by case: ${col.names.join(', ')}`)}`);
  }
  return lines.join('\n');
}

/**
 * @param {import('./scan.js').ScanResult} result
 */
export function formatJson(result) {
  const issues = result.issues.map(({ start, end, ...rest }) => rest);
  return JSON.stringify({ ...result, issues }, null, 2);
}
