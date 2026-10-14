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
//
// Web is a test target (web-tests): the browser runs the same SqliteStore on
// expo-sqlite's wasm build, so journeys exercise the real event log. That
// build needs the .wasm asset and cross-origin isolation (SharedArrayBuffer).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const envExts = new Set(['env', 'local', 'development']);
config.watcher = {
  ...config.watcher,
  additionalExts: (config.watcher?.additionalExts ?? []).filter((ext) => !envExts.has(ext))
};
config.resolver.assetExts.push('wasm');
// In development the browser fetches the other languages' words from here;
// an export copies them beside the page (src/i18n/catalogs.web.ts).
const path = require('node:path');
const fs = require('node:fs');
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  const catalog = /^\/i18n\/([A-Za-z-]+)\.json(\?|$)/.exec(req.url ?? '');
  if (catalog) {
    const file = path.join(__dirname, 'src/i18n', `${catalog[1]}.json`);
    if (fs.existsSync(file)) {
      res.setHeader('Content-Type', 'application/json');
      res.end(fs.readFileSync(file));
      return;
    }
  }
  middleware(req, res, next);
};

// A build of its own cache: Expo writes EXPO_PUBLIC_* values into each file
// as Metro transforms it, and Metro's cache does not know a value changed,
// so a release build could reuse a file transformed with other settings.
// The UI test build (scripts/maestro-build.mjs) bundles from an empty cache
// of its own, and leaves the one every Metro on this machine shares alone.
if (process.env.METRO_CACHE_DIR) {
  const { FileStore } = require('metro-cache');
  config.cacheStores = [new FileStore({ root: process.env.METRO_CACHE_DIR })];
}

module.exports = config;
