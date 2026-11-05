// expo-alternate-app-icons on Android only (decisions.md 171, amended
// 2026-11-03). Apple refused iPhone build 48 twice for the calculator and
// notepad icons (App Review Guideline 2.5.19), and asked for the feature and
// all its code to go, so an iPhone build has neither. This runs the package's
// two Android steps, as its own plugin does (the adaptive icons, then one
// <activity-alias> per icon), and leaves out its iOS ones, which would put
// the icons in the iPhone app. Its native module is kept out of the iPhone
// app by package.json's expo.autolinking.ios.exclude, and src/disguise has
// .ios files that hold none of it. Takes the package's own options, with no
// "ios" picture.
const { withAdaptiveIconsGenerator } = require('expo-alternate-app-icons/plugin/build/android/withAdaptiveIconsGenerator');
const { withAndroidManifestUpdate } = require('expo-alternate-app-icons/plugin/build/android/withAndroidManifestUpdate');

/** @param {import('expo/config').ExpoConfig} config @param {{ name: string; android: { foregroundImage: string; backgroundColor?: string } }[]} icons */
module.exports = (config, icons = []) => {
  if (!icons.length) return config;
  return withAndroidManifestUpdate(withAdaptiveIconsGenerator(config, icons), icons.map((icon) => icon.name));
};
