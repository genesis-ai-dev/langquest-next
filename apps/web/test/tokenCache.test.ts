import { describe, expect, it } from 'vitest';
import { grantFor, type AgentDeps } from '../worker/agent/http';
import type { TokenRecord } from '../worker/agent/store';
import { TOKEN_TTL_MS, TtlCache } from '../worker/isolateCache';
import { hashSecret, TOKEN_PREFIX } from '../worker/agent/tokens';

const SECRET = `${TOKEN_PREFIX}abc`;
const record = (patch: Partial<TokenRecord> = {}): TokenRecord => ({
  id: 't1', orgId: 'o', profileId: 'p', name: 'n', scopes: ['read'], languageIds: null, createdVia: 'page',
  clientName: null, createdAt: '2026-01-01T00:00:00Z', expiresAt: null, revokedAt: null, lastUsedAt: null, ...patch
});

function setup(options: { withCache?: boolean; waitUntil?: boolean } = {}) {
  let now = Date.parse('2026-10-26T00:00:00Z');
  let stored: TokenRecord | null = record();
  const calls = { lookups: 0, touches: 0 };
  const waited: Promise<unknown>[] = [];
  let release!: () => void;
  const touchGate = new Promise<void>((r) => { release = r; });
  const deps = {
    store: {
      tokenByHash: async (hash: string) => { calls.lookups += 1; expect(hash).toBe(await hashSecret(SECRET)); return stored ? { ...stored } : null; },
      touchToken: async () => { calls.touches += 1; await touchGate; }
    },
    now: () => now,
    ...(options.withCache === false ? {} : { tokenCache: new TtlCache<TokenRecord>(10, () => now) }),
    ...(options.waitUntil ? { waitUntil: (p: Promise<unknown>) => { waited.push(p); } } : {})
  } as unknown as AgentDeps;
  const request = () => new Request('https://lq.test/api/v1/me', { headers: { authorization: `Bearer ${SECRET}` } });
  return { deps, calls, request, waited, release, advance: (ms: number) => { now += ms; }, revoke: () => { stored = record({ revokedAt: 'x' }); }, unknown: () => { stored = null; } };
}

describe('the token cache', () => {
  it('reads the database once for calls within the window, and again after it', async () => {
    const s = setup();
    s.release();
    for (let i = 0; i < 3; i++) expect(await grantFor(s.request(), s.deps)).not.toBeInstanceOf(Response);
    expect(s.calls.lookups).toBe(1);
    s.advance(TOKEN_TTL_MS);
    await grantFor(s.request(), s.deps);
    expect(s.calls.lookups).toBe(2);
  });

  it('notices a revocation once the window has passed', async () => {
    const s = setup();
    s.release();
    await grantFor(s.request(), s.deps);
    s.revoke();
    expect(await grantFor(s.request(), s.deps)).not.toBeInstanceOf(Response);
    s.advance(TOKEN_TTL_MS);
    const refused = await grantFor(s.request(), s.deps);
    expect(refused).toBeInstanceOf(Response);
    expect((refused as Response).status).toBe(401);
  });

  it('does not remember an unknown token', async () => {
    const s = setup();
    s.release();
    s.unknown();
    expect(await grantFor(s.request(), s.deps)).toBeInstanceOf(Response);
    expect(await grantFor(s.request(), s.deps)).toBeInstanceOf(Response);
    expect(s.calls.lookups).toBe(2);
  });

  it('does not wait for the last-used write, and writes it once per window', async () => {
    const s = setup({ waitUntil: true });
    // The write is held open: a response that waited for it would never come.
    expect(await grantFor(s.request(), s.deps)).not.toBeInstanceOf(Response);
    await grantFor(s.request(), s.deps);
    expect(s.calls.touches).toBe(1);
    expect(s.waited).toHaveLength(1);
    s.release();
    await Promise.all(s.waited);
  });

  it('keeps asking every time without a cache', async () => {
    const s = setup({ withCache: false });
    s.release();
    await grantFor(s.request(), s.deps);
    await grantFor(s.request(), s.deps);
    expect(s.calls.lookups).toBe(2);
  });
});
