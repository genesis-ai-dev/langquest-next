import { getStore } from '../storage/store';
import { CARRIED_APK_OPENED_KEY, CARRIED_APK_RIGHT_KEY } from './carriedApkModel';

/**
 * Two names of the carried build's file, each in a phone-wide meta row that holds nothing but that
 * name (docs/nearby-sync-plan.md 14.4): the file the person last went to get, or checked and found
 * right (`opened`), and the file last found right (`right`), which tells a file in hand from a
 * press that only opened the browser. Each is read once, then held here, so the install file's
 * screen, Share nearby and Sync see a press at once.
 */
function remembered(key: string) {
  let name: string | null | undefined;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const tell = () => { for (const fn of listeners) fn(); };
  return {
    /** The name remembered, null before the first, or undefined until it is read. */
    now: (): string | null | undefined => name,
    subscribe: (fn: () => void): (() => void) => {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    /** Reads the row once a run, and again after a read that failed; a name kept meanwhile wins. */
    load: (): Promise<void> => {
      loading ??= getStore().then((s) => s.meta(key)).then((v) => {
        if (name === undefined) { name = v || null; tell(); }
      }).catch((e: unknown) => { loading = null; throw e; });
      return loading;
    },
    /** Remembers `next`, at once for the screens and then on disk. */
    keep: async (next: string): Promise<void> => {
      if (name !== next) { name = next; tell(); }
      await (await getStore()).setMeta(key, next);
    }
  };
}

const opened = remembered(CARRIED_APK_OPENED_KEY);
const right = remembered(CARRIED_APK_RIGHT_KEY);

export const apkOpenedNow = opened.now;
export const subscribeApkOpened = opened.subscribe;
export const loadApkOpened = opened.load;
export const keepApkOpened = opened.keep;

export const apkRightNow = right.now;
export const subscribeApkRight = right.subscribe;
export const loadApkRight = right.load;
export const keepApkRight = right.keep;
