'use strict';
const { encodeStrings } = require('../core/rubyStrings');
const { createCipherProfile, encryptString, rubyDecoderSnippet } = require('../core/cipher');
const { mbaInt, obfuscateNumbers } = require('../core/mba');
const { replaceIdentifiersSafe } = require('../core/jsIdentifierRenamer');
const { randId, randInt } = require('../core/util');

const RB_RESERVED = new Set([
  'self', 'nil', 'true', 'false', 'begin', 'end', 'def', 'class', 'module',
  'if', 'elsif', 'else', 'unless', 'case', 'when', 'while', 'until', 'for',
  'in', 'do', 'return', 'break', 'next', 'redo', 'retry', 'yield', 'super',
  'and', 'or', 'not', 'alias', 'defined?', 'rescue', 'ensure', 'then',
  'puts', 'print', 'p', 'require', 'require_relative', 'load', 'eval',
  'attr_reader', 'attr_writer', 'attr_accessor', 'private', 'protected', 'public',
  'new', 'initialize', 'to_s', 'to_i', 'to_a', 'length', 'size', 'bytes', 'pack'
]);

function rbJunkStatement(indent) {
  const a = randId('v');
  const n = randInt(3, 95);
  const m = randInt(5, 89);
  const k = mbaInt(randInt(11, 240), { depth: 1 });
  const v = randInt(0, 3);
  if (v === 0) {
    return `${indent}${a} = (${k} ^ ${m}) if ((${n} * (${n} + 1)) & 1) == 0`;
  } else if (v === 1) {
    return `${indent}${a} = ((${k} + ${m}) ^ ${n}) if ((${n} * ${n}) & 3) != 2`;
  } else if (v === 2) {
    return `${indent}${a} = ${k} if ((${n} ^ ${m}) + ((${n} & ${m}) << 1)) == (${n} + ${m})`;
  }
  return `${indent}${a} = (${k} ^ ${n}) if ((${n} | ${m}) - (${n} & ${m})) == (${n} ^ ${m})`;
}

/**
 * Inject polymorphic opaque predicates in Ruby while preserving implicit
 * return values (never injecting immediately before `end`, `else`, `elsif`,
 * `rescue`, `ensure`, or `when`).
 */
function injectJunk(src, rate = 0.2) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const trimmed = line.trim();
    const indent = (line.match(/^[\t ]*/) || [''])[0];
    const isCode = trimmed.length > 0 && !trimmed.startsWith('#');
    const isJumpOrEnd = /^(return|break|next|raise|end|else|elsif|rescue|ensure|when)\b/.test(trimmed);
    const continuesLine = /[\\,+\-*\/|&({\[]$/.test(trimmed);

    // Look ahead for next non-empty code line to avoid clobbering implicit returns before `end`/`else`
    let nextTrimmed = '';
    for (let k = i + 1; k < lines.length; k++) {
      const nt = lines[k].trim();
      if (nt && !nt.startsWith('#')) {
        nextTrimmed = nt;
        break;
      }
    }
    const nextClosesBlock = /^(end|else|elsif|rescue|ensure|when)\b/.test(nextTrimmed);

    if (
      isCode &&
      !isJumpOrEnd &&
      !continuesLine &&
      !nextClosesBlock &&
      randInt(1, 1000) <= Math.round(rate * 1000)
    ) {
      out.push(rbJunkStatement(indent));
    }
  }
  return out.join('\n');
}

/**
 * Rename simple local variable assignments (`name = ...`) in Ruby.
 */
function renameLocals(src) {
  const declRe = /^[\t ]*([a-z_][A-Za-z0-9_]*)\s*=(?!=|~)/gm;
  const candidates = new Set();
  let m;
  while ((m = declRe.exec(src))) {
    const name = m[1];
    if (RB_RESERVED.has(name)) continue;
    if (new RegExp(`[.:@]${name}\\b`).test(src)) continue;
    if (new RegExp(`\\bdef\\s+${name}\\b`).test(src)) continue;
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

  // 1. Rename simple local variables first (before string interpolation decomposition)
  if (level === 'heavy' || level === 'max') {
    code = renameLocals(code);
  }

  // 2. Obfuscate standalone numeric literals with MBA before string encoding
  if ((level === 'heavy' || level === 'max') && useMba) {
    code = obfuscateNumbers(code, {
      rate: level === 'max' ? 0.85 : 0.45,
      depth: level === 'max' ? 2 : 1,
    });
  }

  // 3. Encrypt strings + decompose #{...} interpolated strings using PNSC stream cipher
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
    code = rubyDecoderSnippet(profile) + code;
  }

  // 5. In `max` mode, wrap the entire obfuscated Ruby script in a second
  //    polymorphic stream-encrypted dynamic eval bootstrapper!
  if (level === 'max') {
    const wrapProfile = createCipherProfile('boot');
    const { encoded, packedKey } = encryptString(code, wrapProfile);
    const keyExpr = mbaInt(packedKey, { depth: 3 });
    code = `${rubyDecoderSnippet(wrapProfile)}eval(${wrapProfile.fnName}("${encoded}", ${keyExpr}))\n`;
  }

  code = shebang + code;

  const notes = [
    `Encrypted ${strCount} string literal(s) (including decomposed #{...} interpolations) with zero-require Polymorphic Nibble-Stream Cipher + MBA keys.`,
    level === 'heavy' || level === 'max'
      ? 'Applied interpolation decomposition, MBA numeric obfuscation, local variable renaming, and implicit-return-safe opaque predicates.'
      : 'Applied PNSC string encryption and opaque predicates.',
    ...(level === 'max'
      ? ['Wrapped full obfuscated script in a second-stage polymorphic stream-encrypted eval bootstrapper (max level).']
      : []),
  ];
  return { code, notes };
}

module.exports = { obfuscate };
