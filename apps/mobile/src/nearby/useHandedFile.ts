import type { Nav } from '../shell/nav';

/** Only Android's browser hands the app a file (useHandedFile.android.ts): here there is nothing to open. */
export function useHandedFile(_o: { nav: Nav; signedIn: boolean }): void {}
