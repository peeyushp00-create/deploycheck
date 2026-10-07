// The "env" check: environment variables used in code but not documented,
// unused documented variables, and real .env files exposed to git.

import { scan } from './scan.js';
import { addMissingToExamples } from './fix.js';
import { formatText, formatGithub } from './report.js';

/** @type {import('../../index.js').Check<import('./scan.js').ScanResult>} */
export default {
  id: 'env',
  title: 'Environment variables',
  description: 'Variables used in code but missing from .env.example, unused ones, and .env files exposed to git',

  run(root, opts) {
    const result = scan(root, {
      example: opts.example,
      ignoreVars: opts.ignoreVars,
      ignoreDirs: opts.ignoreDirs,
      git: opts.git,
    });
    if (opts.unused === false) result.unused = [];
    return result;
  },

  count(result, opts) {
    const unused = result.unused.length;
    return {
      errors: result.missing.length + result.secrets.length + (opts.strict ? unused : 0),
      warnings: opts.strict ? 0 : unused,
    };
  },

  fix(root, result) {
    if (!result.missing.length) return null;
    const { added, files } = addMissingToExamples(root, result.missing);
    result.missing = [];
    return `Added ${added} variable${added === 1 ? '' : 's'} to ${files.join(', ')}.`;
  },

  text: (result, opts) => formatText(result, { color: opts.color, showUnused: opts.unused !== false }),
  github: (result, opts) => formatGithub(result, { showUnused: opts.unused !== false }),
};
