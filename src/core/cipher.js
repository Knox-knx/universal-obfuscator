'use strict';
const { randId, randInt, randOddByte } = require('./util');
const { mbaInt } = require('./mba');

/**
 * Create a per-file polymorphic cipher profile for the
 * Polymorphic Nibble-Stream Cipher (PNSC):
 *  - Round 1: LCG rolling state (state = (state * mul + add + i) & 0xFF)
 *  - Round 2: XOR with rolling state + bit-rotation left by `rot` (1..7)
 *  - Round 3: Modular addition with rolling state + CBC/autokey ciphertext feedback
 *  - Encoding: Keyed nibble-pair substitution (no Base64 alphabet in binary!)
 */
function createCipherProfile(prefix = 'dec') {
  const swapBases = randInt(0, 1) === 1;
  return {
    fnName: randId(prefix),
    mul: randOddByte(),
    add: randInt(5, 249),
    nMask: randInt(1, 15),
    baseHi: swapBases ? 97 : 65,
    baseLo: swapBases ? 65 : 97,
  };
}

/**
 * Encrypt a UTF-8 string using the given cipher profile.
 * Returns { encoded, packedKey, seed, rot }.
 */
function encryptString(plainStr, profile) {
  const raw = Buffer.from(plainStr, 'utf8');
  const seed = randInt(1, 254);
  const rot = randInt(1, 7);
  const packedKey = (seed << 3) | rot;

  let state = seed;
  let encoded = '';
  for (let i = 0; i < raw.length; i++) {
    state = (state * profile.mul + profile.add + (i & 0xFF)) & 0xFF;
    const p = raw[i];
    const x1 = (p ^ state) & 0xFF;
    const x2 = ((x1 << rot) | (x1 >>> (8 - rot))) & 0xFF;
    const c = (x2 + state) & 0xFF;
    state = (state ^ c) & 0xFF;

    const hi = ((c >>> 4) & 0x0F) ^ profile.nMask;
    const lo = (c & 0x0F) ^ profile.nMask;
    encoded +=
      String.fromCharCode(profile.baseHi + hi) +
      String.fromCharCode(profile.baseLo + lo);
  }

  return { encoded, packedKey, seed, rot };
}

/**
 * Reference decryption in JS (used for unit verification).
 */
function decryptString(encoded, packedKey, profile) {
  const seed = (packedKey >>> 3) & 0xFF;
  const rot = packedKey & 7;
  let state = seed;
  const len = encoded.length >>> 1;
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    const hi = (encoded.charCodeAt(i * 2) - profile.baseHi) ^ profile.nMask;
    const lo = (encoded.charCodeAt(i * 2 + 1) - profile.baseLo) ^ profile.nMask;
    const c = ((hi & 0x0F) << 4) | (lo & 0x0F);
    state = (state * profile.mul + profile.add + (i & 0xFF)) & 0xFF;
    const x2 = (c + 256 - state) & 0xFF;
    const x1 = ((x2 >>> rot) | (x2 << (8 - rot))) & 0xFF;
    out[i] = (x1 ^ state) & 0xFF;
    state = (state ^ c) & 0xFF;
  }
  return out.toString('utf8');
}

/**
 * Format a call to the runtime decoder with an optional MBA-obfuscated key.
 */
function formatDecoderCall(fnExpr, encoded, packedKey, { useMba = true, mbaDepth = 2, rustType = '' } = {}) {
  const keyExpr = useMba
    ? mbaInt(packedKey, { depth: mbaDepth, rustType })
    : String(packedKey) + rustType;
  return `${fnExpr}("${encoded}", ${keyExpr})`;
}

/**
 * Generate polymorphic C runtime decoder (zero warnings with -Wall -Wextra).
 */
