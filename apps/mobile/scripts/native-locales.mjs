// Writes the words iOS shows for the app outside it (the microphone and camera
// questions) in each language, from the catalogs' `native` area, into
// locales/<language>.json, which app.json's `locales` names (a new build).
// Run after changing those words: node apps/mobile/scripts/native-locales.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const LPROJ = { pt: 'pt-BR' };
const languages = ['es', 'pt', 'fr', 'ar', 'sw', 'ha', 'am', 'hi', 'bn', 'ne', 'id', 'zh-Hans', 'th', 'my'];
mkdirSync(join(root, 'locales'), { recursive: true });
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
app.expo.locales = {};
for (const code of languages) {
  const native = JSON.parse(readFileSync(join(root, 'src/i18n', `${code}.json`), 'utf8')).native ?? {};
  const name = LPROJ[code] ?? code;
  writeFileSync(join(root, 'locales', `${name}.json`), JSON.stringify({
    ios: { NSMicrophoneUsageDescription: native.microphone, NSCameraUsageDescription: native.camera }
  }, null, 2) + '\n');
  app.expo.locales[name] = `./locales/${name}.json`;
}
writeFileSync(join(root, 'app.json'), JSON.stringify(app, null, 2) + '\n');
console.log(`wrote ${languages.length} files in apps/mobile/locales`);
