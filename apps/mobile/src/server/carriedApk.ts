import { Platform } from 'react-native';
import { carriedApkAddress } from './carriedApkModel';

/** The Worker's address, as blobTransport.ts reads it. */
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || (Platform.OS === 'web' ? '' : null);

/**
 * The address of the carried build's file named `name` (docs/nearby-sync-plan.md 14.4), for Let
 * someone in to open in the phone's browser. The app makes no request to it: the browser downloads
 * the file, and the person installs it on the new phone.
 */
export function carriedApkUrl(name: string): string | null {
  return carriedApkAddress(apiUrl, name);
}
