'use strict';
const { randXorKey, xorBytes, toBase64 } = require('./util');
const { encryptString, formatDecoderCall } = require('./cipher');

/**
 * Single-pass C/JS/Java/Rust string unescaper so `\\n` is properly
 * unescaped to literal `\n` rather than backslash + newline.
 */
function unescapeC(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[++i];
      switch (next) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case '0': out += '\0'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case '"': out += '"'; break;
        case "'": out += "'"; break;
        case '\\': out += '\\'; break;
        case 'x': {
          const hex = s.slice(i + 1, i + 3);
          if (/^[0-9a-fA-F]{2}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 2;
          } else {
            out += 'x';
          }
          break;
        }
        case 'u': {
          const hex = s.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else {
            out += 'u';
          }
          break;
        }
        default:
          out += next;
          break;
      }
    } else {
      out += s[i];
    }
  }
  return out;
}

/**
 * Determine whether a string literal at [start, end) in `src` is in a
 * syntactic position that requires a compile-time constant literal
 * (e.g. #include "...", extern "C", #[attr = "..."], @Annotation("..."),
 * ES module import/export, or switch case label).
 */
function isCompileTimeOnlyContext(src, start, end, lang) {
  // Find start of current line
  const lineStart = src.lastIndexOf('\n', start - 1) + 1;
  const linePrefix = src.slice(lineStart, start).trim();

  // Preprocessor directives (#include, #pragma, #error, #line, etc.) or Rust attributes #[...]
  if (linePrefix.startsWith('#')) return true;

  // Java annotations (@SuppressWarnings("..."))
  if (linePrefix.startsWith('@')) return true;

  // `extern "C"` or `extern "system"` in C++ / Rust
  if (/\bextern\s*$/.test(linePrefix)) return true;

  // `case "...":` in switch statements
  if (/\bcase\s*$/.test(linePrefix)) return true;

  // ES module `import ... from "..."` or `export ... from "..."` or `import "..."`
  if (/^\s*(?:import|export)\b/.test(linePrefix)) return true;

  // Rust format macros with additional arguments or inline `{...}` interpolation
  // (single-arg literal without `{}` is handled by fixPrintlnMacroArg in rust.js)
  if (lang === 'rust') {
    const rawLit = src.slice(start + 1, end - 1);
    const afterQuote = src.slice(end).trimStart();
    if (
      /\b(?:println|print|eprintln|eprint|format|write|writeln|panic|assert|assert_eq|assert_ne)!\s*\(\s*$/.test(
        linePrefix
      )
    ) {
      if (rawLit.includes('{') || afterQuote.startsWith(',')) {
        return true;
      }
    }
    // Rust byte strings b"..." or raw strings r"..."
    if (start > 0 && /[brBR]/.test(src[start - 1])) {
      return true;
    }
  }

  // JS object property key `{"key": ...}` — check if followed by `:`
  if (lang === 'js') {
    const after = src.slice(end).trimStart();
    if (after.startsWith(':') && !linePrefix.includes('?')) {
      return true;
    }
  }

  return false;
}

/**
 * Extract double-quoted string literals (and single-quoted JS strings when
 * allowSingleQuote is true) from C-like source, respecting escape sequences,
 * line comments (//), block comments (/* *\/), and compile-time contexts.
 */
function findStringLiterals(src, { allowSingleQuote = false, lang = '' } = {}) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // skip line comments
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // skip block comments
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // handle single-quoted literals
    if (c === "'") {
      // In Rust, `'a` can be a lifetime token (e.g. `&'static str`), not a char literal!
      if (lang === 'rust') {
        let j = i + 1;
        if (src[j] === '\\') {
          j += 2;
          if (src[j] === "'") {
            i = j + 1;
            continue;
          }
        } else if (j + 1 < n && src[j + 1] === "'") {
          i = j + 2;
          continue;
        }
        // Lifetime like 'a or 'static — just advance past the apostrophe
        i++;
        continue;
      }
      const start = i;
      let j = i + 1;
      let value = '';
      while (j < n && src[j] !== "'" && src[j] !== '\n') {
        if (src[j] === '\\') {
          value += src[j] + (src[j + 1] || '');
          j += 2;
        } else {
          value += src[j];
          j++;
        }
      }
      const end = j + 1;
      if (allowSingleQuote && src[j] === "'" && !isCompileTimeOnlyContext(src, start, end, lang)) {
        out.push({ start, end, raw: src.slice(start, end), value: unescapeC(value) });
      }
      i = end;
      continue;
    }
    // capture double-quoted string
    if (c === '"') {
      const start = i;
      let j = i + 1;
      let value = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') {
          value += src[j] + (src[j + 1] || '');
          j += 2;
        } else {
          value += src[j];
          j++;
        }
      }
      const end = j + 1;
      if (!isCompileTimeOnlyContext(src, start, end, lang)) {
        out.push({ start, end, raw: src.slice(start, end), value: unescapeC(value) });
      }
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Replace every eligible string literal with a call to a runtime decoder.
 * Supports both the new Polymorphic Nibble-Stream Cipher (`profile`) and
 * legacy `callWrap(encoded, key)` callback.
 */
function encodeStrings(src, {
  minLen = 1,
  callWrap,
  profile = null,
  useMba = true,
  mbaDepth = 2,
  rustType = '',
  allowSingleQuote = false,
  lang = '',
} = {}) {
  const literals = findStringLiterals(src, { allowSingleQuote, lang });
  if (literals.length === 0) return { code: src, used: false, count: 0 };

  let result = '';
  let cursor = 0;
  let used = false;
  let count = 0;

  for (const lit of literals) {
    if (lit.value.length < minLen) continue;
    let replacement;
    if (profile) {
      const { encoded, packedKey } = encryptString(lit.value, profile);
      replacement = callWrap
        ? callWrap(encoded, packedKey)
        : formatDecoderCall(profile.fnName, encoded, packedKey, { useMba, mbaDepth, rustType });
    } else {
      const key = randXorKey();
      const encoded = toBase64(xorBytes(Buffer.from(lit.value, 'utf8'), key));
      replacement = callWrap(encoded, key);
    }
    result += src.slice(cursor, lit.start) + replacement;
    cursor = lit.end;
    used = true;
    count++;
  }
  result += src.slice(cursor);
  return { code: result, used, count };
}

module.exports = { findStringLiterals, encodeStrings, unescapeC };