function cDecoderSnippet(profile) {
  const s = randId('s');
  const k = randId('k');
  const len = randId('n');
  const out = randId('o');
  const st = randId('st');
  const rt = randId('rt');
  const i = randId('i');
  const hi = randId('h');
  const lo = randId('l');
  const c = randId('c');
  const x2 = randId('x');
  const x1 = randId('y');

  const mulE = mbaInt(profile.mul, { depth: 1 });
  const addE = mbaInt(profile.add, { depth: 1 });
  const maskE = mbaInt(profile.nMask, { depth: 1 });
  const bHiE = mbaInt(profile.baseHi, { depth: 1 });
  const bLoE = mbaInt(profile.baseLo, { depth: 1 });

  return `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *${profile.fnName}(const char *${s}, int ${k}) {
  size_t ${len} = strlen(${s}) >> 1;
  char *${out} = (char *)malloc(${len} + 1);
  unsigned int ${st} = (unsigned int)((${k} >> 3) & 0xFF);
  unsigned int ${rt} = (unsigned int)(${k} & 7);
  for (size_t ${i} = 0; ${i} < ${len}; ${i}++) {
    unsigned int ${hi} = ((unsigned int)((unsigned char)${s}[${i} * 2] - (unsigned int)${bHiE})) ^ (unsigned int)${maskE};
    unsigned int ${lo} = ((unsigned int)((unsigned char)${s}[${i} * 2 + 1] - (unsigned int)${bLoE})) ^ (unsigned int)${maskE};
    unsigned int ${c} = ((${hi} & 0x0FU) << 4) | (${lo} & 0x0FU);
    ${st} = (${st} * (unsigned int)${mulE} + (unsigned int)${addE} + (unsigned int)(${i} & 0xFFU)) & 0xFFU;
    unsigned int ${x2} = (${c} + 256U - ${st}) & 0xFFU;
    unsigned int ${x1} = ((${x2} >> ${rt}) | (${x2} << (8U - ${rt}))) & 0xFFU;
    ${out}[${i}] = (char)((${x1} ^ ${st}) & 0xFFU);
    ${st} = (${st} ^ ${c}) & 0xFFU;
  }
  ${out}[${len}] = '\\0';
  return ${out};
}
`;
}

/**
 * Generate polymorphic C++ runtime decoder.
 */
function cppDecoderSnippet(profile) {
  const s = randId('s');
  const k = randId('k');
  const len = randId('n');
  const out = randId('o');
  const st = randId('st');
  const rt = randId('rt');
  const i = randId('i');
  const hi = randId('h');
  const lo = randId('l');
  const c = randId('c');
  const x2 = randId('x');
  const x1 = randId('y');

  const mulE = mbaInt(profile.mul, { depth: 1 });
  const addE = mbaInt(profile.add, { depth: 1 });
  const maskE = mbaInt(profile.nMask, { depth: 1 });
  const bHiE = mbaInt(profile.baseHi, { depth: 1 });
  const bLoE = mbaInt(profile.baseLo, { depth: 1 });

  return `#include <string>

static std::string ${profile.fnName}(const std::string &${s}, int ${k}) {
  size_t ${len} = ${s}.size() >> 1;
  std::string ${out}(${len}, '\\0');
  unsigned int ${st} = static_cast<unsigned int>((${k} >> 3) & 0xFF);
  unsigned int ${rt} = static_cast<unsigned int>(${k} & 7);
  for (size_t ${i} = 0; ${i} < ${len}; ${i}++) {
    unsigned int ${hi} = (static_cast<unsigned int>(static_cast<unsigned char>(${s}[${i} * 2])) - static_cast<unsigned int>(${bHiE})) ^ static_cast<unsigned int>(${maskE});
    unsigned int ${lo} = (static_cast<unsigned int>(static_cast<unsigned char>(${s}[${i} * 2 + 1])) - static_cast<unsigned int>(${bLoE})) ^ static_cast<unsigned int>(${maskE});
    unsigned int ${c} = ((${hi} & 0x0FU) << 4) | (${lo} & 0x0FU);
    ${st} = (${st} * static_cast<unsigned int>(${mulE}) + static_cast<unsigned int>(${addE}) + static_cast<unsigned int>(${i} & 0xFFU)) & 0xFFU;
    unsigned int ${x2} = (${c} + 256U - ${st}) & 0xFFU;
    unsigned int ${x1} = ((${x2} >> ${rt}) | (${x2} << (8U - ${rt}))) & 0xFFU;
    ${out}[${i}] = static_cast<char>((${x1} ^ ${st}) & 0xFFU);
    ${st} = (${st} ^ ${c}) & 0xFFU;
  }
  return ${out};
}
`;
}

/**
 * Generate polymorphic Java runtime decoder class.
 */
function javaDecoderClass(profile, clsName) {
  const s = randId('s');
  const k = randId('k');
  const len = randId('n');
  const out = randId('o');
  const st = randId('st');
  const rt = randId('rt');
  const i = randId('i');
  const hi = randId('h');
  const lo = randId('l');
  const c = randId('c');
  const x2 = randId('x');
  const x1 = randId('y');

  const mulE = mbaInt(profile.mul, { depth: 1 });
  const addE = mbaInt(profile.add, { depth: 1 });
  const maskE = mbaInt(profile.nMask, { depth: 1 });
  const bHiE = mbaInt(profile.baseHi, { depth: 1 });
  const bLoE = mbaInt(profile.baseLo, { depth: 1 });

  return `class ${clsName} {
    static String ${profile.fnName}(String ${s}, int ${k}) {
        int ${len} = ${s}.length() >> 1;
        byte[] ${out} = new byte[${len}];
        int ${st} = (${k} >>> 3) & 0xFF;
        int ${rt} = ${k} & 7;
        for (int ${i} = 0; ${i} < ${len}; ${i}++) {
            int ${hi} = ((${s}.charAt(${i} * 2) - ${bHiE}) ^ ${maskE}) & 0x0F;
            int ${lo} = ((${s}.charAt(${i} * 2 + 1) - ${bLoE}) ^ ${maskE}) & 0x0F;
            int ${c} = (${hi} << 4) | ${lo};
            ${st} = (${st} * ${mulE} + ${addE} + (${i} & 0xFF)) & 0xFF;
            int ${x2} = (${c} + 256 - ${st}) & 0xFF;
            int ${x1} = ((${x2} >>> ${rt}) | (${x2} << (8 - ${rt}))) & 0xFF;
            ${out}[${i}] = (byte) ((${x1} ^ ${st}) & 0xFF);
            ${st} = (${st} ^ ${c}) & 0xFF;
        }
        return new String(${out}, java.nio.charset.StandardCharsets.UTF_8);
    }
}
`;
}

