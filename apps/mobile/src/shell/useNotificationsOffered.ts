import { Platform } from 'react-native';

/**
 * Whether More settings offers notifications. A phone does; the web has no
 * push yet, and its requests and feedback still reach the Inbox. Android's
 * file (useNotificationsOffered.android.ts) offers none while the phone wears
 * its disguise (decisions.md 171), which an iPhone build has none of.
 */
export function useNotificationsOffered(): boolean {
  return Platform.OS !== 'web';
}
