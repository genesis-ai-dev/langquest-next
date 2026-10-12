import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAttempt, afterMiss, checkCode, codeText, isCode, waitLeft, withHandOver, type Attempt, type HandOver, type Parked } from '../src/handOverCore';

// Decision 88: on a shared phone someone steps aside and comes back with a
// four-number code, with no server call, so offline too.

const sha256 = async (text: string) => createHash('sha256').update(text).digest('hex');
const NOW = Date.parse('2026-10-12T12:00:00Z');

async function parkedWith(code: string): Promise<Parked> {
  return { name: 'Akol Deng', salt: 'salt-1', codeHash: await sha256(codeText('salt-1', 'akol', code)), misses: 0 };
}
const attempt = (over: Partial<Attempt> = {}): Attempt => ({
  sessionGone: false, eventsLeft: 0, accountLeft: 0, finished: [], unregistered: false, ...over
});

describe('a code', () => {
  it('is four digits', () => {
    for (const ok of ['0000', '4821']) expect(isCode(ok)).toBe(true);
    for (const no of ['', '123', '12345', '12a4', '١٢٣٤', ' 1234']) expect(isCode(no)).toBe(false);
  });

  it('is kept only as a salted hash that names the person', async () => {
    const p = await parkedWith('4821');
    expect(JSON.stringify(p)).not.toContain('4821');
    expect(p.codeHash).not.toBe(await sha256(codeText('salt-1', 'mary', '4821')));
  });
});

describe('coming back with a code', () => {
  it('lets the right code in', async () => {
    expect(await checkCode(await parkedWith('4821'), 'akol', '4821', sha256, NOW)).toEqual({ kind: 'ok' });
  });

  it('counts a wrong one, and another person’s right one is wrong here', async () => {
    const p = await parkedWith('4821');
    const wrong = await checkCode(p, 'akol', '1111', sha256, NOW);
    expect(wrong).toEqual({ kind: 'wrong', parked: { ...p, misses: 1 } });
    expect((await checkCode(p, 'mary', '4821', sha256, NOW)).kind).toBe('wrong');
  });

  it('four misses are free; from the fifth each waits twice as long, up to an hour', () => {
    let p: Parked = { name: 'Akol', salt: 's', codeHash: 'h', misses: 0 };
    for (let i = 0; i < 4; i++) p = afterMiss(p, NOW);
    expect(waitLeft(p, NOW)).toBe(0);
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) { p = afterMiss(p, NOW); waits.push(waitLeft(p, NOW) / 60_000); }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });

  it('while waiting, even the right code waits', async () => {
    const p = { ...(await parkedWith('4821')), misses: 5, waitUntil: new Date(NOW + 60_000).toISOString() };
    expect(await checkCode(p, 'akol', '4821', sha256, NOW)).toEqual({ kind: 'wait', ms: 60_000 });
    expect((await checkCode(p, 'akol', '4821', sha256, NOW + 60_000)).kind).toBe('ok');
  });
});

describe('the courier and someone who switched away (decision 60)', () => {
  const akol: HandOver = { actorId: 'akol', uploads: [], savedAt: '2026-10-12T12:00:00Z' };

  it('keeps their session once their work has gone, where a sign-out would end it', async () => {
    expect(afterAttempt(akol, attempt())).toEqual({ kind: 'done' });
    const parked = { ...akol, parked: await parkedWith('4821') };
    expect(afterAttempt(parked, attempt())).toEqual({ kind: 'keep', handOver: parked });
  });

  it('drops them when the server ended their session: they sign in again', async () => {
    expect(afterAttempt({ ...akol, parked: await parkedWith('4821') }, attempt({ sessionGone: true }))).toEqual({ kind: 'drop' });
  });

  it('signing out leaves no code behind', async () => {
    const list = withHandOver([], { ...akol, parked: await parkedWith('4821') });
    expect(withHandOver(list, akol)[0]!.parked).toBeUndefined();
  });
});

describe('what coming back relies on in supabase-js', () => {
  it('a session put back under its key is the one used next, with no server call', async () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: async (k: string) => stored.get(k) ?? null,
      setItem: async (k: string, v: string) => { stored.set(k, v); },
      removeItem: async (k: string) => { stored.delete(k); }
    };
    const requests: string[] = [];
    const client = createClient('https://abcdefgh.supabase.co', 'anon', {
      auth: { storage, storageKey: 'session', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (url: RequestInfo | URL) => { requests.push(String(url)); throw new TypeError('Network request failed'); } }
    });
    expect((await client.auth.getSession()).data.session).toBeNull();
    stored.set('session', JSON.stringify({
      access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'akol', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-05T00:00:00Z' }
    }));
    expect((await client.auth.getSession()).data.session?.user.id).toBe('akol');
    expect(requests).toEqual([]);
  });
});
