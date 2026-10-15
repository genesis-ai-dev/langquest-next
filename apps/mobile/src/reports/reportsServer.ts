// The reports API on the web Worker (decision 44), when this build has one.
import type { ReportsServer } from '@langquest-next/sync';
import { Platform } from 'react-native';
import { accessToken } from '../server/auth';

/**
 * Where the dashboard's server is (decision 44). The web build is served by
 * it, so there it is the page's own origin unless a setting says otherwise;
 * a phone build without the setting shows only what it folds itself.
 */
export const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || (Platform.OS === 'web' ? '' : null);

export const reportsServer: ReportsServer | null = apiUrl === null ? null : {
  baseUrl: apiUrl,
  token: accessToken
};
