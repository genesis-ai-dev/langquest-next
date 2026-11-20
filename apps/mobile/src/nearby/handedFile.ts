/**
 * Only an Android phone downloads the install file for the app to take, and only Android's browser
 * hands it over (handedFile.android.ts), so here no link is one and nothing is ever held: the web
 * and iPhone bundles carry none of it.
 */
export function receiveHandedFile(_url: string): boolean {
  return false;
}

export function handedFileNow(): string | null {
  return null;
}

export function subscribeHandedFile(_fn: () => void): () => void {
  return () => {};
}

export function takeHandedFile(): string | null {
  return null;
}
