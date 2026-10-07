// Tiny ANSI color helper shared by all checks.

/** @param {boolean} on */
export function colors(on) {
  /** @param {string} code */
  const wrap = (code) => (/** @type {string} */ s) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { red: wrap('31'), green: wrap('32'), yellow: wrap('33'), dim: wrap('2'), bold: wrap('1'), cyan: wrap('36') };
}
