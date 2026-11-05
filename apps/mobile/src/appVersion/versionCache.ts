import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseCachedVersions, type PlatformVersions } from './appVersionModel';

/** The last answer from the server, kept so a phone offline for months still knows its minimum. */
const LAST_KEY = 'app-versions:last';
/** The newest version that the person dismissed "New version available" for. */
const DISMISSED_KEY = 'app-versions:dismissed';

/** What this phone kept: the server's last answer and the newest version dismissed. */
export async function readVersionCache(): Promise<{ versions: PlatformVersions | null; dismissed: string | null }> {
  const [[, last], [, gone]] = await AsyncStorage.multiGet([LAST_KEY, DISMISSED_KEY]);
  return { versions: parseCachedVersions(last ?? null), dismissed: gone ?? null };
}

export function saveVersions(versions: PlatformVersions): Promise<void> {
  return AsyncStorage.setItem(LAST_KEY, JSON.stringify({ versions }));
}

export function saveDismissed(version: string): Promise<void> {
  return AsyncStorage.setItem(DISMISSED_KEY, version);
}
