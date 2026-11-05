import * as Application from 'expo-application';

/**
 * The store build this phone installed, for its diagnostics (`appVersion`):
 * the version the store shows and the build number, "2026.1030.1319 (48)".
 * An OTA update changes neither, so a report names the build a person
 * installed without matching runtimes (scripts/diag.ts). A browser's is
 * storeBuild.web.ts.
 */
export function storeBuild(): string | undefined {
  const version = Application.nativeApplicationVersion;
  if (!version) return undefined;
  const build = Application.nativeBuildVersion;
  return build ? `${version} (${build})` : version;
}
