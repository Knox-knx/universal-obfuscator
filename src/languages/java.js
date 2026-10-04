'use strict';
const { buildPipeline } = require('../core/cFamilyBase');
const { javaDecoderClass } = require('../core/cipher');
const { randId } = require('../core/util');

const base = buildPipeline({
  lang: 'Java',
  decoderSnippetFn: () => '',
  junkLang: 'java',
  junkRate: (level) => (level === 'max' ? 0.45 : level === 'heavy' ? 0.25 : 0.12),
});

function obfuscate(src, opts = {}) {
  const { code: baseCode, notes, profile } = base(src, opts);
  const fnName = profile ? profile.fnName : 'dec';
  if (!new RegExp(`\\b${fnName}\\s*\\(`).test(baseCode)) {
    return { code: baseCode, notes };
  }
  const clsName = randId('Dec');
  const withNamespacedCalls = baseCode.replace(
    new RegExp(`\\b${fnName}\\(`, 'g'),
    `${clsName}.${fnName}(`
  );
  const code = withNamespacedCalls + '\n' + javaDecoderClass(profile, clsName);
  return {
    code,
    notes: [
      ...notes,
      `Emitted polymorphic top-level helper class \`${clsName}\` with zero \`java.util.Base64\` dependency.`,
    ],
  };
}

module.exports = { obfuscate };
