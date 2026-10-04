'use strict';
const { randXorKey, xorBytes, toBase64 } = require('./util');
const { encryptString, formatDecoderCall } = require('./cipher');
const { unescapeC } = require('./cLikeStrings');

/**
 * Decompose simple Ruby interpolated strings `"Count is #{3}"` into
 * `(dec(...) + (3).to_s)` so static text inside interpolated strings is
 * encrypted as well.
 */
function decomposeRubyInterp(rawContent, encodeChunkFn) {
  const parts = [];
  let i = 0;
  let textBuf = '';
  const n = rawContent.length;

  while (i < n) {
    if (rawContent[i] === '#' && rawContent[i + 1] === '{') {
      const closeIdx = rawContent.indexOf('}', i + 2);
      if (closeIdx === -1) return null;
      const expr = rawContent.slice(i + 2, closeIdx).trim();
      if (!expr || /[{}'"\\]/.test(expr)) return null;
      if (textBuf.length > 0) {
        parts.push(encodeChunkFn(unescapeC(textBuf)));
        textBuf = '';
      }
      parts.push(`((${expr}).to_s)`);
      i = closeIdx + 1;
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
    if (c === "'" || c === '"') {
      const quote = c;
      const start = i;
      let j = i + 1;
      let value = '';
      let hasInterp = false;
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\') {
          value += src[j] + (src[j + 1] || '');
          j += 2;
          continue;
        }
        if (quote === '"' && src[j] === '#' && src[j + 1] === '{') hasInterp = true;
        value += src[j];
        j++;
      }
      const end = j + 1;
      out.push({
        start,
        end,
        raw: src.slice(start, end),
        rawBody: value,
        value: unescapeC(value),
        hasInterp,
      });
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
    if (lit.hasInterp) {
      const decomposed = decomposeRubyInterp(lit.rawBody, encodeChunk);
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
