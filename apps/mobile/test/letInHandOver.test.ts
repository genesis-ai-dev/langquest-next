import { emptyOrgState, type OrgState } from '@langquest-next/core';
import { letInCodeMs } from '../src/nearby/letInModel';
import { nearbyPermissionsFor } from '../src/nearby/nearbyPermissionsModel';
import type { LetInHandle } from '../src/nearby/useLetIn';
import type { Ctx } from '../src/shell/ctx';

/**
 * Let someone in's screen hook on Android (src/nearby/useLetIn.android.ts) when Give the app hands
 * its running session over (src/nearby/giveHandOver.ts; docs/nearby-sync-plan.md 14.5). Why these
 * tests: Give the app's Let them in leaves its Wi-Fi network and server running for this screen,
 * so this screen must end them if the person leaves without pressing Show the code, or they would
 * run on with nobody watching; once pressed, the attempt owns them and ends them with itself, and
 * leaving brings the code down at once. React is a small stand-in here (state, refs, reducers,
 * effects after the draw, a draw again on a state change, and unmounting), as in
 * nearbyIdentityHook.test.ts; the radio, the pass, the permissions and the attempt are faked.
 */

const react = vi.hoisted(() => {
  interface Effect { deps: readonly unknown[] | undefined; cleanup: unknown }
  const slots: unknown[] = [];
  const effects = new Set<number>();
  let at = 0;
  let pending: (() => void)[] = [];
  let render: (() => void) | null = null;
  let drawing = false;
  let again = false;
  const draw = () => {
    if (!render) return;
    if (drawing) { again = true; return; }
    drawing = true;
    try {
      do {
        again = false;
        at = 0;
        render();
        const run = pending;
        pending = [];
        for (const effect of run) effect();
      } while (again);
    } finally {
      drawing = false;
    }
  };
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((d, i) => Object.is(d, b[i]));
  function useState<T>(init: T | (() => T)): [T, (v: T | ((before: T) => T)) => void] {
    const k = at++;
    if (!(k in slots)) slots[k] = typeof init === 'function' ? (init as () => T)() : init;
    const set = (v: T | ((before: T) => T)) => {
      const next = typeof v === 'function' ? (v as (before: T) => T)(slots[k] as T) : v;
      if (Object.is(next, slots[k])) return;
      slots[k] = next;
      draw();
    };
    return [slots[k] as T, set];
  }
  function useReducer<S, A>(reducer: (s: S, a: A) => S, init: S): [S, (a: A) => void] {
    const [s, set] = useState(init);
    return [s, (a: A) => set((before) => reducer(before, a))];
  }
  function useRef<T>(value: T): { current: T } {
    const k = at++;
    if (!(k in slots)) slots[k] = { current: value };
    return slots[k] as { current: T };
  }
  function useEffect(fn: () => unknown, deps?: readonly unknown[]): void {
    const k = at++;
    effects.add(k);
    const before = slots[k] as Effect | undefined;
    if (before && same(before.deps, deps)) return;
    pending.push(() => {
      if (typeof before?.cleanup === 'function') (before.cleanup as () => void)();
      slots[k] = { deps, cleanup: fn() } satisfies Effect;
    });
  }
  function useMemo<T>(make: () => T, deps: readonly unknown[]): T {
    const k = at++;
    const before = slots[k] as { deps: readonly unknown[]; value: T } | undefined;
    if (before && same(before.deps, deps)) return before.value;
    const value = make();
    slots[k] = { deps, value };
    return value;
  }
  return {
    useState, useReducer, useRef, useEffect, useMemo, useCallback: <T>(fn: T, deps: readonly unknown[]) => useMemo(() => fn, deps),
    mount(fn: () => void) { slots.length = 0; effects.clear(); pending = []; render = fn; draw(); },
    draw,
    unmount() {
      render = null;
      for (const k of effects) {
        const cleanup = (slots[k] as Effect | undefined)?.cleanup;
        if (typeof cleanup === 'function') (cleanup as () => void)();
      }
      effects.clear();
    }
  };
});

const fake = vi.hoisted(() => ({
  focused: true,
  calls: [] as string[],
  attempts: [] as Record<string, unknown>[],
  finish: null as null | ((out: unknown) => void),
  noted: [] as string[],
  /** The passes this phone holds for the language: their expiries. */
  expiries: [Number.MAX_SAFE_INTEGER] as number[],
  /** The open language's Hello clock (`nearbyHelloNow`); undefined reads as none, and the hook takes the wall. */
  helloNow: undefined as number | undefined,
  /** What the language's and the organization's `canGiveCopy` answer (review item 5). */
  copy: { ok: true } as { ok: boolean; why?: string; fill?: { filled: number; total: number } },
  orgCopy: { ok: true } as { ok: boolean; why?: string },
  /** The language's nearby meta rows, where the people let in under each pass are kept (review item 7). */
  meta: new Map<string, string>()
}));

