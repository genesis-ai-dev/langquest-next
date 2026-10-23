import type { SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

/** The Worker's address. The web app is served by it, so there it is the page's own; a phone build without one cannot reach it. */
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || (Platform.OS === 'web' ? '' : null);

export function api(): string {
  if (apiUrl === null) throw new Error('No file server is set up for this build (EXPO_PUBLIC_API_URL).');
  return apiUrl;
}

/** The signed-in person's access token, which the Worker reads as who they are. */
export async function tokenOf(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return token;
}
