'use strict';
const { randXorKey, xorBytes, toBase64 } = require('./util');
const { encryptString, formatDecoderCall } = require('./cipher');
const { unescapeC } = require('./cLikeStrings');

/**
 * Decompose simple Python f-strings like f"Hello {name}!" into
 * concatenation of encrypted string chunks and str(expr).
 * Complex f-strings (with format specs `:`, conversions `!`, or nested quotes)
 * are left untouched for safety.
 */
function decomposeSimpleFString(rawContent, encodeChunkFn) {
  const parts = [];
  let i = 0;
  let textBuf = '';
  const n = rawContent.length;

  while (i < n) {
    if (rawContent[i] === '{') {
      if (rawContent[i + 1] === '{') {
        textBuf += '{';
        i += 2;
        continue;
      }
      const closeIdx = rawContent.indexOf('}', i + 1);
      if (closeIdx === -1) return null;
      const expr = rawContent.slice(i + 1, closeIdx).trim();
      // Bail out on format specifiers, conversions, nested braces, quotes, or backslashes
      if (!expr || /[{}:"'\\!]/.test(expr)) return null;
      if (textBuf.length > 0) {
        parts.push(encodeChunkFn(unescapeC(textBuf)));
        textBuf = '';
      }
      parts.push(`str(${expr})`);
      i = closeIdx + 1;
    } else if (rawContent[i] === '}') {
      if (rawContent[i + 1] === '}') {
        textBuf += '}';
        i += 2;
        continue;
      }
      return null;
    } else if (rawContent[i] === '\\') {
      textBuf += rawContent[i] + (rawContent[i + 1] || '');
      i += 2;
    } else {
      textBuf += rawContent[i];
      i++;
    }
  }

  if (textBuf.length > 0) {
    parts.push(encodeChunkFn(unescapeC(textBuf)));
  }
  if (parts.length === 0) return encodeChunkFn('');
  return `(${parts.join(' + ')})`;
}

function findStringLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // Check if we are at the start of an identifier/prefix or mid-identifier
    const prevChar = i > 0 ? src[i - 1] : '';
    let prefixLen = 0;
    if (!/[A-Za-z0-9_]/.test(prevChar)) {
      while (/[A-Za-z]/.test(src[i + prefixLen] || '') && prefixLen < 3) prefixLen++;
    }
    const afterPrefix = src[i + prefixLen];
    if (afterPrefix === '"' || afterPrefix === "'") {
      const prefix = src.slice(i, i + prefixLen).toLowerCase();
      const quoteChar = afterPrefix;
      const start = i;
      let j = i + prefixLen;
      const triple = src.slice(j, j + 3) === quoteChar.repeat(3);
      const q = triple ? quoteChar.repeat(3) : quoteChar;
      j += q.length;
      let value = '';
      while (j < n && src.slice(j, j + q.length) !== q) {
        if (src[j] === '\\') {
          value += src[j] + (src[j + 1] || '');
          j += 2;
        } else {
          value += src[j];
          j++;
        }
      }
      const end = j + q.length;
      if (prefixLen === 0 || prefix === 'u') {
        out.push({ start, end, raw: src.slice(start, end), value: unescapeC(value), isFString: false });
      } else if (prefix === 'f' && !triple) {
        out.push({ start, end, raw: src.slice(start, end), rawBody: value, isFString: true });
      }
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

function encodeStrings(src, {
  minLen = 1,
  callWrap,
  profile = null,
  useMba = true,
  mbaDepth = 2,
} = {}) {
  const literals = findStringLiterals(src);
  if (literals.length === 0) return { code: src, used: false, count: 0 };

  const encodeChunk = (val) => {
    if (profile) {
      const { encoded, packedKey } = encryptString(val, profile);
      return callWrap
        ? callWrap(encoded, packedKey)
        : formatDecoderCall(profile.fnName, encoded, packedKey, { useMba, mbaDepth });
    }
    const key = randXorKey();
    const encoded = toBase64(xorBytes(Buffer.from(val, 'utf8'), key));
    return callWrap(encoded, key);
  };

  let result = '';
  let cursor = 0;
  let used = false;
  let count = 0;

  for (const lit of literals) {
    if (lit.isFString) {
      const decomposed = decomposeSimpleFString(lit.rawBody, encodeChunk);
      if (!decomposed) continue;
      result += src.slice(cursor, lit.start) + decomposed;
      cursor = lit.end;
      used = true;
      count++;
      continue;
    }
    if (lit.value.length < minLen) continue;
    result += src.slice(cursor, lit.start) + encodeChunk(lit.value);
    cursor = lit.end;
    used = true;
    count++;
  }
  result += src.slice(cursor);
  return { code: result, used, count };
}

module.exports = { findStringLiterals, encodeStrings };
