// What the native fingerprint (runtimeVersion's `fingerprint` policy) leaves
// out. The store version changes with every store build (app.config.js,
// decisions.md 156) and is not native code, so it must not make an OTA
// update miss the builds that can run it.
const { SourceSkips } = require('@expo/fingerprint');

/** @type {import('@expo/fingerprint').Config} */
module.exports = { sourceSkips: SourceSkips.ExpoConfigVersions };