/**
 * Generate polymorphic Rust runtime decoder (overflow-safe in debug & release).
 */
function rustDecoderSnippet(profile) {
  const s = randId('s');
  const k = randId('k');
  const raw = randId('b');
  const len = randId('n');
  const out = randId('o');
  const st = randId('st');
  const rt = randId('rt');
  const i = randId('i');
  const hi = randId('h');
  const lo = randId('l');
  const c = randId('c');
  const x2 = randId('x');
  const x1 = randId('y');

  const mulE = mbaInt(profile.mul, { depth: 1, rustType: 'u32' });
  const addE = mbaInt(profile.add, { depth: 1, rustType: 'u32' });
  const maskE = mbaInt(profile.nMask, { depth: 1, rustType: 'u32' });
  const bHiE = mbaInt(profile.baseHi, { depth: 1, rustType: 'u32' });
  const bLoE = mbaInt(profile.baseLo, { depth: 1, rustType: 'u32' });

  return `#![allow(unused_parens, non_snake_case, dead_code, unused_variables)]
fn ${profile.fnName}(${s}: &str, ${k}: u32) -> String {
    let ${raw} = ${s}.as_bytes();
    let ${len} = ${raw}.len() >> 1;
    let mut ${out} = Vec::with_capacity(${len});
    let mut ${st}: u32 = (${k} >> 3) & 0xFFu32;
    let ${rt}: u32 = ${k} & 7u32;
    let mut ${i}: usize = 0;
    while ${i} < ${len} {
        let ${hi} = (((${raw}[${i} * 2] as u32).wrapping_sub(${bHiE})) ^ ${maskE}) & 0x0Fu32;
        let ${lo} = (((${raw}[${i} * 2 + 1] as u32).wrapping_sub(${bLoE})) ^ ${maskE}) & 0x0Fu32;
        let ${c} = (${hi} << 4) | ${lo};
        ${st} = (${st}.wrapping_mul(${mulE}).wrapping_add(${addE}).wrapping_add((${i} as u32) & 0xFFu32)) & 0xFFu32;
        let ${x2} = (${c}.wrapping_add(256u32).wrapping_sub(${st})) & 0xFFu32;
        let ${x1} = ((${x2} >> ${rt}) | (${x2} << (8u32 - ${rt}))) & 0xFFu32;
        ${out}.push(((${x1} ^ ${st}) & 0xFFu32) as u8);
        ${st} = (${st} ^ ${c}) & 0xFFu32;
        ${i} += 1;
    }
    String::from_utf8_lossy(&${out}).into_owned()
}
`;
}

/**
 * Generate universal JS runtime decoder (works in Node.js AND Browser!).
 */
function jsDecoderSnippet(profile) {
  const s = randId('s');
  const k = randId('k');
  const len = randId('n');
  const out = randId('o');
  const st = randId('st');
  const rt = randId('rt');
  const i = randId('i');
  const hi = randId('h');
  const lo = randId('l');
  const c = randId('c');
  const x2 = randId('x');
  const x1 = randId('y');

  const mulE = mbaInt(profile.mul, { depth: 1 });
  const addE = mbaInt(profile.add, { depth: 1 });
  const maskE = mbaInt(profile.nMask, { depth: 1 });
  const bHiE = mbaInt(profile.baseHi, { depth: 1 });
  const bLoE = mbaInt(profile.baseLo, { depth: 1 });

  return `function ${profile.fnName}(${s}, ${k}) {
  var ${len} = ${s}.length >>> 1, ${out} = new Uint8Array(${len});
  var ${st} = (${k} >>> 3) & 255, ${rt} = ${k} & 7;
  for (var ${i} = 0; ${i} < ${len}; ${i}++) {
    var ${hi} = ((${s}.charCodeAt(${i} * 2) - ${bHiE}) ^ ${maskE}) & 15;
    var ${lo} = ((${s}.charCodeAt(${i} * 2 + 1) - ${bLoE}) ^ ${maskE}) & 15;
    var ${c} = (${hi} << 4) | ${lo};
    ${st} = (${st} * ${mulE} + ${addE} + (${i} & 255)) & 255;
    var ${x2} = (${c} + 256 - ${st}) & 255;
    var ${x1} = ((${x2} >>> ${rt}) | (${x2} << (8 - ${rt}))) & 255;
    ${out}[${i}] = (${x1} ^ ${st}) & 255;
    ${st} = (${st} ^ ${c}) & 255;
  }
  return new TextDecoder().decode(${out});
}
`;
}

