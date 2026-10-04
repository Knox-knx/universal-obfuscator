'use strict';
const { buildPipeline } = require('../core/cFamilyBase');
const { rustDecoderSnippet } = require('../core/cipher');

/**
 * Balanced-parenthesis rewriter for Rust's `println!(decFn(...))` ->
 * `println!("{}", decFn(...))` so nested MBA expressions in `decFn` are
 * matched completely.
 */
function fixPrintlnMacroArg(src, decFn) {
  const re = /\b(println|print|eprintln|eprint)!\s*\(/g;
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
        for (let k = decFn.length; k < inner.length; k++) {
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
          out += src.slice(cursor, fnCallStart) + `${m[1]}!("{}", ${inner})`;
          cursor = j;
          re.lastIndex = j;
        }
      }
    }
  }
  out += src.slice(cursor);
  return out;
}

const obfuscate = buildPipeline({
  lang: 'Rust',
  decoderSnippetFn: rustDecoderSnippet,
  junkLang: 'rust',
  rustType: 'u32',
  junkRate: (level) => (level === 'max' ? 0.4 : level === 'heavy' ? 0.22 : 0.1),
  postEncode: fixPrintlnMacroArg,
});

module.exports = { obfuscate };
