// Expo's defaults, with one change: the app's env files are not bundled.
//
// `npm start` and `npm run ios` decrypt the committed dotenvx files into
// process.env and turn off Expo's own .env loading (EXPO_NO_DOTENV=1). In a
// development bundle Expo 57 still reads every `.env*` file beside the app
// itself, to reload env changes live, and those values win over
// process.env. Here that means the encrypted strings, so the app got
// "encrypted:..." as its server URL. Watching no `.env*` files leaves that
// module with nothing to read, and process.env is used as it is in a
// release build.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const envExts = new Set(['env', 'local', 'development']);
config.watcher = {
  ...config.watcher,
  additionalExts: (config.watcher?.additionalExts ?? []).filter((ext) => !envExts.has(ext))
};

module.exports = config;
