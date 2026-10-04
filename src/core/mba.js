'use strict';
const { randInt } = require('./util');

function fmtNum(n, suffix = '') {
  const useHex = randInt(0, 1) === 1;
  const base = useHex ? '0x' + n.toString(16) : String(n);
  return base + suffix;
}

/**
 * Generate a Mixed Boolean-Arithmetic (MBA) expression that evaluates
 * identically to non-negative integer `val` across C, C++, Java, Rust, JS,
 * Python, and Ruby.
 *
 * Uses exact bit-level identities:
 *   x ^ y == (x | y) - (x & y)
 *   x + y == (x ^ y) + ((x & y) << 1)
 *   x + y == (x | y) + (x & y)
 */
function mbaInt(val, { depth = 2, rustType = '' } = {}) {
  const v = Number(val);
  if (!Number.isInteger(v) || v < 0 || v > 0x7fffffff) {
    return String(val) + rustType;
  }

  const sfx = rustType || '';

  function build(n, d) {
    if (d <= 0) {
      return fmtNum(n, sfx);
    }
    const mode = randInt(0, 2);
    if (mode === 0) {
      // Identity: n = a ^ m = (a | m) - (a & m)
      const m = randInt(1, 255);
      const a = (n ^ m) >>> 0;
      const left = fmtNum(a, sfx);
      const right = d > 1 ? build(m, d - 1) : fmtNum(m, sfx);
      return `((${left} | ${right}) - (${left} & ${right}))`;
    } else if (mode === 1) {
      // Identity: n = a + b = (a ^ b) + ((a & b) << 1)
      const a = n > 0 ? randInt(0, n) : 0;
      const b = n - a;
      const left = d > 1 ? build(a, d - 1) : fmtNum(a, sfx);
      const right = fmtNum(b, sfx);
      return `((${left} ^ ${right}) + ((${left} & ${right}) << ${fmtNum(1, '')}))`;
    } else {
      // Identity: n = a + b = (a | b) + (a & b)
      const a = n > 0 ? randInt(0, n) : 0;
      const b = n - a;
      const left = fmtNum(a, sfx);
      const right = d > 1 ? build(b, d - 1) : fmtNum(b, sfx);
      return `((${left} | ${right}) + (${left} & ${right}))`;
    }
  }

  return build(v, depth);
}

/**
 * Safely replace standalone small positive integer literals in source code
 * with equivalent MBA expressions, skipping strings, comments, floats,
 * identifiers, preprocessor directives, and switch-case labels.
 */
function obfuscateNumbers(src, { rate = 0.5, depth = 1, rustType = '' } = {}) {
  const lines = src.split('\n');
  const outLines = lines.map((line) => {
    const trimmed = line.trim();
    // Skip preprocessor, comments, case labels, imports/annotations
    if (
      trimmed.startsWith('#') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('@') ||
      /\bcase\s+\d+/.test(trimmed)
    ) {
      return line;
    }

    // Tokenize line to avoid strings and inline comments
    let res = '';
    let i = 0;
    const n = line.length;
    while (i < n) {
      const ch = line[i];
      // Inline comment
      if ((ch === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) || ch === '#') {
        res += line.slice(i);
        break;
      }
      // Quoted literal
      if (ch === '"' || ch === "'" || ch === '`') {
        const q = ch;
        let j = i + 1;
        while (j < n && line[j] !== q) {
          if (line[j] === '\\') j++;
          j++;
        }
        res += line.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      // Check for standalone decimal integer literal (1..9999)
      const prev = i > 0 ? line[i - 1] : '';
      if (/[0-9]/.test(ch) && !/[A-Za-z0-9_.$[\]#]/.test(prev)) {
        let j = i;
        while (j < n && /[0-9]/.test(line[j])) j++;
        const next = j < n ? line[j] : '';
        // Skip floats (3.14), hex/typed suffixes (0x, 10i64), array indices ([0]), or object keys (0:)
        if (!/[A-Za-z0-9_.$:\]]/.test(next)) {
          const numStr = line.slice(i, j);
          const val = parseInt(numStr, 10);
          if (val >= 1 && val <= 9999 && randInt(1, 100) <= Math.round(rate * 100)) {
            res += mbaInt(val, { depth, rustType });
            i = j;
            continue;
          }
        }
        res += line.slice(i, j);
        i = j;
        continue;
      }
      res += ch;
      i++;
    }
    return res;
  });
  return outLines.join('\n');
}

module.exports = { mbaInt, obfuscateNumbers };
