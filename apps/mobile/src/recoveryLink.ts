export const recoveryRedirect = 'langquestnext://auth/recovery';
export function parseRecoveryLink(raw: string): { accessToken: string; refreshToken: string } | { code: string } | null {
  const url = new URL(raw);
  if (url.protocol !== 'langquestnext:' || url.hostname !== 'auth' || url.pathname !== '/recovery') return null;
  const params = new URLSearchParams(url.hash.slice(1) || url.search.slice(1));
  if (params.get('error')) throw new Error('This recovery link expired. Request another email.');
  const code = params.get('code');
  if (code) return { code };
  if (params.get('type') !== 'recovery') return null;
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) throw new Error('The recovery link is incomplete. Request another email.');
  return { accessToken, refreshToken };
}
