const { IOSConfig, withAndroidManifest, withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withPrivacyIcon(config) {
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application[0];
    const main = app.activity.find((entry) => entry.$['android:name'] === '.MainActivity');
    if (!main) throw new Error('MainActivity is required for the privacy icon.');
    const launcher = (main['intent-filter'] || []).filter((filter) =>
      (filter.category || []).some((category) => category.$['android:name'] === 'android.intent.category.LAUNCHER'));
    main['intent-filter'] = (main['intent-filter'] || []).filter((filter) => !launcher.includes(filter));
    const launchFilter = [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }];
    app['activity-alias'] = (app['activity-alias'] || []).filter((a) =>
      !['.DefaultLauncher', '.NotesLauncher'].includes(a.$['android:name']));
    for (const [name, label, icon, enabled] of [
      ['.DefaultLauncher', config.name, '@mipmap/ic_launcher', 'true'],
      ['.NotesLauncher', 'Notes', '@drawable/privacy_notes', 'false']
    ]) app['activity-alias'].push({ $: { 'android:name': name,
      'android:targetActivity': '.MainActivity', 'android:enabled': enabled,
      'android:exported': 'true', 'android:label': label, 'android:icon': icon },
      'intent-filter': launchFilter });
    return mod;
  });
  config = withDangerousMod(config, ['android', async (mod) => {
    const dest = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'privacy_notes.xml'), `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><path android:fillColor="#58697B" android:pathData="M0,0h108v108h-108z"/><path android:fillColor="#FFFFFF" android:pathData="M30,23h48v62h-48z"/><path android:strokeColor="#58697B" android:strokeWidth="3" android:pathData="M39,39h30M39,49h30M39,59h30M39,69h20"/></vector>`);
    return mod;
  }]);
  config = withInfoPlist(config, (mod) => {
    for (const key of ['CFBundleIcons', 'CFBundleIcons~ipad']) {
      mod.modResults[key] = { ...(mod.modResults[key] || {}), CFBundleAlternateIcons: {
        ...(mod.modResults[key]?.CFBundleAlternateIcons || {}),
        NotesIcon: { CFBundleIconFiles: key.endsWith('~ipad') ? ['NotesIcon', 'NotesIcon-83.5'] : ['NotesIcon'], UIPrerenderedIcon: false }
      } };
    }
    return mod;
  });
  config = withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const root = mod.modRequest.platformProjectRoot;
    const dest = path.join(root, 'PrivacyIcons');
    fs.mkdirSync(dest, { recursive: true });
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, 'PrivacyIcons');
    for (const file of ['NotesIcon@2x.png', 'NotesIcon@3x.png', 'NotesIcon~ipad.png', 'NotesIcon@2x~ipad.png', 'NotesIcon-83.5@2x~ipad.png']) {
      fs.copyFileSync(path.join(mod.modRequest.projectRoot, 'assets/privacy', file), path.join(dest, file));
      const relative = `PrivacyIcons/${file}`;
      IOSConfig.XcodeUtils.addResourceFileToGroup({ filepath: relative,
        groupName: 'PrivacyIcons', isBuildFile: true, project });
    }
    return mod;
  });
  return config;
};