vi.mock('react', () => ({
  useState: react.useState, useReducer: react.useReducer, useRef: react.useRef, useEffect: react.useEffect, useMemo: react.useMemo, useCallback: react.useCallback
}));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) } }));
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: async () => undefined, deactivateKeepAwake: async () => undefined }));
vi.mock('../src/account/chainNames', () => ({ noteChainNames: async () => undefined, readChainNames: async () => ({}) }));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: (where: string, e: unknown) => { fake.noted.push(`${where}: ${e instanceof Error ? e.message : String(e)}`); } }));
vi.mock('../src/shell/useAppCovered', () => ({ useAppCovered: () => ({ covered: false, worn: false }) }));
vi.mock('../src/nearby/useNearby.native', () => ({ useFocus: () => fake.focused }));
vi.mock('../src/nearby/nearbyFlag', () => ({ nearbyFlag: () => ({ features: null }) }));
vi.mock('../src/nearby/nearbyPermissions.android', () => ({
  androidSdk: () => 34,
  askingForNearby: () => false,
  askNearbyPermissions: async () => ({}),
  checkNearbyPermissions: async () => Object.fromEntries(nearbyPermissionsFor(34).map((p) => [p, 'granted'])),
  openNearbySettings: async () => undefined
}));
vi.mock('../src/nearby/nearbyPhone.native', () => ({
  joinPassesFor: async () => fake.expiries.map((expiresAt, i) => ({
    kind: 'pass@1', kid: 'k1', sig: 's',
    body: { passId: `p${i}`, orgId: 'o1', languageId: 'l1', inviter: 'ana', inviterKey: 'K', roles: [{ roleId: 'tr', privileges: ['translate'] }], maxUses: 10, expiresAt }
  }))
}));
vi.mock('../src/nearby/nearbyLink.native', () => {
  const radio = {
    facts: async () => ({ wifiOn: true }),
    stopGiveApp: async () => { fake.calls.push('stopGiveApp'); }
  };
  return { nearbyRadio: () => radio };
});
// The attempt is letInWithPass's, tested in letInWithPass.test.ts: here it waits until the test ends it.
vi.mock('../src/nearby/nearbyJoin.android', () => ({
  letInWithPass: (o: Record<string, unknown>) => {
    fake.attempts.push(o);
    fake.calls.push('attempt');
    return new Promise((resolve) => { fake.finish = resolve; });
  }
}));

const org: OrgState = emptyOrgState();

const ctx = {
  session: { actorId: 'ana', readOnly: false, isLocal: false },
  language: {
    orgId: 'o1', languageId: 'l1',
    nearby: () => ({
      client: { get nearbyHelloNow() { return fake.helloNow; }, canGiveCopy: async () => fake.copy, nearbyMeta: async (k: string) => fake.meta.get(k) ?? null },
      moves: null
    })
  },
  org: { state: org, inspect: async () => null, client: () => ({ canGiveCopy: async () => fake.orgCopy }) }
} as unknown as Ctx;

let handle: LetInHandle;

