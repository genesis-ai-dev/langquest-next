import * as Application from 'expo-application';

/**
 * The store build this phone installed: the version the store shows and the
 * build number. An OTA update changes neither. A browser's is
 * storeBuild.web.ts.
 */
export function storeBuildParts(): { version: string; build?: string } | undefined {
  const version = Application.nativeApplicationVersion;
  if (!version) return undefined;
  return { version, build: Application.nativeBuildVersion ?? undefined };
}

/**
 * The store build for diagnostics (`appVersion`): "2026.1030.1319 (48)", so a
 * report names the build a person installed without matching runtimes
 * (scripts/diag.ts).
 */
export function storeBuild(): string | undefined {
  const store = storeBuildParts();
  if (!store) return undefined;
  return store.build ? `${store.version} (${store.build})` : store.version;
}
