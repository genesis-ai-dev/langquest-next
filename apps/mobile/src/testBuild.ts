/**
 * True in a build the UI tests may probe: Metro's dev build (`__DEV__`), or a
 * release export of the local stack. `export:web -- development` and the phone
 * test build (scripts/maestro-build.mjs) set EXPO_PUBLIC_LOCAL_RELEASE=1;
 * production and preview exports never do, so the test probes
 * (`__langquestLog`, `__langquestSyncNow`, `__langquestTestState`) are absent
 * from what people install.
 */
export function isTestBuild(): boolean {
  return __DEV__ || process.env.EXPO_PUBLIC_LOCAL_RELEASE === '1';
}
