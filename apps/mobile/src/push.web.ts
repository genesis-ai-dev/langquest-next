/**
 * The browser's push: there is none (push.ts is the phones'). The Account
 * screen hides the switch on web, and no notification ever opens the app.
 */

export async function requestPushToken(): Promise<string> {
  throw new Error('Notifications work in the app on a phone or tablet.');
}

export function onNotificationOpened(_open: () => void): () => void {
  return () => {};
}
