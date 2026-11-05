import { Linking, Platform, Share } from 'react-native';

/**
 * Hand text to the share sheet. A browser copies it instead: desktop
 * Chrome has a share API, but its sheet does not finish on its own and
 * the link would never land on the clipboard. The caller says which
 * happened, so nothing is lost silently either way.
 */
export async function shareText(message: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (Platform.OS === 'web') {
      await navigator.clipboard.writeText(message);
      return 'copied';
    }
    await Share.share({ message });
    return 'shared';
  } catch {
    return 'failed';
  }
}

/**
 * Open a link that came from content (library material), not from the app:
 * only web pages. A `javascript:` or other scheme in a document must never
 * run, which matters most on the web where it would run in the page.
 */
export function openContentLink(url: string): void {
  if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => undefined);
}
