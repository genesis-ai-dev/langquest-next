import { NotAuthorizedError, OfflineError } from '@langquest-next/sync';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Nearby sync's calls to the app's Worker (docs/nearby-sync-plan.md 5.10, 5.12 "The server's
 * names" and "Claims"; apps/web/worker/nearby.ts). Plain calls with no hooks; the routes are
 * written out whole so `server-calls` records them (decisions.md 151). Nothing here logs a key
 * or a signature.
 */

/** The Worker's address, as blobTransport.ts reads it. */
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || (Platform.OS === 'web' ? '' : null);

/** A bearer-token POST to the Worker; `OfflineError` when it cannot be reached. */
export async function post(path: string, body: unknown): Promise<Response> {
  if (apiUrl === null) throw new Error('No Worker is set up for this build (EXPO_PUBLIC_API_URL).');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  try {
    return await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    // i18n-ignore: the error's message, for diagnostics
    throw new OfflineError(e instanceof Error ? e.message : 'The Worker could not be reached.');
  }
}

/** The Worker answered and did not give what was asked; its status says why. */
export class NearbyCallError extends Error {
  override name = 'NearbyCallError';
  // i18n-ignore: the error's message, for logs and diagnostics; no screen shows it
  constructor(readonly status: number) { super(`The nearby call failed (${status}).`); }
}

export interface CertificateRequest {
  /** This install's public key, base64url. */
  publicKey: string;
  deviceId: string;
  /** `<orgId>/<languageId>` of the languages this phone holds, at most 500. */
  languages: string[];
  /** The install key's signature over the certificate request text. */
  proof: string;
}

/**
 * `POST /api/nearby/certificate`: the answer's body, which src/nearby checks before keeping
 * anything, or `later` on 429 and 503, when the phone keeps what it holds and asks again at its
 * next check. Anything else throws: `OfflineError` with no connection, `NearbyCallError` with
 * the status otherwise.
 */
export async function requestCertificate(request: CertificateRequest): Promise<{ kind: 'answer'; body: unknown } | { kind: 'later'; status: number }> {
  const res = await post('/api/nearby/certificate', request);
  if (res.status === 429 || res.status === 503) return { kind: 'later', status: res.status };
  if (res.status !== 200) throw new NearbyCallError(res.status);
  return { kind: 'answer', body: await res.json() as unknown };
}

const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max;

/**
 * `POST /api/nearby/attest`: the Worker's word for up to 200 rows of this stream past
 * `afterSeq`, which it read itself. Null when nearby sync is off for the organization or the
 * Worker cannot answer yet (503). `NotAuthorizedError` for someone who may not read the
 * stream (403), `OfflineError` with no connection, and `NearbyCallError` for anything else,
 * which costs claims and nothing more (`attestNearby`).
 */
export async function attestPulled(orgId: string, streamId: string, afterSeq: number): Promise<{ text: string; kid: string; sig: string } | null> {
  const res = await post('/api/nearby/attest', { orgId, streamId, afterSeq });
  if (res.status === 503) return null;
  // i18n-ignore: the error's message, for diagnostics
  if (res.status === 403) throw new NotAuthorizedError('Not allowed to read this language.');
  if (res.status !== 200) throw new NearbyCallError(res.status);
  const body = await res.json() as unknown;
  if (body === null) return null;
  const { text, kid, sig } = (typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!isText(text, 1_000_000) || !isText(kid, 64) || !isText(sig, 200)) throw new NearbyCallError(res.status);
  return { text, kid, sig };
}
