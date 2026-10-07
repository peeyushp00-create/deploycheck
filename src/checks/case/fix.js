// Rewrites mismatched import specifiers in place with the on-disk casing.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Apply fixes for every issue that has a corrected specifier.
 * Edits are applied from the end of each file backwards so offsets stay valid.
 * @param {string} rootDir
 * @param {import('./scan.js').CaseIssue[]} issues
 * @returns {{ fixed: number, files: string[] }}
 */
export function applyFixes(rootDir, issues) {
  /** @type {Map<string, import('./scan.js').CaseIssue[]>} */
  const byFile = new Map();
  for (const issue of issues) {
    if (!issue.corrected) continue;
    byFile.set(issue.file, [...(byFile.get(issue.file) ?? []), issue]);
  }

  let fixed = 0;
  for (const [file, list] of byFile) {
    const full = path.join(rootDir, file);
    let text = fs.readFileSync(full, 'utf8');
    for (const issue of [...list].sort((a, b) => b.start - a.start)) {
      // Only rewrite if the file still contains exactly what was scanned.
      if (text.slice(issue.start, issue.end) !== issue.specifier) continue;
      text = text.slice(0, issue.start) + issue.corrected + text.slice(issue.end);
      fixed++;
    }
    fs.writeFileSync(full, text);
  }
  return { fixed, files: [...byFile.keys()] };
}
