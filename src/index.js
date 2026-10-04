'use strict';
const path = require('path');
const { setSeed, setIdentStyle, resetUsedIds, shannonEntropy } = require('./core/util');

const registry = {
  '.c': require('./languages/c'),
  '.h': require('./languages/c'),
  '.cpp': require('./languages/cpp'),
  '.cc': require('./languages/cpp'),
  '.cxx': require('./languages/cpp'),
  '.hpp': require('./languages/cpp'),
  '.java': require('./languages/java'),
  '.py': require('./languages/python'),
  '.js': require('./languages/js'),
  '.mjs': require('./languages/js'),
  '.cjs': require('./languages/js'),
  '.html': require('./languages/html'),
  '.htm': require('./languages/html'),
  '.css': require('./languages/css'),
  '.rb': require('./languages/ruby'),
  '.rs': require('./languages/rust'),
  '.sh': require('./languages/bash'),
  '.bash': require('./languages/bash'),
};

function moduleForFile(filePathOrExt) {
  const raw = String(filePathOrExt).trim().toLowerCase();
  const ext = raw.startsWith('.') && !raw.includes('/') && !raw.includes('\\')
    ? raw
    : path.extname(raw) || (`.${raw}`);
  const mod = registry[ext];
  if (!mod) {
    const supported = [...new Set(Object.keys(registry))].join(', ');
    throw new Error(`No obfuscator registered for extension "${ext}". Supported: ${supported}`);
  }
  return mod;
}

/**
 * High-level obfuscate helper supporting multi-pass execution, deterministic
 * seeds, identifier styles, and entropy/size telemetry.
 */
function obfuscateSource(src, fileOrExt, opts = {}) {
  const {
    level = 'heavy',
    passes = 1,
    style = 'hex',
    seed = null,
    mba = true,
  } = opts;

  setIdentStyle(style);
  if (seed !== null && seed !== undefined && seed !== '') {
    setSeed(seed);
  }
  resetUsedIds();

  const mod = moduleForFile(fileOrExt);
  const numPasses = Math.max(1, Math.min(5, Number(passes) || 1));

  let currentCode = src;
  let allNotes = [];
  let combinedMapping = {};

  for (let p = 0; p < numPasses; p++) {
    // For multi-pass on compiled languages, keep intermediate passes at 'heavy'
    // and final pass at requested level so headers aren't duplicated improperly.
    const passLevel = numPasses > 1 && p < numPasses - 1 && level === 'max' ? 'heavy' : level;
    const res = mod.obfuscate(currentCode, { ...opts, level: passLevel, mba });
    currentCode = res.code;
    if (p === numPasses - 1 && res.notes) {
      allNotes = res.notes.slice();
    }
    if (res.mapping) {
      combinedMapping = { ...combinedMapping, ...res.mapping };
    }
    // Avoid running multiple C/C++/Rust/Java header-injecting passes unless dynamic
    const ext = path.extname(String(fileOrExt)).toLowerCase() || `.${String(fileOrExt).toLowerCase()}`;
    if (['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.java', '.rs'].includes(ext)) {
      break;
    }
  }

  if (numPasses > 1) {
    allNotes.push(`Executed ${numPasses}-pass layered obfuscation pipeline (identifier style: ${style}).`);
  }

  const stats = {
    originalBytes: Buffer.byteLength(src, 'utf8'),
    obfuscatedBytes: Buffer.byteLength(currentCode, 'utf8'),
    originalEntropy: Number(shannonEntropy(src).toFixed(3)),
    obfuscatedEntropy: Number(shannonEntropy(currentCode).toFixed(3)),
    level,
    style,
    passes: numPasses,
  };
  stats.ratio = stats.originalBytes > 0
    ? Number((stats.obfuscatedBytes / stats.originalBytes).toFixed(2))
    : 1;

  return {
    code: currentCode,
    notes: allNotes,
    mapping: combinedMapping,
    stats,
  };
}

module.exports = { registry, moduleForFile, obfuscateSource };
