import { opsDashboardUrl, verifiedAuthenticator } from '../server/globalViewer';

/** The authenticator this account already set up, if any: what a code is checked against. */
export function setUpAuthenticator(): Promise<string | null> {
  return verifiedAuthenticator();
}

/** Where the ops dashboard is, beside the app on the web; null on a phone. */
export function opsDashboardLink(): string | null {
  return opsDashboardUrl();
}
