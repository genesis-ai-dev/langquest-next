import { randomBytes, randomUUID } from 'node:crypto';
import { MemoryStore } from '@langquest-next/sync';
import { fakeWorker } from '../../../packages/sync/src/testing/memoryNearbyLink';

/**
 * The path from the shell to the certificate call, drawn as the app draws it (App.tsx `OrgWork`,
 * src/sync/SyncEffects.tsx): `useGlobalViewer` reads get_user_state and hands it to the nearby flag,
 * and `useNearbyIdentity.android` asks the Worker once the organization is pulled and the flag says
 * nearby is on, in either order. React is a small stand-in here (state, refs, effects after the
 * draw, a draw again on a state change), since the app's own tests render no components; the
 * Keystore, the device store, get_user_state and the certificate call are faked, as in
 * nearbyIdentity.test.ts.
 */

const react = vi.hoisted(() => {
  interface Effect { deps: readonly unknown[] | undefined; cleanup: unknown }
  class Root {
    slots: unknown[] = [];
    at = 0;
    pending: (() => void)[] = [];
    drawing = false;
    again = false;
    constructor(readonly render: () => void) {}
    draw(): void {
      if (this.drawing) { this.again = true; return; }
      this.drawing = true;
      try {
        do {
          this.again = false;
          current = this;
          this.at = 0;
          this.render();
          current = null;
          for (const effect of this.pending.splice(0)) effect();
        } while (this.again);
      } finally {
        this.drawing = false;
      }
    }
  }
  let current: Root | null = null;
  const slot = (): [Root, number] => { const r = current!; return [r, r.at++]; };
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((d, i) => Object.is(d, b[i]));
  function useState<T>(init: T | (() => T)): [T, (v: T | ((before: T) => T)) => void] {
    const [r, k] = slot();
    if (!(k in r.slots)) r.slots[k] = typeof init === 'function' ? (init as () => T)() : init;
    const set = (v: T | ((before: T) => T)) => {
      const next = typeof v === 'function' ? (v as (before: T) => T)(r.slots[k] as T) : v;
      if (Object.is(next, r.slots[k])) return;
      r.slots[k] = next;
      r.draw();
    };
    return [r.slots[k] as T, set];
  }
  function useRef<T>(value: T): { current: T } {
    const [r, k] = slot();
    if (!(k in r.slots)) r.slots[k] = { current: value };
    return r.slots[k] as { current: T };
  }
  function useEffect(fn: () => unknown, deps?: readonly unknown[]): void {
    const [r, k] = slot();
    const before = r.slots[k] as Effect | undefined;
    if (before && same(before.deps, deps)) return;
    r.pending.push(() => {
      if (typeof before?.cleanup === 'function') (before.cleanup as () => void)();
      r.slots[k] = { deps, cleanup: fn() } satisfies Effect;
    });
  }
  function useMemo<T>(make: () => T, deps: readonly unknown[]): T {
    const [r, k] = slot();
    const before = r.slots[k] as { deps: readonly unknown[]; value: T } | undefined;
    if (before && same(before.deps, deps)) return before.value;
    const value = make();
    r.slots[k] = { deps, value };
    return value;
  }
  return { Root, useState, useRef, useEffect, useMemo, useCallback: <T>(fn: T, deps: readonly unknown[]) => useMemo(() => fn, deps) };
});

const fake = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  store: null as unknown,
  calls: [] as { publicKey: string; deviceId: string; languages: string[]; proof: string }[],
  answer: null as null | ((req: { publicKey: string; deviceId: string; languages: string[]; proof: string }) => Promise<{ kind: 'answer'; body: unknown } | { kind: 'later'; status: number }>),
  userState: null as unknown,
  heard: null as null | (() => void),
  noted: [] as string[]
}));

vi.mock('react', () => ({ useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useMemo: react.useMemo, useCallback: react.useCallback }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)), randomUUID: () => randomUUID() }));
vi.mock('../src/server/secureStorage', () => ({
  secureStorage: {
    getItem: async (k: string) => fake.secure.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.secure.set(k, v); },
    removeItem: async (k: string) => { fake.secure.delete(k); }
  }
}));
vi.mock('../src/storage/store', () => ({ getStore: async () => fake.store }));
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { availableDiskSpace: 0 } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined }
}));
vi.mock('../src/server/supabase', () => ({ SESSION_KEY: 'sb-session', supabase: { auth: {} } }));
vi.mock('../src/server/nearby', () => ({
  requestCertificate: async (req: (typeof fake.calls)[number]) => { fake.calls.push(req); return fake.answer!(req); }
}));
// get_user_state, answered when the test says.
vi.mock('../src/server/account', () => ({
  userState: () => new Promise((resolve) => { fake.heard = () => resolve({ data: fake.userState, error: null }); })
}));
vi.mock('../src/server/auth', () => ({ onAuthChange: () => () => {} }));
vi.mock('../src/server/globalViewer', () => ({}));
vi.mock('../src/i18n', () => ({ t: (key: string) => key }));
vi.mock('../src/disguise/useDisguise', () => ({ useDisguise: () => ({ look: null }) }));
// The Android files, as Metro gives them to the Android files.
vi.mock('../src/server/nearbyKey', () => import('../src/server/nearbyKey.android'));
vi.mock('../src/nearby/holdChoice', () => import('../src/nearby/holdChoice.android'));
vi.mock('../src/diagnostics/report', () => ({
  noteExpected: (where: string, e: unknown) => { fake.noted.push(`${where}: ${e instanceof Error ? e.message : String(e)}`); },
  failureMessage: () => 'failed'
}));

