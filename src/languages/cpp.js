'use strict';
const { buildPipeline } = require('../core/cFamilyBase');
const { cppDecoderSnippet } = require('../core/cipher');

const obfuscate = buildPipeline({
  lang: 'C++',
  decoderSnippetFn: cppDecoderSnippet,
  junkLang: 'cpp',
  junkRate: (level) => (level === 'max' ? 0.45 : level === 'heavy' ? 0.25 : 0.12),
});

module.exports = { obfuscate };
