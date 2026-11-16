import { getStore } from '../storage/store';
import { CARRIED_APK_OPENED_KEY } from './carriedApkModel';

/**
 * The name of the carried build's file the person last went to get, or checked and found right
 * (docs/nearby-sync-plan.md 14.4), kept in one phone-wide meta row that holds nothing but that
 * name. Read once, then held here, so Get the install file and Share nearby see a press at once.
 */
let opened: string | null | undefined;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const tell = () => { for (const fn of listeners) fn(); };

/** The name remembered, null before the first press, or undefined until it is read. */
export function apkOpenedNow(): string | null | undefined {
  return opened;
}

export function subscribeApkOpened(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Reads the row once a run, and again after a read that failed; a press made meanwhile wins. */
export function loadApkOpened(): Promise<void> {
  loading ??= getStore().then((s) => s.meta(CARRIED_APK_OPENED_KEY)).then((v) => {
    if (opened === undefined) { opened = v || null; tell(); }
  }).catch((e: unknown) => { loading = null; throw e; });
  return loading;
}

/** Remembers `name` as the file the person has, at once for the screens and then on disk. */
export async function keepApkOpened(name: string): Promise<void> {
  if (opened !== name) { opened = name; tell(); }
  await (await getStore()).setMeta(CARRIED_APK_OPENED_KEY, name);
}
