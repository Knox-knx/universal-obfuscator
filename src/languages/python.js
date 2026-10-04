'use strict';
const { encodeStrings } = require('../core/pyStrings');
const { createCipherProfile, encryptString, pyDecoderSnippet } = require('../core/cipher');
const { mbaInt, obfuscateNumbers } = require('../core/mba');
const { replaceIdentifiersSafe } = require('../core/jsIdentifierRenamer');
const { randId, randInt } = require('../core/util');

const PY_RESERVED = new Set([
  'self', 'cls', '__name__', '__main__', '__init__', '__file__', '__doc__',
  'True', 'False', 'None', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set',
  'tuple', 'bytes', 'bytearray', 'ord', 'chr', 'open', 'input', 'super',
  'type', 'object', 'Exception', 'ValueError', 'TypeError', 'KeyError'
]);

function pyJunkStatement(indent) {
  const a = randId('v');
  const n = randInt(3, 95);
  const m = randInt(5, 89);
  const k = mbaInt(randInt(11, 240), { depth: 1 });
  const v = randInt(0, 4);
  if (v === 0) {
    return `${indent}if ((${n} * (${n} + 1)) & 1) == 0: ${a} = ${k} ^ ${m}`;
  } else if (v === 1) {
    return `${indent}if ((${n} * ${n}) & 3) != 2: ${a} = (${k} + ${m}) ^ ${n}`;
  } else if (v === 2) {
    return `${indent}if ((${n} ^ ${m}) + ((${n} & ${m}) << 1)) == (${n} + ${m}): ${a} = ${k}`;
  } else if (v === 3) {
    return `${indent}if ((${n} | ${m}) - (${n} & ${m})) == (${n} ^ ${m}): ${a} = ${k} ^ ${n}`;
  }
  const odd = 2 * n + 1;
  return `${indent}if ((${odd} * ${odd}) & 7) == 1: ${a} = ${k}`;
}

/**
 * Indentation- and bracket-depth-aware opaque predicate injector for Python.
 */
function injectJunk(src, rate = 0.2) {
  const lines = src.split('\n');
  const out = [];
  let bracketDepth = 0;
  let inTriple = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    out.push(line);

    const prevBracketDepth = bracketDepth;
    const prevTriple = inTriple;

    // Update triple-quote and bracket depth state across this line
    let i = 0;
    while (i < line.length) {
      if (inTriple) {
        if (line.slice(i, i + 3) === inTriple) {
          inTriple = null;
          i += 3;
          continue;
        }
        if (line[i] === '\\') i += 2;
        else i++;
        continue;
      }
      const ch = line[i];
      if (ch === '#') break;
      if (line.slice(i, i + 3) === '"""' || line.slice(i, i + 3) === "'''") {
        inTriple = line.slice(i, i + 3);
        i += 3;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const q = ch;
        i++;
        while (i < line.length && line[i] !== q) {
          if (line[i] === '\\') i += 2;
          else i++;
        }
        i++;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') bracketDepth++;
      else if (ch === ')' || ch === ']' || ch === '}') bracketDepth = Math.max(0, bracketDepth - 1);
      i++;
    }

    if (prevTriple || inTriple || prevBracketDepth > 0 || bracketDepth > 0) continue;

    const trimmed = line.trim();
    const indent = (line.match(/^[\t ]*/) || [''])[0];
    const isCode = trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('@');
    const opensBlock = trimmed.endsWith(':') || trimmed.endsWith('\\') || trimmed.endsWith(',');
    const isCtrlJump = /^(return|break|continue|raise|pass|yield|import|from)\b/.test(trimmed);

    // Check next non-empty line for continuation clauses (else, elif, except, finally)
    let nextTrimmed = '';
    for (let k = idx + 1; k < lines.length; k++) {
      const nt = lines[k].trim();
      if (nt && !nt.startsWith('#')) {
        nextTrimmed = nt;
        break;
      }
    }
    const nextIsClause = /^(else|elif|except|finally)\b/.test(nextTrimmed);

    if (isCode && !opensBlock && !isCtrlJump && !nextIsClause && randInt(1, 1000) <= Math.round(rate * 1000)) {
      out.push(pyJunkStatement(indent));
    }
  }
  return out.join('\n');
}

