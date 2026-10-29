/**
 * Who a GitHub Actions run is, from the OpenID Connect token GitHub gives a
 * job with `id-token: write` (decisions.md 186). The token is signed with
 * GitHub's keys and names the repository, the workflow file and the branch
 * it ran from, so a route can let in one workflow on main and nothing else,
 * with no shared secret in GitHub: a branch, a fork or another workflow gets
 * a token that names itself. RS256 only, checked with WebCrypto; GitHub's
 * keys are fetched once an hour, or again when a token names one not seen.
 */

export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${GITHUB_ISSUER}/.well-known/jwks`;
const KEYS_MS = 60 * 60_000;
/** A key not seen is looked for at most this often, so bad tokens cannot make the Worker fetch on each request. */
const REFETCH_MS = 60_000;
/** Clocks differ a little. */
const SKEW_S = 60;

/** What a route lets in: its audience, and the one workflow on one branch. */
export interface OidcRule {
  audience: string;
  /** `owner/repo/.github/workflows/<file>@refs/heads/main`, as the token's `workflow_ref` says it. */
  workflowRef: string;
}

/** The run a good token says it is. */
export interface GithubRun {
  repository: string;
  workflowRef: string;
  runId: string;
  runAttempt: string;
  eventName: string;
}

type Jwk = JsonWebKey & { kid?: string };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const decoder = new TextDecoder();
function base64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const jsonOf = (s: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(decoder.decode(base64url(s)));
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** A checker that keeps GitHub's keys between requests (one per isolate). */
export function githubOidc(fetcher: Fetch, now: () => number = Date.now) {
  let keys = new Map<string, CryptoKey>();
  let fetchedAt = -Infinity;

  async function load(): Promise<void> {
    fetchedAt = now();
    const res = await fetcher(JWKS_URL);
    if (!res.ok) throw new Error(`github jwks ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const next = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
      next.set(jwk.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    }
    keys = next;
  }

  async function keyFor(kid: string): Promise<CryptoKey | undefined> {
    const stale = now() - fetchedAt > KEYS_MS;
    if (stale || (!keys.has(kid) && now() - fetchedAt > REFETCH_MS)) await load();
    return keys.get(kid);
  }

  /** The run, when the token is GitHub's, unexpired, for this audience and from this workflow on its branch; otherwise null. */
  return async function verify(token: string, rule: OidcRule): Promise<GithubRun | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts as [string, string, string];
    const header = jsonOf(h);
    const claims = jsonOf(p);
    if (!header || !claims || header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') return null;
    const key = await keyFor(header['kid']);
    if (!key) return null;
    let signature: Uint8Array<ArrayBuffer>;
    try {
      signature = base64url(sig);
    } catch {
      return null;
    }
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(`${h}.${p}`)))) return null;
    const t = now() / 1000;
    const aud = claims['aud'];
    const ok = claims['iss'] === GITHUB_ISSUER
      && (aud === rule.audience || (Array.isArray(aud) && aud.includes(rule.audience)))
      && typeof claims['exp'] === 'number' && claims['exp'] > t - SKEW_S
      && (typeof claims['nbf'] !== 'number' || claims['nbf'] <= t + SKEW_S)
      && claims['workflow_ref'] === rule.workflowRef
      && claims['repository'] === rule.workflowRef.split('/').slice(0, 2).join('/')
      && claims['ref'] === rule.workflowRef.slice(rule.workflowRef.indexOf('@') + 1);
    if (!ok) return null;
    return {
      repository: String(claims['repository']), workflowRef: String(claims['workflow_ref']),
      runId: String(claims['run_id'] ?? ''), runAttempt: String(claims['run_attempt'] ?? ''), eventName: String(claims['event_name'] ?? '')
    };
  };
}
