import { useEffect, useSyncExternalStore } from 'react';
import type { Nav } from '../shell/nav';
import { handedFileNow, subscribeHandedFile } from './handedFile';
import { openForHandedFile } from './handedFileModel';

/**
 * Opens Download the install file for a file the browser handed the app (handedFile.android.ts),
 * which takes it, checks it and keeps a copy, and shows what came of it. It opens once the app has
 * routed past signing in, which a cold start from the browser's Open goes through first, so
 * routing does not send the person on from it (`openForHandedFile`).
 */
export function useHandedFile(o: { nav: Nav; signedIn: boolean }): void {
  const { nav, signedIn } = o;
  const handed = useSyncExternalStore(subscribeHandedFile, handedFileNow);
  const at = nav.current.screen;
  const { ready, reset } = nav;
  useEffect(() => {
    if (openForHandedFile({ held: handed !== null, signedIn, ready, screen: at })) reset({ screen: 'get_install_file' });
  }, [handed, signedIn, ready, at, reset]);
}
