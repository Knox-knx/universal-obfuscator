'use strict';
const { randId, randInt, randOddByte } = require('../core/util');
const { mbaInt } = require('../core/mba');
const { unescapeC } = require('../core/cLikeStrings');

function createBashProfile() {
  return {
    fnName: randId('dec'),
    mul: randOddByte(),
    add: randInt(5, 249),
    mask: randInt(1, 254),
  };
}

function encryptBashString(plainStr, profile) {
  const raw = Buffer.from(plainStr, 'utf8');
  const seed = randInt(1, 254);
  const rot = randInt(1, 7);
  const packedKey = (seed << 3) | rot;

  let state = seed;
  let hexOut = '';
  for (let i = 0; i < raw.length; i++) {
    state = (state * profile.mul + profile.add + (i & 0xFF)) & 0xFF;
    const p = raw[i];
    const x1 = (p ^ state) & 0xFF;
    const x2 = ((x1 << rot) | (x1 >>> (8 - rot))) & 0xFF;
    const c = (x2 + state) & 0xFF;
    state = (state ^ c) & 0xFF;
    const masked = (c ^ profile.mask) & 0xFF;
    hexOut += masked.toString(16).padStart(2, '0');
  }
  return { encoded: hexOut, packedKey };
}

function bashDecoderSnippet(profile) {
  const s = randId('s');
  const k = randId('k');
  const len = randId('n');
  const st = randId('st');
  const rt = randId('rt');
  const i = randId('i');
  const out = randId('o');
  const c = randId('c');
  const x2 = randId('x');
  const x1 = randId('y');
  const p = randId('p');
  const hx = randId('h');

  const mulE = mbaInt(profile.mul, { depth: 1 });
  const addE = mbaInt(profile.add, { depth: 1 });
  const maskE = mbaInt(profile.mask, { depth: 1 });

  return `${profile.fnName}() {
  local ${s}="$1" ${k}="$2"
  local ${len}=$(( \${#${s}} >> 1 )) ${st}=$(( (${k} >> 3) & 255 )) ${rt}=$(( ${k} & 7 )) ${i}=0 ${out}="" ${c} ${x2} ${x1} ${p} ${hx}
  while (( ${i} < ${len} )); do
    ${c}=$(( (16#\${${s}:${i}*2:2} ^ ${maskE}) & 255 ))
    ${st}=$(( (${st} * ${mulE} + ${addE} + (${i} & 255)) & 255 ))
    ${x2}=$(( (${c} + 256 - ${st}) & 255 ))
    ${x1}=$(( ((${x2} >> ${rt}) | (${x2} << (8 - ${rt}))) & 255 ))
    ${p}=$(( (${x1} ^ ${st}) & 255 ))
    ${st}=$(( (${st} ^ ${c}) & 255 ))
    printf -v ${hx} '\\\\x%02x' "$${p}"
    ${out}+="$${hx}"
    (( ${i}++ ))
  done
  printf '%b' "$${out}"
}
`;
}

function findBashLiterals(src) {
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
      const q = c;
      const start = i;
      let j = i + 1;
      let val = '';
      let hasExp = false;
      while (j < n && src[j] !== q) {
        if (q === '"' && src[j] === '\\') {
          val += src[j] + (src[j + 1] || '');
          j += 2;
          continue;
        }
        if (q === '"' && (src[j] === '$' || src[j] === '`')) {
          hasExp = true;
        }
        val += src[j++];
      }
      const end = j + 1;
      if (!hasExp && val.length > 0 && !val.includes('\n')) {
        out.push({ start, end, value: q === '"' ? unescapeC(val) : val });
      }
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

function injectBashJunk(src, rate = 0.2) {
  const lines = src.split('\n');
  const out = [];
  for (const line of lines) {
    out.push(line);
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.endsWith('\\') ||
      trimmed.endsWith('|') ||
      trimmed.endsWith('&&') ||
      trimmed.endsWith('||') ||
      trimmed.endsWith('then') ||
      trimmed.endsWith('do') ||
      trimmed.endsWith('{') ||
      /^(return|exit|break|continue|fi|done|esac|else|elif)\b/.test(trimmed)
    ) {
      continue;
    }
    if (randInt(1, 1000) <= Math.round(rate * 1000)) {
      const indent = (line.match(/^[\t ]*/) || [''])[0];
      const v = randId('v');
      const n = randInt(3, 95);
      const m = randInt(5, 89);
      out.push(`${indent}if (( ((${n} * (${n} + 1)) & 1) == 0 )); then ${v}=$(( ${n} ^ ${m} )); fi`);
    }
  }
  return out.join('\n');
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

  const profile = createBashProfile();
  const useMba = mba && level !== 'light';
  const mbaDepth = level === 'max' ? 3 : level === 'heavy' ? 2 : 1;

  const literals = findBashLiterals(code);
  let encCode = '';
  let cursor = 0;
  let used = false;
  for (const lit of literals) {
    const { encoded, packedKey } = encryptBashString(lit.value, profile);
    const keyExpr = useMba ? `$(( ${mbaInt(packedKey, { depth: mbaDepth })} ))` : String(packedKey);
    encCode += code.slice(cursor, lit.start) + `"$(${profile.fnName} "${encoded}" ${keyExpr})"`;
    cursor = lit.end;
    used = true;
  }
  encCode += code.slice(cursor);
  code = encCode;

  if (level !== 'light') {
    code = injectBashJunk(code, level === 'max' ? 0.35 : level === 'heavy' ? 0.22 : 0.1);
  }

  if (used) {
    code = bashDecoderSnippet(profile) + '\n' + code;
  }

  if (level === 'max') {
    const wrapProfile = createBashProfile();
    const { encoded, packedKey } = encryptBashString(code, wrapProfile);
    const keyExpr = `$(( ${mbaInt(packedKey, { depth: 3 })} ))`;
    code = `${bashDecoderSnippet(wrapProfile)}\neval "$(${wrapProfile.fnName} "${encoded}" ${keyExpr})"\n`;
  }

  code = (shebang || '#!/usr/bin/env bash\n') + code;

  const notes = [
    `Encrypted ${literals.length} shell string literal(s) with pure-Bash Polymorphic Nibble-Stream Cipher (zero external processes).`,
    level !== 'light'
      ? 'Inserted arithmetic opaque predicates and MBA key expressions.'
      : 'Applied PNSC string encryption.',
    ...(level === 'max'
      ? ['Wrapped full Bash script in a second-stage polymorphic stream-encrypted eval bootstrapper (max level).']
      : []),
  ];
  return { code, notes };
}

module.exports = { obfuscate };
