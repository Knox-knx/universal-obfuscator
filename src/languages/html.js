'use strict';
const js = require('./js');
const { renameSelectors, obfuscateDeclarations, minify: minifyCss } = require('./css');
const { createCipherProfile, encryptString, jsDecoderSnippet } = require('../core/cipher');
const { mbaInt } = require('../core/mba');
const { randInt } = require('../core/util');

function minifyHtml(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\n\s*/g, '')
    .trim();
}

function applyClassMapping(html, mapping) {
  let out = html;
  for (const [key, value] of Object.entries(mapping)) {
    const name = key.slice(1);
    const replacement = value.slice(1);
    if (key.startsWith('.')) {
      out = out.replace(
        new RegExp(`(class\\s*=\\s*["'][^"']*)\\b${name}\\b([^"']*["'])`, 'g'),
        (m, pre, post) => `${pre}${replacement}${post}`
      );
      out = out.replace(
        new RegExp(`(querySelector(?:All)?\\s*\\(\\s*["'])\\.${name}\\b(["']\\s*\\))`, 'g'),
        `$1.${replacement}$2`
      );
    } else {
      out = out.replace(
        new RegExp(`(id\\s*=\\s*["'])${name}(["'])`, 'g'),
        `$1${replacement}$2`
      );
      out = out.replace(
        new RegExp(`(getElementById\\s*\\(\\s*["'])${name}(["']\\s*\\))`, 'g'),
        `$1${replacement}$2`
      );
      out = out.replace(
        new RegExp(`(querySelector(?:All)?\\s*\\(\\s*["'])#${name}\\b(["']\\s*\\))`, 'g'),
        `$1#${replacement}$2`
      );
    }
  }
  return out;
}

/**
 * Encode visible text nodes (outside <script> and <style>) into mixed
 * hexadecimal and decimal HTML character entities.
 */
function encodeHtmlTextEntities(html) {
  // Temporarily stash <script> and <style> blocks
  const stash = [];
  let work = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => {
    stash.push(m);
    return `__HTML_STASH_${stash.length - 1}__`;
  });

  work = work.replace(/>([^<>]+)</g, (m, text) => {
    if (!text.trim() || /^__HTML_STASH_\d+__$/.test(text.trim())) return m;
    let enc = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 32 && code < 127 && text[i] !== '&') {
        enc += randInt(0, 1) === 1 ? `&#x${code.toString(16)};` : `&#${code};`;
      } else {
        enc += text[i];
      }
    }
    return `>${enc}<`;
  });

  return work.replace(/__HTML_STASH_(\d+)__/g, (_, idx) => stash[Number(idx)]);
}

function obfuscate(src, opts = {}) {
  const { level = 'heavy', mba = true } = opts;
  let code = src;
  const notes = [];
  let mapping = {};

  // 1. Obfuscate inline <style> blocks
  code = code.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, cssSrc) => {
    const r = renameSelectors(cssSrc);
    mapping = { ...mapping, ...r.mapping };
    let body = r.code;
    if (level === 'heavy' || level === 'max') {
      body = obfuscateDeclarations(body, {
        escapeRate: level === 'max' ? 1.0 : 0.7,
        addDecoys: level === 'max',
      });
    }
    const minified = minifyCss(body);
    return `<style${attrs}>${minified}</style>`;
  });

  // 2. Synchronize selector renames across HTML attributes and DOM queries
  if (Object.keys(mapping).length) {
    code = applyClassMapping(code, mapping);
    notes.push(
      `Synchronized ${Object.keys(mapping).length} renamed CSS class/ID selector(s) across inline <style>, markup attributes, and DOM queries.`
    );
  }

  // 3. Obfuscate inline <script> blocks using universal browser-compatible JS pipeline
  code = code.replace(/<script((?:(?!src=)[^>])*)>([\s\S]*?)<\/script>/gi, (m, attrs, jsSrc) => {
    if (!jsSrc.trim()) return m;
    const { code: obfJs } = js.obfuscate(jsSrc, { level: level === 'max' ? 'heavy' : level, mba });
    return `<script${attrs}>${obfJs}</script>`;
  });
  notes.push('Obfuscated inline <script> blocks with universal browser-ready PNSC string pool + MBA state machine.');

  // 4. Encode text nodes as polymorphic hex/decimal HTML entities in heavy/max mode
  if (level === 'heavy' || level === 'max') {
    code = encodeHtmlTextEntities(code);
    notes.push('Encoded visible HTML text nodes into polymorphic hexadecimal/decimal character entities.');
  }

  // 5. Minify markup
  code = minifyHtml(code);

  // 6. In `max` mode, wrap the entire obfuscated HTML into a self-decoding
  //    PNSC stream-encrypted DOM bootstrapper!
  if (level === 'max') {
    const wrapProfile = createCipherProfile('html');
    const { encoded, packedKey } = encryptString(code, wrapProfile);
    const keyExpr = mbaInt(packedKey, { depth: 3 });
    code = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>${jsDecoderSnippet(
      wrapProfile
    )}document.open();document.write(${wrapProfile.fnName}("${encoded}",${keyExpr}));document.close();</script></body></html>`;
    notes.push('Wrapped entire HTML document in a Polymorphic Nibble-Stream Cipher (PNSC) self-decoding DOM bootstrapper (max level).');
  }

  return { code, notes, mapping };
}

module.exports = { obfuscate };
