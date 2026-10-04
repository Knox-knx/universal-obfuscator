'use strict';
const { encodeStrings } = require('./cLikeStrings');
const { injectJunk } = require('./junkInjector');
const { createCipherProfile } = require('./cipher');
const { mbaInt, obfuscateNumbers } = require('./mba');
const { randId, randInt, shuffle } = require('./util');

/**
 * Rewrite single-argument `printf(decFn(...))` or `wprintf(decFn(...))` to
 * `printf("%s", decFn(...))` using balanced parenthesis matching so nested
 * MBA expressions inside `decFn(...)` are handled accurately.
 */
function fixPrintfFormatArg(src, decFn) {
  const re = /\b(printf|wprintf)\s*\(/g;
  let out = '';
  let cursor = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    const fnCallStart = m.index;
    const openParen = m.index + m[0].length - 1;
    let depth = 1;
    let j = openParen + 1;
    let inStr = false;
    while (j < src.length && depth > 0) {
      if (src[j] === '"' && src[j - 1] !== '\\') inStr = !inStr;
      else if (!inStr) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') depth--;
      }
      j++;
    }
    if (depth === 0) {
      const inner = src.slice(openParen + 1, j - 1).trim();
      if (inner.startsWith(decFn + '(') && inner.endsWith(')')) {
        let d2 = 0;
        let inS2 = false;
        let singleCall = true;
        const startInnerParen = decFn.length;
        for (let k = startInnerParen; k < inner.length; k++) {
          if (inner[k] === '"' && inner[k - 1] !== '\\') inS2 = !inS2;
          else if (!inS2) {
            if (inner[k] === '(') d2++;
            else if (inner[k] === ')') {
              d2--;
              if (d2 === 0 && k < inner.length - 1) {
                singleCall = false;
                break;
              }
            }
          }
        }
        if (singleCall) {
          out += src.slice(cursor, fnCallStart) + `${m[1]}("%s", ${inner})`;
          cursor = j;
          re.lastIndex = j;
        }
      }
    }
  }
  out += src.slice(cursor);
  return out;
}

/**
 * Strip C/C++/Java/Rust comments (preserving string literals and preprocessor lines).
 */
function stripCComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      out += c;
      i++;
      while (i < n && src[i] !== q && src[i] !== '\n') {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] || '');
          i += 2;
        } else {
          out += src[i++];
        }
      }
      if (i < n) out += src[i++];
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Flatten contiguous runs of non-declaration simple statements inside function
 * bodies into a shuffled state-machine dispatcher with MBA transitions.
 */
