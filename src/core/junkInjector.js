'use strict';
const { randId, randInt } = require('./util');
const { mbaInt } = require('./mba');

/**
 * Build a polymorphic opaque-predicate block (including unreachable decoy
 * else-branches) in the target language's dialect.
 *
 * Uses 6 distinct number-theoretic and Mixed Boolean-Arithmetic (MBA)
 * tautologies/contradictions:
 *  0: ((n * (n + 1)) & 1) == 0          (product of consecutive ints is even)
 *  1: ((n * n) & 3) == 2                (always false: squares mod 4 in {0,1})
 *  2: ((n ^ m) + ((n & m) << 1)) == n+m (MBA addition identity)
 *  3: ((n | m) - (n & m)) != (n ^ m)    (always false: MBA XOR identity)
 *  4: (((2*n + 1)*(2*n + 1)) & 7) == 1  (odd square mod 8 is always 1)
 *  5: (n | m) >= (n & m)                (lattice inequality for non-negative ints)
 */
function junkBlock(lang) {
  const a = randId('v');
  const b = randId('w');
  const n = randInt(3, 95);
  const m = randInt(5, 89);
  const k = mbaInt(randInt(11, 240), { depth: 1, rustType: lang === 'rust' ? 'i64' : '' });
  const variant = randInt(0, 5);

  switch (lang) {
    case 'c':
    case 'cpp': {
      if (variant === 0) {
        return `if (((${n} * (${n} + 1)) & 1) == 0) { volatile int ${a} = ${k}; int ${b} = ${a} ^ ${m}; (void)${b}; }`;
      } else if (variant === 1) {
        return `if (((${n} * ${n}) % 4) != 2) { int ${a} = ${k}; int ${b} = (${a} + ${m}) ^ ${n}; (void)${b}; } else { int ${a} = ${n} ^ ${m}; (void)${a}; }`;
      } else if (variant === 2) {
        return `if (((${n} ^ ${m}) + ((${n} & ${m}) << 1)) == (${n} + ${m})) { int ${a} = ${k}; (void)${a}; }`;
      } else if (variant === 3) {
        return `if (((${n} | ${m}) - (${n} & ${m})) == (${n} ^ ${m})) { int ${a} = ${n} * ${m}; int ${b} = ${a} ^ ${k}; (void)${b}; }`;
      } else if (variant === 4) {
        const odd = 2 * n + 1;
        return `if (((${odd} * ${odd}) & 7) == 1) { int ${a} = ${k} ^ ${odd}; (void)${a}; }`;
      }
      return `if ((${n} | ${m}) >= (${n} & ${m})) { int ${a} = ${k}; int ${b} = ${a} ^ ${n}; (void)${b}; }`;
    }
    case 'java': {
      if (variant === 0) {
        return `if (((${n} * (${n} + 1)) & 1) == 0) { int ${a} = ${k}; int ${b} = ${a} ^ ${m}; if (${b} == -999999) System.out.print(""); }`;
      } else if (variant === 1) {
        return `if (((${n} * ${n}) & 3) != 2) { int ${a} = ${k}; int ${b} = (${a} + ${m}) ^ ${n}; } else { int ${a} = ${n} ^ ${m}; }`;
      } else if (variant === 2) {
        return `if (((${n} ^ ${m}) + ((${n} & ${m}) << 1)) == (${n} + ${m})) { int ${a} = ${k} ^ ${n}; }`;
      } else if (variant === 3) {
        return `if (((${n} | ${m}) - (${n} & ${m})) == (${n} ^ ${m})) { int ${a} = ${n} * ${m}; int ${b} = ${a} ^ ${k}; }`;
      } else if (variant === 4) {
        const odd = 2 * n + 1;
        return `if (((${odd} * ${odd}) & 7) == 1) { int ${a} = ${k} ^ ${odd}; }`;
      }
      return `if ((${n} | ${m}) >= (${n} & ${m})) { int ${a} = ${k}; int ${b} = ${a} ^ ${n}; }`;
    }
    case 'rust': {
      const odd = 2 * n + 1;
      if (variant === 0) {
        return `if ((${n}i64 * (${n}i64 + 1i64)) & 1i64) == 0i64 { let ${a}: i64 = ${k}; let ${b} = ${a} ^ ${m}i64; let _ = ${b}; }`;
      } else if (variant === 1) {
        return `if ((${n}i64 * ${n}i64) & 3i64) != 2i64 { let ${a}: i64 = ${k}; let ${b} = ${a}.wrapping_add(${m}i64); let _ = ${b}; } else { let ${a}: i64 = ${n}i64; let _ = ${a}; }`;
      } else if (variant === 2) {
        return `if ((${n}i64 ^ ${m}i64) + ((${n}i64 & ${m}i64) << 1)) == (${n}i64 + ${m}i64) { let ${a}: i64 = ${k}; let _ = ${a}; }`;
      } else if (variant === 3) {
        return `if ((${n}i64 | ${m}i64) - (${n}i64 & ${m}i64)) == (${n}i64 ^ ${m}i64) { let ${a}: i64 = ${k} ^ ${n}i64; let _ = ${a}; }`;
      } else if (variant === 4) {
        return `if ((${odd}i64 * ${odd}i64) & 7i64) == 1i64 { let ${a}: i64 = ${k}; let _ = ${a}; }`;
      }
      return `if (${n}i64 | ${m}i64) >= (${n}i64 & ${m}i64) { let ${a}: i64 = ${k}; let ${b} = ${a} ^ ${n}i64; let _ = ${b}; }`;
    }
    case 'js': {
      const odd = 2 * n + 1;
      if (variant === 0) {
        return `if (((${n} * (${n} + 1)) & 1) === 0) { var ${a} = ${k}; var ${b} = ${a} ^ ${m}; void ${b}; }`;
      } else if (variant === 1) {
        return `if (((${n} * ${n}) & 3) !== 2) { var ${a} = ${k}; var ${b} = (${a} + ${m}) ^ ${n}; void ${b}; } else { var ${a} = ${n} ^ ${m}; void ${a}; }`;
      } else if (variant === 2) {
        return `if (((${n} ^ ${m}) + ((${n} & ${m}) << 1)) === (${n} + ${m})) { var ${a} = ${k}; void ${a}; }`;
      } else if (variant === 3) {
        return `if (((${n} | ${m}) - (${n} & ${m})) === (${n} ^ ${m})) { var ${a} = (${n} * ${m}) ^ ${k}; void ${a}; }`;
      } else if (variant === 4) {
        return `if (((${odd} * ${odd}) & 7) === 1) { var ${a} = ${k} ^ ${odd}; void ${a}; }`;
      }
      return `if ((${n} | ${m}) >= (${n} & ${m})) { var ${a} = ${k}; var ${b} = ${a} ^ ${n}; void ${b}; }`;
    }
    default:
      return '';
  }
}

