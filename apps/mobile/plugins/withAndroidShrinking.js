// Android code shrinking for release builds (LAN-111, decisions.md 205): R8
// shrinks and renames the app's code, and shrinks resources. The keep rules
// are in android-shrinking-rules.pro, next to this file. Expo copies
// app.json's plugin options into every build, so the long rule text lives in
// that file and app.json names only this plugin. The mapping file R8 writes
// goes into the app bundle, and Play reads it from there.
const fs = require('fs');
const path = require('path');
const { withBuildProperties } = require('expo-build-properties');

const rules = fs.readFileSync(path.join(__dirname, 'android-shrinking-rules.pro'), 'utf8');

module.exports = (config) => withBuildProperties(config, {
  android: {
    enableProguardInReleaseBuilds: true,
    enableShrinkResourcesInReleaseBuilds: true,
    extraProguardRules: rules,
  },
});