/**
 * Generate zero-import Python 3 runtime decoder.
 */
function pyDecoderSnippet(profile) {
  const s = randId('s');
  const k = randId('k');
  const out = randId('o');
  const st = randId('st');
  const rt = randId('rt');
  const i = randId('i');
  const hi = randId('h');
  const lo = randId('l');
  const c = randId('c');
  const x2 = randId('x');
  const x1 = randId('y');

  const mulE = mbaInt(profile.mul, { depth: 1 });
  const addE = mbaInt(profile.add, { depth: 1 });
  const maskE = mbaInt(profile.nMask, { depth: 1 });
  const bHiE = mbaInt(profile.baseHi, { depth: 1 });
  const bLoE = mbaInt(profile.baseLo, { depth: 1 });

  return `def ${profile.fnName}(${s}, ${k}):
    ${out} = bytearray()
    ${st} = (${k} >> 3) & 0xFF
    ${rt} = ${k} & 7
    for ${i} in range(len(${s}) >> 1):
        ${hi} = ((ord(${s}[${i} * 2]) - ${bHiE}) ^ ${maskE}) & 0x0F
        ${lo} = ((ord(${s}[${i} * 2 + 1]) - ${bLoE}) ^ ${maskE}) & 0x0F
        ${c} = (${hi} << 4) | ${lo}
        ${st} = (${st} * ${mulE} + ${addE} + (${i} & 0xFF)) & 0xFF
        ${x2} = (${c} + 256 - ${st}) & 0xFF
        ${x1} = ((${x2} >> ${rt}) | (${x2} << (8 - ${rt}))) & 0xFF
        ${out}.append((${x1} ^ ${st}) & 0xFF)
        ${st} = (${st} ^ ${c}) & 0xFF
    return ${out}.decode('utf-8')

`;
}

/**
 * Generate zero-require Ruby runtime decoder.
 */
function rubyDecoderSnippet(profile) {
  const s = randId('s');
  const k = randId('k');
  const raw = randId('b');
  const out = randId('o');
  const st = randId('st');
  const rt = randId('rt');
  const i = randId('i');
  const hi = randId('h');
  const lo = randId('l');
  const c = randId('c');
  const x2 = randId('x');
  const x1 = randId('y');

  const mulE = mbaInt(profile.mul, { depth: 1 });
  const addE = mbaInt(profile.add, { depth: 1 });
  const maskE = mbaInt(profile.nMask, { depth: 1 });
  const bHiE = mbaInt(profile.baseHi, { depth: 1 });
  const bLoE = mbaInt(profile.baseLo, { depth: 1 });

  return `def ${profile.fnName}(${s}, ${k})
  ${raw} = ${s}.bytes
  ${out} = []
  ${st} = (${k} >> 3) & 0xFF
  ${rt} = ${k} & 7
  (${raw}.length >> 1).times do |${i}|
    ${hi} = ((${raw}[${i} * 2] - ${bHiE}) ^ ${maskE}) & 0x0F
    ${lo} = ((${raw}[${i} * 2 + 1] - ${bLoE}) ^ ${maskE}) & 0x0F
    ${c} = (${hi} << 4) | ${lo}
    ${st} = (${st} * ${mulE} + ${addE} + (${i} & 0xFF)) & 0xFF
    ${x2} = (${c} + 256 - ${st}) & 0xFF
    ${x1} = ((${x2} >> ${rt}) | (${x2} << (8 - ${rt}))) & 0xFF
    ${out} << ((${x1} ^ ${st}) & 0xFF)
    ${st} = (${st} ^ ${c}) & 0xFF
  end
  ${out}.pack('C*').force_encoding('UTF-8')
end

`;
}

module.exports = {
  createCipherProfile,
  encryptString,
  decryptString,
  formatDecoderCall,
  cDecoderSnippet,
  cppDecoderSnippet,
  javaDecoderClass,
  rustDecoderSnippet,
  jsDecoderSnippet,
  pyDecoderSnippet,
  rubyDecoderSnippet,
};