// Statements after which inserting more code is either dead or a compile error.
const NO_JUNK_AFTER = /\b(return|break|continue|throw|goto)\b[^;{}]*$/;
const TYPE_DECL_BLOCK = /\b(struct|class|enum|union|interface|namespace)\b[^{}]*$/;

/**
 * Safely insert polymorphic opaque-predicate junk blocks after eligible `;`
 * statements inside function/method bodies, skipping strings, comments,
 * `for (...; ...; ...)` headers, and class/struct member declarations.
 */
function injectJunk(src, lang, { rate = 0.15 } = {}) {
  let out = '';
  let depth = 0;
  let parenDepth = 0;
  let stmtBuf = '';
  const minDepth = lang === 'java' ? 2 : 1;
  const blockIsType = [];

  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];

    // Preserve line comments
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const chunk = end === -1 ? src.slice(i) : src.slice(i, end + 1);
      out += chunk;
      i += chunk.length;
      continue;
    }

    // Preserve block comments
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const chunk = end === -1 ? src.slice(i) : src.slice(i, end + 2);
      out += chunk;
      i += chunk.length;
      continue;
    }

    // Preserve string / char literals
    if (c === '"' || c === "'" || c === '`') {
      if (lang === 'rust' && c === "'") {
        // Check for char literal vs lifetime
        if (src[i + 1] === '\\' && src[i + 3] === "'") {
          out += src.slice(i, i + 4);
          i += 4;
          continue;
        } else if (src[i + 2] === "'") {
          out += src.slice(i, i + 3);
          i += 3;
          continue;
        }
        out += c;
        i++;
        continue;
      }
      const q = c;
      let j = i + 1;
      while (j < n && src[j] !== q) {
        if (src[j] === '\\') j++;
        j++;
      }
      const chunk = src.slice(i, j + 1);
      out += chunk;
      stmtBuf += chunk;
      i = j + 1;
      continue;
    }

    out += c;
    if (c === '(') {
      parenDepth++;
      stmtBuf += c;
    } else if (c === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      stmtBuf += c;
    } else if (c === '{') {
      const isType = TYPE_DECL_BLOCK.test(stmtBuf);
      blockIsType.push(isType);
      depth++;
      stmtBuf = '';
    } else if (c === '}') {
      blockIsType.pop();
      depth = Math.max(0, depth - 1);
      stmtBuf = '';
    } else if (c === ';') {
      const inTypeBody = blockIsType.length > 0 && blockIsType[blockIsType.length - 1];
      if (
        depth >= minDepth &&
        parenDepth === 0 &&
        !inTypeBody &&
        !NO_JUNK_AFTER.test(stmtBuf) &&
        randInt(1, 1000) <= Math.round(rate * 1000)
      ) {
        out += ' ' + junkBlock(lang);
      }
      stmtBuf = '';
    } else {
      stmtBuf += c;
    }
    i++;
  }
  return out;
}

module.exports = { injectJunk, junkBlock };
