'use strict';
const { randId, randInt } = require('../core/util');

function minify(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '')
    .trim();
}

/**
 * Encode a CSS identifier (such as a property name like `color` or `padding`)
 * using W3C standard CSS hex escapes (`\63\6f\6c\6f\72`) so static inspection
 * cannot read property declarations while browsers parse them natively.
 */
function hexEscapeCssIdent(ident, rate = 0.75) {
  let out = '';
  for (let i = 0; i < ident.length; i++) {
    const ch = ident[i];
    if (/[a-zA-Z]/.test(ch) && randInt(1, 100) <= Math.round(rate * 100)) {
      const hex = ch.charCodeAt(0).toString(16);
      // If next char in ident is hex-like [0-9a-fA-F], pad to 6 hex digits so no space is needed
      const next = ident[i + 1] || '';
      if (/[0-9a-fA-F]/.test(next)) {
        out += '\\' + hex.padStart(6, '0');
      } else {
        out += '\\' + hex;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Rename `.class` and `#id` selectors ONLY in selector contexts (outside
 * `{ ... }` declaration blocks, so hex colors like `#ff00aa` or URLs like
 * `bg.png` inside rule bodies are never corrupted).
 */
function renameSelectors(src) {
  const mapping = {};
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let depth = 0;
  let i = 0;
  const n = stripped.length;

  while (i < n) {
    const c = stripped[i];
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < n && stripped[j] !== q) {
        if (stripped[j] === '\\') j++;
        j++;
      }
      out += stripped.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '{') {
      // Check if this is an @media / @supports block (selectors still inside) or declaration block
      depth++;
      out += c;
      i++;
      continue;
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1);
      out += c;
      i++;
      continue;
    }
    // At top-level selector position (depth === 0)
    if (depth === 0 && (c === '.' || c === '#')) {
      const m = stripped.slice(i + 1).match(/^([A-Za-z_-][A-Za-z0-9_-]*)/);
      if (m) {
        const name = m[1];
        const key = c + name;
        if (!mapping[key]) {
          mapping[key] = c + randId(c === '.' ? 'c' : 'i');
        }
        out += mapping[key];
        i += 1 + name.length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return { code: out, mapping };
}

/**
 * Obfuscate CSS property names inside `{ ... }` declaration blocks using
 * W3C CSS hex escapes and optional decoy custom properties.
 */
function obfuscateDeclarations(src, { escapeRate = 0.7, addDecoys = true } = {}) {
  return src.replace(/\{([^{}]*)\}/g, (whole, body) => {
    const decls = body
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean);
    const obfDecls = decls.map((decl) => {
      const colonIdx = decl.indexOf(':');
      if (colonIdx === -1) return decl;
      const prop = decl.slice(0, colonIdx).trim();
      const val = decl.slice(colonIdx + 1).trim();
      if (prop.startsWith('--')) return `${prop}:${val}`;
      return `${hexEscapeCssIdent(prop, escapeRate)}:${val}`;
    });
    if (addDecoys && obfDecls.length > 0 && randInt(0, 1) === 1) {
      obfDecls.push(`--${randId('d')}:${randInt(0, 99)}`);
    }
    return `{${obfDecls.join(';')}}`;
  });
}

function obfuscate(src, opts = {}) {
  const { level = 'heavy', renameSelectors: doRename = true } = opts;
  let code = src;
  let mapping = {};

  if (doRename && level !== 'light') {
    const r = renameSelectors(code);
    code = r.code;
    mapping = r.mapping;
  }

  if (level === 'heavy' || level === 'max') {
    code = obfuscateDeclarations(code, {
      escapeRate: level === 'max' ? 1.0 : 0.7,
      addDecoys: level === 'max',
    });
  }

  code = minify(code);

  const notes = [
    `Renamed ${Object.keys(mapping).length} CSS class/ID selector(s) safely outside declaration blocks (preserving hex colors and URLs).`,
    level === 'heavy' || level === 'max'
      ? 'Applied W3C CSS hex-escape property obfuscation (`\\xx`), decoy custom properties, and minification.'
      : 'Applied CSS comment stripping and minification.',
  ];
  return { code, notes, mapping };
}

module.exports = { obfuscate, renameSelectors, obfuscateDeclarations, minify };
