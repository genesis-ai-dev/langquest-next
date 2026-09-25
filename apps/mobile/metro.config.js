// Web is a test target: the browser runs the same SqliteStore on expo-sqlite's
// wasm build, so journeys exercise the real event log. That build needs the
// .wasm asset and cross-origin isolation (SharedArrayBuffer) on the dev server.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  middleware(req, res, next);
};

module.exports = config;