function flattenSimpleStatements(src, lang) {
  const lines = src.split('\n');
  const minDepth = lang === 'java' ? 2 : 1;
  const declOrCtrl = /^\s*(?:if|else|for|while|do|switch|case|default|return|break|continue|goto|try|catch|finally|throw|int|long|short|char|float|double|unsigned|signed|void|size_t|ssize_t|bool|auto|const|static|extern|register|volatile|struct|union|enum|class|public|private|protected|final|let|mut|fn|pub|use|mod|impl|trait|type|match|loop|String|byte|std::|[A-Za-z_][A-Za-z0-9_:<>]*\s+[A-Za-z_*&])\b/;

  const isSimpleCallOrAssign = (line) => {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('@')) return false;
    if (/[{}]/.test(t) || !t.endsWith(';')) return false;
    if (declOrCtrl.test(t)) return false;
    return /^[A-Za-z_][A-Za-z0-9_.:!]*\s*(?:\(|=|\+=|-=|\*=|\^=|\|=|&=)/.test(t);
  };

  let depth = 0;
  const depths = lines.map((line) => {
    const before = depth;
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"' && line[i - 1] !== '\\') inStr = !inStr;
      else if (!inStr) {
        if (line[i] === '{') depth++;
        else if (line[i] === '}') depth = Math.max(0, depth - 1);
      }
    }
    return before;
  });

  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (depths[i] >= minDepth && isSimpleCallOrAssign(lines[i])) {
      const runDepth = depths[i];
      const run = [];
      let j = i;
      while (j < lines.length && depths[j] === runDepth && isSimpleCallOrAssign(lines[j])) {
        run.push(lines[j].trim());
        j++;
      }
      if (run.length >= 2) {
        const indent = (lines[i].match(/^[\t ]*/) || [''])[0];
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

        if (lang === 'rust') {
          const arms = order
            .map((idx) => {
              const nextExpr = mbaInt(stateIds[idx + 1], { depth: 1, rustType: 'i32' });
              return `${indent}        ${stateIds[idx]}i32 => { ${run[idx]} ${stateVar} = ${nextExpr}; }`;
            })
            .join('\n');
          out.push(
            `${indent}let mut ${stateVar}: i32 = ${mbaInt(stateIds[0], { depth: 1, rustType: 'i32' })};`,
            `${indent}while ${stateVar} != ${mbaInt(endState, { depth: 1, rustType: 'i32' })} {`,
            `${indent}    match ${stateVar} {`,
            arms,
            `${indent}        _ => { break; }`,
            `${indent}    }`,
            `${indent}}`
          );
        } else {
          const cases = order
            .map((idx) => {
              const nextExpr = mbaInt(stateIds[idx + 1], { depth: 1 });
              return `${indent}    case ${stateIds[idx]}: { ${run[idx]} ${stateVar} = ${nextExpr}; break; }`;
            })
            .join('\n');
          out.push(
            `${indent}int ${stateVar} = ${mbaInt(stateIds[0], { depth: 1 })};`,
            `${indent}while (${stateVar} != ${mbaInt(endState, { depth: 1 })}) {`,
            `${indent}  switch (${stateVar}) {`,
            cases,
            `${indent}    default: ${stateVar} = ${endState}; break;`,
            `${indent}  }`,
            `${indent}}`
          );
        }
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join('\n');
}

function buildPipeline({ lang, decoderSnippetFn, junkLang, junkRate, postEncode, rustType = '' }) {
  return function obfuscate(src, opts = {}) {
    const { level = 'heavy', mba = true } = opts;
    let code = src;
    const profile = createCipherProfile('dec');
    const decFn = profile.fnName;

    if (level === 'heavy' || level === 'max') {
      code = stripCComments(code);
    }

    if ((level === 'heavy' || level === 'max') && mba && junkLang !== 'rust') {
      code = obfuscateNumbers(code, {
        rate: level === 'max' ? 0.85 : 0.45,
        depth: level === 'max' ? 2 : 1,
      });
    }

    const useMba = mba && level !== 'light';
    const mbaDepth = level === 'max' ? 3 : level === 'heavy' ? 2 : 1;

    const { code: encCode, used, count: strCount } = encodeStrings(code, {
      profile,
      useMba,
      mbaDepth,
      rustType,
      lang: junkLang,
    });
    code = fixPrintfFormatArg(encCode, decFn);
    if (postEncode) code = postEncode(code, decFn, profile);

    if (level === 'heavy' || level === 'max') {
      code = flattenSimpleStatements(code, junkLang);
    }

    if (level !== 'light') {
      code = injectJunk(code, junkLang, { rate: junkRate(level) });
    }

    if (used) {
      const snippet = decoderSnippetFn(profile);
      if (snippet) {
        code = snippet + '\n' + code;
      }
    }

    const notes = [
      `Encrypted ${strCount} string literal(s) with Polymorphic Nibble-Stream Cipher (LCG rolling state + bit-rotation + CBC feedback, zero Base64 table).`,
      useMba
        ? `Applied Mixed Boolean-Arithmetic (MBA) depth-${mbaDepth} encoding to cipher keys and constants.`
        : 'MBA expression encoding skipped (light mode).',
      level === 'heavy' || level === 'max'
        ? `Applied shuffled state-machine control-flow dispatch and polymorphic number-theoretic opaque predicates for ${lang}.`
        : `Inserted polymorphic opaque predicates for ${lang}.`,
    ];
    return { code, notes, profile };
  };
}

module.exports = { buildPipeline, fixPrintfFormatArg, stripCComments, flattenSimpleStatements };