const ME = '11111111-1111-4111-8111-111111111111';
const worker = fakeWorker('k1');

const org = {
  members: { [ME]: { org: { roleId: { value: 'org_admin', hlc: '', eventId: '' }, removed: { value: false, hlc: '', eventId: '' }, scope: { level: 'org' } } } },
  roles: { org_admin: { name: { value: 'Admin', hlc: '', eventId: '' }, privileges: { value: ['translate'], hlc: '', eventId: '' }, retired: false } },
  languages: { L1: {} }
} as never;

async function load() {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_NEARBY_CERT_KEYS', `k1:${worker.rootKeys.get('k1')}`);
  const { useNearbyIdentity } = await import('../src/nearby/useNearbyIdentity.android');
  const { useGlobalViewer } = await import('../src/account/useGlobalViewer');
  const phone = await import('../src/nearby/nearbyPhone.android');
  return { useNearbyIdentity, useGlobalViewer, phone };
}

/** `OrgWork` and its `SyncEffects`, for an account signed in to the server, in an organization this phone created. */
async function shell() {
  const { useNearbyIdentity, useGlobalViewer, phone } = await load();
  const props = { actorId: ME, signedIn: true, orgId: 'o1', orgPulled: false, org, languageId: 'L1' };
  const effects = new react.Root(() => useNearbyIdentity(props));
  const orgWork = new react.Root(() => { useGlobalViewer(ME, true); });
  // A child's effects run before its parent's.
  effects.draw();
  orgWork.draw();
  return {
    phone,
    pulled: () => { props.orgPulled = true; effects.draw(); },
    serverSays: (state: unknown) => { fake.userState = state; fake.heard!(); }
  };
}

const answered = (req: (typeof fake.calls)[number]) => worker
  .certify({ installKey: req.publicKey, profileId: ME, deviceId: req.deviceId }, { orgId: 'o1', privileges: ['translate'] })
  .then((chain) => ({ kind: 'answer' as const, body: { chains: [{ orgId: 'o1', chain }], discoveryKeys: [], passes: [], revocations: [] } }));

/** Whatever the hooks started has finished. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fake.secure.clear();
  fake.secure.set('sb-session', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1_700_000_000, user: { id: ME } }));
  fake.store = new MemoryStore();
  fake.calls.length = 0;
  fake.noted.length = 0;
  fake.heard = null;
  fake.answer = answered;
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('the shell asks for a certificate once nearby is on', () => {
  it('when get_user_state answers before the organization is pulled', async () => {
    const s = await shell();
    s.serverSays({ orgFeatures: { o1: ['nearby', 'nearby_join'] } });
    await settled();
    expect(fake.calls).toEqual([]);
    s.pulled();
    await vi.waitFor(() => expect(s.phone.holdsCertificate(ME, 'o1')).toBe(true));
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.languages).toEqual(['o1/L1']);
    expect(await (fake.store as MemoryStore).meta(`nearbyCertAsked:${ME}`)).not.toBeNull();
    expect(fake.noted).toEqual([]);
  });

  it('when the organization is pulled before get_user_state answers', async () => {
    const s = await shell();
    s.pulled();
    await settled();
    expect(fake.calls).toEqual([]);
    s.serverSays({ orgFeatures: { o1: ['nearby', 'nearby_join'] } });
    await vi.waitFor(() => expect(s.phone.holdsCertificate(ME, 'o1')).toBe(true));
    expect(fake.calls).toHaveLength(1);
  });

  it('keeps nothing, and says nothing, while the Worker answers 503 (a local Worker with no NEARBY_SIGNING_KEY)', async () => {
    fake.answer = async () => ({ kind: 'later', status: 503 });
    const s = await shell();
    s.serverSays({ orgFeatures: { o1: ['nearby', 'nearby_join'] } });
    s.pulled();
    // The pull and the answer each start a check, and a check after a 503 asks again.
    await vi.waitFor(() => expect(fake.calls.length).toBeGreaterThan(0));
    await settled();
    expect(s.phone.holdsCertificate(ME, 'o1')).toBe(false);
    expect(await (fake.store as MemoryStore).meta(`nearbyCertAsked:${ME}`) ?? null).toBeNull();
    expect(await (fake.store as MemoryStore).meta(`nearbyChain:${ME}`) ?? null).toBeNull();
    expect(fake.noted).toEqual([]);
  });
});
