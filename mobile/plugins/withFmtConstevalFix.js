// @ts-check
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'withFmtConstevalFix';

/**
 * fmt 11.0.2 (bundled by React Native < 0.83.9 / Expo SDK < 56) fails to
 * compile under Apple Clang 21 (Xcode 26.4+): FMT_STRING relies on a
 * consteval check that no longer satisfies Clang's stricter
 * constant-expression rules. Forcing FMT_USE_CONSTEVAL to 0 makes fmt fall
 * back to runtime format-string validation instead of compile-time — the
 * built binary behaves identically, only the validation timing changes.
 * Safe to delete once this project is on React Native >= 0.83.9 (fmt 12.1.0
 * ships the upstream fix).
 */
/** @param {string} installerVar */
function rubyPatch(installerVar) {
  return [
    '',
    `    # === ${MARKER}: disable fmt consteval for Xcode 26.4+ (Apple Clang 21) ===`,
    `    fmt_base = File.join(${installerVar}.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')`,
    "    if File.exist?(fmt_base)",
    '      original = File.read(fmt_base)',
    "      patched = original.gsub(/^(#\\s*define\\s+FMT_USE_CONSTEVAL)\\s+1\\s*$/, '\\1 0')",
    '      if patched != original',
    '        File.chmod(0644, fmt_base)',
    '        File.write(fmt_base, patched)',
    `        Pod::UI.puts '[${MARKER}] disabled fmt consteval (Xcode 26 compatibility)'`,
    '      end',
    '    end',
  ].join('\n');
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withFmtConstevalFix = (config) =>
  withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (contents.includes(MARKER)) return cfg;

      const match = contents.match(/post_install do \|(\w+)\|/);
      if (!match) {
        throw new Error(
          `[${MARKER}] No "post_install do |installer|" block found in the Podfile.`
        );
      }

      contents = contents.replace(match[0], `${match[0]}\n${rubyPatch(match[1])}`);
      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);

module.exports = withFmtConstevalFix;
