'use strict';
const crypto = require('crypto');

let _seedState = null;
let _identStyle = 'hex'; // 'hex' | 'homoglyph' | 'underscore' | 'compact'
let _usedIds = new Set();

/**
 * Configure deterministic PRNG seed (or null for crypto randomness).
 */
function setSeed(seed) {
  if (seed === null || seed === undefined || seed === '') {
    _seedState = null;
    return;
  }
  const hash = crypto.createHash('sha256').update(String(seed)).digest();
  _seedState = hash.readUInt32LE(0) || 0x1337beef;
}

function setIdentStyle(style) {
  if (['hex', 'homoglyph', 'underscore', 'compact'].includes(style)) {
    _identStyle = style;
  }
}

function getIdentStyle() {
  return _identStyle;
}

function resetUsedIds() {
  _usedIds = new Set();
}

function _nextRandU32() {
  if (_seedState !== null) {
    // xorshift32
    let x = _seedState >>> 0;
    x ^= (x << 13) >>> 0;
    x ^= (x >>> 17) >>> 0;
    x ^= (x << 5) >>> 0;
    _seedState = (x >>> 0) || 0x9e3779b9;
    return _seedState;
  }
  return crypto.randomBytes(4).readUInt32LE(0);
}

/** Random integer in [min, max] inclusive. */
function randInt(min, max) {
  if (max <= min) return min;
  const span = max - min + 1;
  return min + (_nextRandU32() % span);
}

/** Random identifier styled according to current identifier style. */
function randId(prefix = '_') {
  for (let attempt = 0; attempt < 64; attempt++) {
    let candidate;
    if (_identStyle === 'homoglyph') {
      const heads = ['l', '_I', '_l', '_O', 'lI', 'lO'];
      const chars = ['I', 'l', '1', 'O', '0'];
      let body = '';
      for (let i = 0; i < 9; i++) {
        body += chars[randInt(0, chars.length - 1)];
      }
      candidate = heads[randInt(0, heads.length - 1)] + body;
    } else if (_identStyle === 'underscore') {
      const chars = ['_', 'a', 'b', 'c', 'd', 'e', 'f', '_'];
      let body = '_';
      for (let i = 0; i < 8; i++) {
        body += chars[randInt(0, chars.length - 1)];
      }
      candidate = `${prefix}${body}`;
    } else if (_identStyle === 'compact') {
      const hex = (_nextRandU32() >>> 0).toString(16).padStart(8, '0').slice(0, 5);
      candidate = `${prefix}${hex}`;
    } else {
      // 'hex' default: _0x8f3a2c style
      const hex = (_nextRandU32() >>> 0).toString(16).padStart(8, '0').slice(0, 6);
      const cleanPrefix = prefix.replace(/[^A-Za-z_]/g, '') || '_';
      candidate = `${cleanPrefix}_0x${hex}`;
    }
    if (!_usedIds.has(candidate)) {
      _usedIds.add(candidate);
      return candidate;
    }
  }
  return `${prefix}_${_nextRandU32().toString(16)}`;
}

/** Pick a random odd byte in [3, 253] (coprime to 256). */
function randOddByte() {
  return (randInt(1, 126) * 2) + 1;
}

/** Pick a random single-byte XOR key in [1, 250]. */
function randXorKey() {
  return randInt(1, 250);
}

/** Fisher-Yates shuffle (returns a new array). */
function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function xorBytes(buf, key) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key;
  return out;
}

function toBase64(buf) {
  return buf.toString('base64');
}

/** Compute Shannon entropy (bits per byte, 0..8) of a string or buffer. */
function shannonEntropy(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  if (buf.length === 0) return 0;
  const counts = new Array(256).fill(0);
  for (let i = 0; i < buf.length; i++) counts[buf[i]]++;
  let ent = 0;
  const len = buf.length;
  for (let i = 0; i < 256; i++) {
    if (counts[i] > 0) {
      const p = counts[i] / len;
      ent -= p * Math.log2(p);
    }
  }
  return ent;
}

module.exports = {
  setSeed,
  setIdentStyle,
  getIdentStyle,
  resetUsedIds,
  randId,
  randInt,
  randOddByte,
  randXorKey,
  shuffle,
  xorBytes,
  toBase64,
  shannonEntropy,
};
