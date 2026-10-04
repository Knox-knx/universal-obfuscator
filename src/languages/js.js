'use strict';
const { findStringLiterals, unescapeC } = require('../core/cLikeStrings');
const { injectJunk } = require('../core/junkInjector');
const { renameLocals } = require('../core/jsIdentifierRenamer');
const { stripCComments } = require('../core/cFamilyBase');
const { createCipherProfile, encryptString, jsDecoderSnippet } = require('../core/cipher');
const { mbaInt, obfuscateNumbers } = require('../core/mba');
const { randId, randInt, shuffle } = require('../core/util');

/**
 * Convert simple template literals `Hello ${name}!` into ("Hello " + (name) + "!")
 * so their static text chunks are encrypted alongside standard strings.
 */
function decomposeTemplateLiterals(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const chunk = end === -1 ? src.slice(i) : src.slice(i, end);
      out += chunk;
      i += chunk.length;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const chunk = end === -1 ? src.slice(i) : src.slice(i, end + 2);
      out += chunk;
      i += chunk.length;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < n && src[j] !== q) {
        if (src[j] === '\\') j++;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '`') {
      // Skip tagged templates like String.raw`...`
      const prev = i > 0 ? src[i - 1] : '';
      if (/[A-Za-z0-9_$)\]]/.test(prev)) {
        let j = i + 1;
        while (j < n && src[j] !== '`') {
          if (src[j] === '\\') j++;
          j++;
        }
        out += src.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      let j = i + 1;
      let body = '';
      let valid = true;
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') {
          body += src[j] + (src[j + 1] || '');
          j += 2;
        } else if (src[j] === '\n' || src[j] === '\r') {
          valid = false;
          body += src[j++];
        } else {
          body += src[j++];
        }
      }
      if (valid && j < n) {
        const parts = [];
        let k = 0;
        let textBuf = '';
        let ok = true;
        while (k < body.length) {
          if (body[k] === '$' && body[k + 1] === '{') {
            const closeIdx = body.indexOf('}', k + 2);
            if (closeIdx === -1) {
              ok = false;
              break;
            }
            const expr = body.slice(k + 2, closeIdx).trim();
            if (!expr || /[`{}]/.test(expr)) {
              ok = false;
              break;
            }
            if (textBuf.length > 0) {
              parts.push(JSON.stringify(unescapeC(textBuf)));
              textBuf = '';
            }
            parts.push(`(${expr})`);
            k = closeIdx + 1;
          } else {
            textBuf += body[k++];
          }
        }
        if (ok) {
          if (textBuf.length > 0) parts.push(JSON.stringify(unescapeC(textBuf)));
          out += parts.length ? `(${parts.join(' + ')})` : '""';
          i = j + 1;
          continue;
        }
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Rewrite safe standard method accesses (`console.log`, `Math.max`, etc.)
 * into bracket notation `console["log"]` before string encryption so property
 * names are hidden inside the encrypted string pool.
 */
function indirectStandardProperties(src) {
  const SAFE_OBJS = '(?:console|Math|JSON|Object|Array|Number|String|Date|document|window)';
  const re = new RegExp(`\\b(${SAFE_OBJS})\\.([A-Za-z_$][A-Za-z0-9_$]*)\\b`, 'g');
  return src.replace(re, '$1["$2"]');
}

/**
 * Encode all JS string literals into a shuffled string pool indexed by MBA
 * expressions and decrypted at runtime with the PNSC stream cipher.
 */
function encodeJsStringsPool(src, profile, { useMba = true, mbaDepth = 2 } = {}) {
  const literals = findStringLiterals(src, { allowSingleQuote: true, lang: 'js' });
  if (literals.length === 0) return { code: src, used: false, poolSnippet: '', count: 0 };

  const entries = literals.map((lit, idx) => {
    const { encoded, packedKey } = encryptString(lit.value, profile);
    return { lit, encoded, packedKey, origIdx: idx };
  });

  // Shuffle pool order so pool indices don't match source order
  const shuffled = shuffle(entries);
  const poolIndexByOrig = new Array(entries.length);
  shuffled.forEach((item, poolIdx) => {
    poolIndexByOrig[item.origIdx] = poolIdx;
  });

  const poolVar = randId('tbl');
  const poolFn = randId('str');

  let result = '';
  let cursor = 0;
  for (let i = 0; i < entries.length; i++) {
    const { lit, packedKey } = entries[i];
    const poolIdx = poolIndexByOrig[i];
    const idxExpr = useMba ? mbaInt(poolIdx, { depth: mbaDepth }) : String(poolIdx);
    const keyExpr = useMba ? mbaInt(packedKey, { depth: mbaDepth }) : String(packedKey);
    result += src.slice(cursor, lit.start) + `${poolFn}(${idxExpr}, ${keyExpr})`;
    cursor = lit.end;
  }
  result += src.slice(cursor);

  const poolItems = shuffled.map((item) => `"${item.encoded}"`).join(', ');
  const idxParam = randId('x');
  const keyParam = randId('k');
  const poolSnippet =
    `var ${poolVar} = [${poolItems}];\n` +
    jsDecoderSnippet(profile) +
    `function ${poolFn}(${idxParam}, ${keyParam}) { return ${profile.fnName}(${poolVar}[${idxParam}], ${keyParam}); }\n`;

  return { code: result, used: true, poolSnippet, count: entries.length };
}

/**
 * Control-flow flattening with randomly shuffled state IDs and MBA transitions.
 */
function flattenTopLevelStatements(src, { mbaDepth = 1 } = {}) {
  const lines = src.split('\n');
  const isSimple = (line) =>
    /^[\t ]*[A-Za-z_$][^{}]*;[\t ]*$/.test(line) &&
    !/^\s*(if|for|while|switch|function|return|else|do|try|catch|finally|class|import|export|const|let)\b/.test(
      line.trim()
    );

  let depth = 0;
  const depths = lines.map((line) => {
    const before = depth;
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
    return before;
  });

  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (isSimple(lines[i])) {
      const runDepth = depths[i];
      const run = [];
      let j = i;
      while (j < lines.length && isSimple(lines[j]) && depths[j] === runDepth) {
        run.push(lines[j].trim());
        j++;
      }
      if (run.length >= 2) {
        const stateVar = randId('st');
        const stateIds = [];
        const usedIds = new Set();
        while (stateIds.length <= run.length) {
          const sid = randInt(101, 8999);
          if (!usedIds.has(sid)) {
            usedIds.add(sid);
            stateIds.push(sid);
          }
        }
        const order = shuffle(run.map((_, idx) => idx));
        const endState = stateIds[run.length];
        const caseBlocks = order
          .map((idx) => {
            const nextExpr = mbaInt(stateIds[idx + 1], { depth: mbaDepth });
            return `    case ${stateIds[idx]}: ${run[idx]} ${stateVar} = ${nextExpr}; break;`;
          })
          .join('\n');
        out.push(
          `var ${stateVar} = ${mbaInt(stateIds[0], { depth: mbaDepth })};`,
          `while (${stateVar} !== ${mbaInt(endState, { depth: mbaDepth })}) {`,
          `  switch (${stateVar}) {`,
          caseBlocks,
          `    default: ${stateVar} = ${endState}; break;`,
          '  }',
          '}'
        );
        i = j;
        continue;
      }
      out.push(lines[i]);
      i++;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join('\n');
}

function obfuscate(src, opts = {}) {
  const { level = 'heavy', mba = true } = opts;
  let code = src;
  const profile = createCipherProfile('dec');
  const useMba = mba && level !== 'light';
  const mbaDepth = level === 'max' ? 3 : level === 'heavy' ? 2 : 1;

  if (level === 'heavy' || level === 'max') {
    code = stripCComments(code);
    code = decomposeTemplateLiterals(code);
    code = indirectStandardProperties(code);
  }

  // 1. Rename local identifiers & function parameters first (token-safe)
  if (level === 'heavy' || level === 'max') {
    const { code: renamed } = renameLocals(code);
    code = renamed;
  }

  // 2. Obfuscate standalone numeric literals with MBA before string pool injection
  if ((level === 'heavy' || level === 'max') && useMba) {
    code = obfuscateNumbers(code, {
      rate: level === 'max' ? 0.9 : 0.5,
      depth: level === 'max' ? 2 : 1,
    });
  }

  // 3. Encrypt all strings into a shuffled PNSC string pool
  const { code: encCode, used, poolSnippet, count: strCount } = encodeJsStringsPool(code, profile, {
    useMba,
    mbaDepth,
  });
  code = encCode;

  // 4. Control-flow flattening with shuffled state IDs
  if (level === 'heavy' || level === 'max') {
    code = flattenTopLevelStatements(code, { mbaDepth: 1 });
  }

  // 5. Polymorphic number-theoretic opaque predicates
  if (level !== 'light') {
    code = injectJunk(code, 'js', { rate: level === 'max' ? 0.45 : level === 'heavy' ? 0.25 : 0.12 });
  }

  if (used) {
    code = poolSnippet + code;
  }

  // 6. In `max` mode, wrap the entire obfuscated JS payload in a second
  //    polymorphic stream-encrypted self-executing bootstrapper!
  if (level === 'max') {
    const wrapProfile = createCipherProfile('boot');
    const { encoded, packedKey } = encryptString(code, wrapProfile);
    const keyExpr = mbaInt(packedKey, { depth: 3 });
    code = `${jsDecoderSnippet(wrapProfile)}(Function(${wrapProfile.fnName}("${encoded}", ${keyExpr})))();\n`;
  }

  const notes = [
    `Encrypted ${strCount} string/property literal(s) into a shuffled string pool with Polymorphic Nibble-Stream Cipher + MBA indexing (universal Node.js & Browser TextDecoder).`,
    level === 'heavy' || level === 'max'
      ? 'Applied template-literal decomposition, property indirection, shuffled state-machine control-flow dispatch, and token-safe local/parameter renaming.'
      : 'Applied PNSC string pool encryption and polymorphic opaque predicates.',
    ...(level === 'max'
      ? ['Wrapped full obfuscated program in a second-stage polymorphic stream-encrypted dynamic bootstrapper (max level).']
      : []),
  ];
  return { code, notes };
}

module.exports = { obfuscate };
