// The "import case" check: imports whose letter case doesn't match the file on disk.

import { scan } from './scan.js';
import { applyFixes } from './fix.js';
import { formatText, formatGithub } from './report.js';

/** @type {import('../../index.js').Check<import('./scan.js').ScanResult>} */
export default {
  id: 'case',
  title: 'Import case',
  description: "Imports whose letter case doesn't match the file on disk (fine on Windows/macOS, broken on Linux)",

  run(root, opts) {
    const result = scan(root, { aliases: opts.aliases, ignore: opts.ignoreDirs });
    if (opts.collisions === false) result.collisions = [];
    return result;
  },

  count(result) {
    return { errors: result.issues.length + result.collisions.length, warnings: 0 };
  },

  fix(root, result) {
    if (!result.issues.some((i) => i.corrected)) return null;
    const { fixed, files } = applyFixes(root, result.issues);
    result.issues = result.issues.filter((i) => !i.corrected);
    return `Fixed ${fixed} import${fixed === 1 ? '' : 's'} in ${files.length} file${files.length === 1 ? '' : 's'}.`;
  },

  text: (result, opts) => formatText(result, opts),
  github: (result) => formatGithub(result),
};
