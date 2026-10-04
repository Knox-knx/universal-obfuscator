'use strict';
const { randId } = require('./util');

const RESERVED = new Set([
  'require', 'module', 'exports', 'process', 'console', 'window', 'document',
  'global', 'globalThis', 'Buffer', 'TextDecoder', 'TextEncoder', 'Uint8Array',
  'this', 'super', 'arguments', 'undefined', 'null', 'true', 'false', 'NaN', 'Infinity',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Function', 'Promise', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'Math', 'JSON', 'Symbol', 'Map', 'Set', 'Date',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'eval',
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'default', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
  'new', 'delete', 'typeof', 'instanceof', 'void', 'in', 'of', 'class', 'extends',
  'static', 'async', 'await', 'yield', 'import', 'export', 'from', 'as'
]);

/**
 * Token-aware identifier replacer that skips string literals and comments,
 * and avoids replacing property accesses (`obj.ident`) or object literal keys (`{ ident: ... }`).
 */
function replaceIdentifiersSafe(src, mapping, { commentHash = false } = {}) {
  if (!mapping || Object.keys(mapping).length === 0) return src;
  let out = '';
  let i = 0;
  const n = src.length;
  let lastNonSpace = '';

  while (i < n) {
    const c = src[i];

    // Line comments
    if ((c === '/' && src[i + 1] === '/') || (commentHash && c === '#')) {
      const end = src.indexOf('\n', i);
      const chunk = end === -1 ? src.slice(i) : src.slice(i, end);
      out += chunk;
      i += chunk.length;
      continue;
    }

    // Block comments
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const chunk = end === -1 ? src.slice(i) : src.slice(i, end + 2);
      out += chunk;
      i += chunk.length;
      continue;
    }

    // String literals
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < n && src[j] !== q) {
        if (src[j] === '\\') j++;
        j++;
      }
      const chunk = src.slice(i, j + 1);
      out += chunk;
      lastNonSpace = q;
      i = j + 1;
      continue;
    }

    // Identifier token
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const ident = src.slice(i, j);

      // Look ahead for next non-whitespace character
      let k = j;
      while (k < n && /[\t \r\n]/.test(src[k])) k++;
      const nextNonSpace = k < n ? src[k] : '';

      const isPropAccess = lastNonSpace === '.';
      const isObjKey =
        (nextNonSpace === ':' && src[k + 1] !== ':') &&
        (lastNonSpace === '{' || lastNonSpace === ',');
      const isShorthandObj =
        (lastNonSpace === '{' || lastNonSpace === ',') &&
        (nextNonSpace === '}' || nextNonSpace === ',');

      if (
        Object.prototype.hasOwnProperty.call(mapping, ident) &&
        !isPropAccess &&
        !isObjKey &&
        !isShorthandObj
      ) {
        out += mapping[ident];
      } else {
        out += ident;
      }
      lastNonSpace = ident[ident.length - 1];
      i = j;
      continue;
    }

    out += c;
    if (!/[\t \r\n]/.test(c)) lastNonSpace = c;
    i++;
  }
  return out;
}

/**
 * Rename `var/let/const NAME` declarations and function parameters safely.
 */
function renameLocals(src) {
  const candidates = new Set();

  // 1. var / let / const declarations
  const declRe = /\b(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b(?!\s*[:=]\s*function\s*\*?\()/g;
  let m;
  while ((m = declRe.exec(src))) {
    const name = m[1];
    if (!RESERVED.has(name)) candidates.add(name);
  }

  // 2. function parameters: function foo(a, b)
  const fnParamRe = /\bfunction(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^)]*)\)/g;
  while ((m = fnParamRe.exec(src))) {
    const params = m[1].split(',');
    for (const rawP of params) {
      const p = rawP.trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p) && !RESERVED.has(p)) {
        candidates.add(p);
      }
    }
  }

  const mapping = {};
  for (const name of candidates) {
    // Skip if used as a property access or object shorthand anywhere
    if (new RegExp(`\\.${name}\\b`).test(src)) continue;
    mapping[name] = randId('v');
  }

  const out = replaceIdentifiersSafe(src, mapping);
  return { code: out, mapping };
}

module.exports = { renameLocals, replaceIdentifiersSafe };
