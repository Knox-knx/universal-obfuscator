'use strict';
const { buildPipeline } = require('../core/cFamilyBase');
const { cDecoderSnippet } = require('../core/cipher');

const obfuscate = buildPipeline({
  lang: 'C',
  decoderSnippetFn: cDecoderSnippet,
  junkLang: 'c',
  junkRate: (level) => (level === 'max' ? 0.45 : level === 'heavy' ? 0.25 : 0.12),
});

module.exports = { obfuscate };
