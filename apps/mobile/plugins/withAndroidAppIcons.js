// The Android side of a phone's disguise (decisions.md 171, amended
// 2026-11-03 and 2026-11-05): expo-alternate-app-icons on Android only, and
// what it leaves out. Apple refused iPhone builds for the calculator and
// notepad icons (App Review Guideline 2.5.19) and asked for the feature and
// all its code to go, so an iPhone build has none of it: not the icons, not
// their names, not the words. Expo copies app.json's plugin options into
// every build, the iPhone's too, so the icon list is here and app.json names
// only this plugin. The package's native module is kept out of the iPhone
// app by package.json's expo.autolinking.ios.exclude, and only Android's
// files import src/disguise (src/shell/AppCover.android.tsx).
//
// It runs, in this order:
//   1. The package's two Android steps, as its own plugin does: the adaptive
//      icons, then one <activity-alias> per icon (".MainActivityCalculator1")
//      with only the launcher filter and app.json's intent filters. Its iOS
//      steps, which would put the icons in the iPhone app, are left out.
//   2. A name under each icon: "Calculator" or "Notes" in the phone's
//      language, from `native.calculator` and `native.notes` in
//      src/disguise/i18n, written as string resources.
//   3. Links. While a disguise is on, .MainActivity is turned off, so a link
//      filter that only it holds stops opening the app: the app's own scheme
//      (langquestnext://invite, Scan a code's paste) and the dev client's.
//      Every VIEW filter of .MainActivity is copied onto each alias.
// A manifest mod added later runs earlier, so steps 2 and 3 are added first.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { withAdaptiveIconsGenerator } = require('expo-alternate-app-icons/plugin/build/android/withAdaptiveIconsGenerator');
const { withAndroidManifestUpdate } = require('expo-alternate-app-icons/plugin/build/android/withAndroidManifestUpdate');

/** The ten icons, in the package's own options, with no "ios" picture; src/disguise/disguiseModel.ts names the same ten. */
const ICONS = [
  ['Calculator1', 'calculator1', '#202226'],
  ['Calculator2', 'calculator2', '#DBEAFE'],
  ['Calculator3', 'calculator3', '#F97316'],
  ['Calculator4', 'calculator4', '#111111'],
  ['Calculator5', 'calculator5', '#16A34A'],
  ['Notes1', 'notes1', '#FFFFFF'],
  ['Notes2', 'notes2', '#2563EB'],
  ['Notes3', 'notes3', '#FFFFFF'],
  ['Notes4', 'notes4', '#1E293B'],
  ['Notes5', 'notes5', '#E11D48']
].map(([name, folder, backgroundColor]) => ({ name, android: { foregroundImage: `./assets/disguise/${folder}/adaptive.png`, backgroundColor } }));

/** The disguise's words for each language and the Android resource folder each one fills. */
const FOLDERS = {
  en: 'values', es: 'values-es', pt: 'values-pt', fr: 'values-fr', ar: 'values-ar', sw: 'values-sw', ha: 'values-ha',
  am: 'values-am', hi: 'values-hi', bn: 'values-bn', ne: 'values-ne', id: 'values-in', 'zh-Hans': 'values-b+zh+Hans',
  th: 'values-th', my: 'values-my', tl: 'values-tl'
};

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, "\\'").replace(/"/g, '\\"');

function withLabelStrings(config) {
  return withDangerousMod(config, ['android', async (c) => {
    const res = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res');
    for (const [code, folder] of Object.entries(FOLDERS)) {
      const words = JSON.parse(fs.readFileSync(path.join(c.modRequest.projectRoot, 'src/disguise/i18n', `${code}.json`), 'utf8')).native;
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

/** @param {import('expo/config').ExpoConfig} config */
module.exports = (config) => {
  const labelled = withAliasLabelsAndLinks(withLabelStrings(config));
  return withAndroidManifestUpdate(withAdaptiveIconsGenerator(labelled, ICONS), ICONS.map((icon) => icon.name));
};
module.exports.ICONS = ICONS;
module.exports.FOLDERS = FOLDERS;
