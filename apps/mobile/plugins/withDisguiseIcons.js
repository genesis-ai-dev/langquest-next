// The Android side of a phone's disguise (decisions.md 168), on top of
// expo-alternate-app-icons, which makes one <activity-alias> per icon
// (".MainActivityCalculator1") with only the launcher filter and app.json's
// intent filters. Two things it leaves out:
//   1. A name under the icon. Each alias is labelled "Calculator" or "Notes"
//      in the phone's language, from `native.calculator` and `native.notes`
//      in src/i18n, written as string resources.
//   2. Links. While a disguise is on, .MainActivity is turned off, so a link
//      filter that only it holds stops opening the app: the app's own scheme
//      (langquestnext://invite, Scan a code's paste) and the dev client's.
//      Every VIEW filter of .MainActivity is copied onto each alias.
// Manifest mods run in reverse plugin order, so app.json lists this plugin
// before expo-alternate-app-icons, for it to run after.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

/** The app's catalogs and the Android resource folder each one fills. */
const FOLDERS = {
  en: 'values', es: 'values-es', pt: 'values-pt', fr: 'values-fr', ar: 'values-ar', sw: 'values-sw', ha: 'values-ha',
  am: 'values-am', hi: 'values-hi', bn: 'values-bn', ne: 'values-ne', id: 'values-in', 'zh-Hans': 'values-b+zh+Hans',
  th: 'values-th', my: 'values-my'
};

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, "\\'").replace(/"/g, '\\"');

function withLabelStrings(config) {
  return withDangerousMod(config, ['android', async (c) => {
    const res = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res');
    for (const [code, folder] of Object.entries(FOLDERS)) {
      const words = JSON.parse(fs.readFileSync(path.join(c.modRequest.projectRoot, 'src/i18n', `${code}.json`), 'utf8')).native;
      const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n`
        + `  <string name="disguise_calculator">${escape(words.calculator)}</string>\n`
        + `  <string name="disguise_notes">${escape(words.notes)}</string>\n</resources>\n`;
      fs.mkdirSync(path.join(res, folder), { recursive: true });
      fs.writeFileSync(path.join(res, folder, 'disguise.xml'), xml);
    }
    return c;
  }]);
}

const isView = (filter) => (filter.action ?? []).some((a) => a.$['android:name'] === 'android.intent.action.VIEW');

function withAliasLabelsAndLinks(config) {
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(c.modResults);
    const links = (main['intent-filter'] ?? []).filter(isView);
    for (const alias of app['activity-alias'] ?? []) {
      const name = alias.$['android:name'] ?? '';
      const kind = /^\.MainActivityCalculator\d+$/.test(name) ? 'calculator' : /^\.MainActivityNotes\d+$/.test(name) ? 'notes' : null;
      if (!kind) continue;
      alias.$['android:label'] = `@string/disguise_${kind}`;
      alias['intent-filter'] = [...(alias['intent-filter'] ?? []).filter((f) => !isView(f)), ...links];
    }
    return c;
  });
}

module.exports = (config) => withAliasLabelsAndLinks(withLabelStrings(config));
