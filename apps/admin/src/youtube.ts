import { PAGE_PATH } from './paths';
import { SECURITY_HEADERS } from './page';

/** An action's largest body: a Publish of every video in every language (47 × 15, about 110 bytes each) and room to grow. */
export const ACTION_BYTES = 256 * 1024;

/**
 * Back from Google's page: what it sent goes to the page after the #, which
 * no server sees, and the page posts it with the person's own token
 * (`youtube-connect`), where the app Worker checks it came from them. This
 * Worker keeps and checks nothing here.
 */
export function youtubeCallback(url: URL): Response {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const answer = code && state ? { 'youtube-code': code, 'youtube-state': state } : { 'youtube-error': (url.searchParams.get('error') ?? 'no_code').slice(0, 80) };
  return new Response(null, { status: 302, headers: { location: `${PAGE_PATH}#${new URLSearchParams(answer)}`, 'cache-control': 'no-store', ...SECURITY_HEADERS } });
}
