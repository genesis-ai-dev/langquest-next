import type { Offer } from './appVersionModel';

const noop = () => undefined;

/**
 * A browser always loads the newest version of the app (decisions.md 154):
 * nothing to ask the server, nothing to offer, and sync never stops for a
 * version. useAppVersion.ts is the phone's.
 */
export function useAppVersion(_signedIn: boolean) {
  const offer: Offer = 'none';
  return { offer, dismiss: noop, openStore: noop, platform: null };
}
