import { Platform } from 'react-native';

/**
 * The app's https address (decisions.md 58): `https://next.langquest.org`
 * in production, set per environment as EXPO_PUBLIC_APP_URL. Links the app
 * makes (invites, sign-in keys) use it, so they open in the app or the web
 * app. The web app is that address, so it needs no setting; a phone build
 * without one keeps the `langquestnext://` links. Changing the domain is
 * this setting plus the steps in decisions.md 58.
 */
export const APP_URL: string | null = process.env.EXPO_PUBLIC_APP_URL?.replace(/\/$/, '')
  ?? (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null);

/**
 * Web: once an invite or sign-in key has been read from the address bar,
 * take it out, so it is not left in the history or shown over a shoulder.
 */
export function forgetKeyInAddress(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (/^\/(invite|signin)\/?$/.test(window.location.pathname) || window.location.hash) {
    window.history.replaceState(null, '', '/');
  }
}
