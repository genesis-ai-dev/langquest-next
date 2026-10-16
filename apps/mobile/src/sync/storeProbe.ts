import { Platform } from 'react-native';
import { registerDeviceProbe } from '../diagnostics/diagnostics';
import { getStore } from './store';

/**
 * What the local event log holds, for the `device` diagnostics record:
 * streams, events and, on a phone, the database's size. A slow open on a
 * phone holding forty languages is a different problem from one on a phone
 * holding one. A browser leaves the size out: its database lives in the
 * page's storage, and the number would not mean the same.
 *
 * Its own module because store.ts is beneath diagnostics.ts, which reads
 * the store; registering from there would import the two in a circle.
 */
export function watchLocalStore(): void {
  registerDeviceProbe('localStore', async () => {
    const { streams, events, bytes } = await (await getStore()).footprint();
    return { streams, localEvents: events, ...(Platform.OS === 'web' ? {} : { dbMb: Math.round(bytes / (1024 * 1024)) }) };
  });
}