async function open() {
  const { useLetIn } = await import('../src/nearby/useLetIn.android');
  react.mount(() => { handle = useLetIn(ctx); });
  // The pass, the permissions and Wi-Fi are read after the first draw.
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  react.draw();
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function leave() {
  fake.focused = false;
  react.draw();
}

beforeEach(() => {
  vi.resetModules();
  fake.focused = true;
  fake.calls = [];
  fake.attempts = [];
  fake.finish = null;
  fake.noted = [];
  fake.expiries = [Number.MAX_SAFE_INTEGER];
  fake.helloNow = undefined;
  fake.copy = { ok: true };
  fake.orgCopy = { ok: true };
  fake.meta = new Map();
});

describe('Give the app handed over to Let someone in', () => {
  it('takes the hand-over on opening, and ends Give the app if left without pressing Show the code', async () => {
    const { handGiveOver: hand, giveHandedOver: handed } = await import('../src/nearby/giveHandOver');
    hand();
    await open();
    expect(handed()).toBe(false);
    expect(handle.whyNot).toBeNull();
    expect(fake.calls).toEqual([]);
    leave();
    await settle();
    expect(fake.calls).toEqual(['stopGiveApp']);
    // Once: going away after that stops nothing more.
    react.unmount();
    await settle();
    expect(fake.calls).toEqual(['stopGiveApp']);
  });

  it('takes a hand-over made while it was under Give the app, when it comes back into view', async () => {
    // Let someone in opened Give the app (from: let_someone_in), whose Let them in goes back to it:
    // the same screen, still mounted, so the hand-over comes after its mount (review, 2026-11-20).
    const { handGiveOver: hand, giveHandedOver: handed } = await import('../src/nearby/giveHandOver');
    await open();
    leave();
    await settle();
    hand();
    fake.focused = true;
    react.draw();
    await settle();
    expect(handed()).toBe(false);
    expect(fake.calls).toEqual([]);
    leave();
    await settle();
    expect(fake.calls).toEqual(['stopGiveApp']);
  });

  it('ends Give the app when the screen goes without pressing, as by Back', async () => {
    const { handGiveOver: hand } = await import('../src/nearby/giveHandOver');
    hand();
    await open();
    react.unmount();
    await settle();
    expect(fake.calls).toEqual(['stopGiveApp']);
  });

  it('stops nothing when nothing was handed over', async () => {
    await open();
    leave();
    react.unmount();
    await settle();
    expect(fake.calls).toEqual([]);
  });

  it('once pressed, the attempt owns the session: it is told so, and leaving brings its code down at once instead', async () => {
    const { handGiveOver: hand } = await import('../src/nearby/giveHandOver');
    hand();
    await open();
    expect(handle.state.roleId).toBe('tr');
    handle.actions.show();
    await settle();
    expect(fake.calls).toEqual(['attempt']);
    const a = fake.attempts[0]!;
    expect(a['giveHandedOver']).toBe(true);
    const codeMs = a['codeMs'] as (onGiveGroup: boolean) => number;
    expect([codeMs(true), codeMs(false)]).toEqual([letInCodeMs(true), letInCodeMs(false)]);
    let left = false;
    void (a['stopped'] as Promise<void>).then(() => { left = true; });
    // The code is on Give the app's group: the screen says so, with Give the app's fifteen minutes.
    const hooks = a['hooks'] as { showing(uri: string, until: number, onGiveGroup: boolean): void };
    hooks.showing('langquestnext://join?v=1', Date.now() + 15 * 60_000, true);
    expect(handle.state.stage).toMatchObject({ t: 'showing', onGiveGroup: true });
    expect(handle.code).toBe('langquestnext://join?v=1');
    leave();
    await settle();
    expect(left).toBe(true);
    // The attempt stops Give the app as it ends (letInWithPass); the screen does not stop it twice.
    fake.finish!({ report: null, why: 'stopped' });
    react.unmount();
    await settle();
    expect(fake.calls).toEqual(['attempt']);
  });

  it('a second attempt after the first is not handed the session again', async () => {
    const { handGiveOver: hand } = await import('../src/nearby/giveHandOver');
    hand();
    await open();
    handle.actions.show();
    await settle();
    fake.finish!({ report: null, why: 'expired' });
    await settle();
    expect(handle.state.stage).toMatchObject({ t: 'ended', why: 'expired' });
    handle.actions.show();
    await settle();
    expect(fake.attempts.map((a) => a['giveHandedOver'] === true)).toEqual([true, false]);
  });
});

// Carl, 2026-11-24 (decision 240 as amended): a pass ends with its window, so the screen says how long this phone can
// still let people in, warns under 30 days, and checks on the clock Hello uses, which setting the date back cannot move.
describe('how long this phone can let people in', () => {
  const DAY = 86_400_000;

  it('says the days left until its last pass expires, and warns under 30', async () => {
    fake.helloNow = 1_000 * DAY;
    fake.expiries = [1_010 * DAY];
    await open();
    expect(handle.whyNot).toBeNull();
    expect(handle.daysLeft).toEqual({ days: 10, warn: true });
    react.unmount();
    // The next window's pass, held in this one's last 30 days: the days run to its end, and the current pass is the one used.
    fake.expiries = [1_010 * DAY, 1_100 * DAY];
    await open();
    expect(handle.daysLeft).toEqual({ days: 100, warn: false });
    react.unmount();
  });

  it('checks the pass on Hello\'s clock, not the wall, so a date set back does not bring it back', async () => {
    fake.expiries = [Date.now() + DAY];
    fake.helloNow = Date.now() + 2 * DAY;
    await open();
    expect(handle.whyNot).toBe('expired');
    expect(handle.daysLeft).toBeNull();
    react.unmount();
  });
});

// The review of 2026-11-24, items 5 and 7: the code showed on a phone with no whole copy to give, and past the pass's count.
describe('before the code is shown', () => {
  it('shows no code while this phone\'s own copy is not whole, and says how far its fill has come', async () => {
    fake.copy = { ok: false, why: 'filling', fill: { filled: 4, total: 12 } };
    await open();
    expect(handle.whyNot).toBe('copy-not-ready');
    expect(handle.copyReady).toEqual({ ok: false, why: 'filling', fill: { filled: 4, total: 12 } });
    handle.actions.show();
    await settle();
    expect(fake.attempts).toEqual([]);
    react.unmount();
    // The organization not downloaded to the server's newest: no code either.
    fake.copy = { ok: true };
    fake.orgCopy = { ok: false, why: 'downloading' };
    await open();
    expect(handle.whyNot).toBe('copy-not-ready');
    react.unmount();
  });

  it('shows no code once this phone let in as many people as its pass allows, and offers the next pass with room', async () => {
    fake.meta.set('nearbyLetIn:o1/l1', JSON.stringify([['p0', Array.from({ length: 10 }, (_, i) => `n${i}`)]]));
    await open();
    expect(handle.whyNot).toBe('used-up');
    handle.actions.show();
    await settle();
    expect(fake.attempts).toEqual([]);
    react.unmount();
    // The next window's pass, held too: it is the one offered.
    fake.expiries = [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER];
    await open();
    expect(handle.whyNot).toBeNull();
    handle.actions.show();
    await settle();
    expect((fake.attempts[0]!['pass'] as { body: { passId: string } }).body.passId).toBe('p1');
    fake.finish!({ report: null, why: 'stopped' });
    react.unmount();
  });
});