/**
 * Token-safe local assignment target renamer for Python.
 */
function renameLocals(src) {
  const declRe = /^[\t ]*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/gm;
  const candidates = new Set();
  let m;
  while ((m = declRe.exec(src))) {
    const name = m[1];
    if (PY_RESERVED.has(name)) continue;
    if (new RegExp(`\\.${name}\\b`).test(src)) continue;
    if (new RegExp(`\\b(?:def|class|import|from|except|as|global|nonlocal)\\s+${name}\\b`).test(src)) continue;
    // Skip if used as a keyword argument `foo(name=...)`
    if (new RegExp(`[(,]\\s*${name}\\s*=`).test(src)) continue;
    candidates.add(name);
  }
  const mapping = {};
  for (const name of candidates) {
    mapping[name] = randId('v');
  }
  return replaceIdentifiersSafe(src, mapping, { commentHash: true });
}

function obfuscate(src, opts = {}) {
  const { level = 'heavy', mba = true } = opts;
  let shebang = '';
  let code = src;
  if (code.startsWith('#!')) {
    const nl = code.indexOf('\n');
    if (nl !== -1) {
      shebang = code.slice(0, nl + 1);
      code = code.slice(nl + 1);
    }
  }

  const profile = createCipherProfile('dec');
  const useMba = mba && level !== 'light';
  const mbaDepth = level === 'max' ? 3 : level === 'heavy' ? 2 : 1;

  // 1. Rename simple local variables first (token-safe)
  if (level === 'heavy' || level === 'max') {
    code = renameLocals(code);
  }

  // 2. Obfuscate standalone numeric literals with MBA before string cipher injection
  if ((level === 'heavy' || level === 'max') && useMba) {
    code = obfuscateNumbers(code, {
      rate: level === 'max' ? 0.85 : 0.45,
      depth: level === 'max' ? 2 : 1,
    });
  }

  // 3. Encrypt strings + decompose simple f-strings using PNSC stream cipher
  const { code: encCode, used, count: strCount } = encodeStrings(code, {
    profile,
    useMba,
    mbaDepth,
  });
  code = encCode;

  // 4. Inject polymorphic opaque predicates
  if (level !== 'light') {
    code = injectJunk(code, level === 'max' ? 0.4 : level === 'heavy' ? 0.25 : 0.12);
  }

  if (used) {
    code = pyDecoderSnippet(profile) + code;
  }

  // 5. In `max` mode, wrap the entire obfuscated Python module in a second
  //    polymorphic stream-encrypted dynamic exec bootstrapper!
  if (level === 'max') {
    const wrapProfile = createCipherProfile('boot');
    const { encoded, packedKey } = encryptString(code, wrapProfile);
    const keyExpr = mbaInt(packedKey, { depth: 3 });
    code = `${pyDecoderSnippet(wrapProfile)}exec(${wrapProfile.fnName}("${encoded}", ${keyExpr}))\n`;
  }

  code = shebang + code;

  const notes = [
    `Encrypted ${strCount} string/f-string literal(s) with zero-import Polymorphic Nibble-Stream Cipher + MBA keys.`,
    level === 'heavy' || level === 'max'
      ? 'Applied f-string decomposition, MBA numeric obfuscation, token-safe local variable renaming, and polymorphic opaque predicates.'
      : 'Applied PNSC string encryption and opaque predicates.',
    ...(level === 'max'
      ? ['Wrapped full obfuscated module in a second-stage polymorphic stream-encrypted exec bootstrapper (max level).']
      : []),
  ];
  return { code, notes };
}

module.exports = { obfuscate };
