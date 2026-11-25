import { randomBytes, randomUUID } from 'node:crypto';
import type { JoinPass } from '@langquest-next/core/nearby';
import type { HostDetails, HostedGroup, HostOptions, NearbyLink } from '@langquest-next/sync/nearby';
import { parseKey } from '../src/invites/inviteCode';
import { GIVE_IDLE_MS } from '../src/nearby/giveAppModel';
import { LET_IN_CODE_MS, letInCodeMs } from '../src/nearby/letInModel';
import { phoneCryptoOf } from '../src/nearby/nearbyCryptoModel';
import type { PhoneRadio } from '../src/nearby/nearbyLink.native';
import type { NearbyLanguage } from '../src/sync/useLanguage';

/**
 * Let someone in on the inviter's phone, at the radio (src/nearby/nearbyJoin.android.ts
 * `letInWithPass`; docs/nearby-sync-plan.md 14.1, 3 and 14.5). Why these tests: while Give the
 * app serves, the new phone is still on its Wi-Fi after installing, so the code runs on that group
 * and its server hands the join link to the new phone's LangQuest; the link must come off that
 * server as soon as it is used or the attempt ends, however it ends, and Give the app's session
 * ends with the attempt, since Let someone in owns it from the press. Without Give the app,
 * nothing changes: a group of this phone's own, two minutes, nothing published. The pass, the
 * certificate, the gate and the session are faked; the code, the opening and the radio's calls are
 * the real ones.
 */

const fake = vi.hoisted(() => ({
  noted: [] as string[],
  events: [] as string[],
  report: { ended: { how: 'done' }, join: { granted: true, refused: null } } as unknown,
  sessions: 0,
  pieces: true,
  /** Each session's options, as the app built them (review of 2026-11-24, T5). */
  options: [] as Record<string, unknown>[],
  /** Field diagnostics the attempt recorded, with where. */
  diag: [] as { orgId: string; languageId: string; record: unknown }[],
  openOrgs: [] as string[],
  switchOn: true
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)), randomUUID: () => randomUUID() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined, multiSet: async () => undefined }
}));
vi.mock('../src/diagnostics/appBuild', () => ({ appBuild: () => ({}) }));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: (where: string, e: unknown) => { fake.noted.push(`${where}: ${e instanceof Error ? e.message : String(e)}`); } }));
vi.mock('../src/library/docStore', () => ({ docText: async () => null, heldDoc: async () => null, heldDocHead: async () => null, keepFetchedDoc: async () => undefined }));
vi.mock('../src/server/auth', () => ({ savedSignIn: async () => null }));
vi.mock('../src/server/localPerson', () => ({ keepLocalPerson: async () => true, readLocalPerson: async () => null }));
vi.mock('../src/server/lock', () => ({ anyLocks: async () => false, keepFindKeys: async () => undefined }));
vi.mock('../src/server/nearbyKey', () => ({ installKey: async () => null, replaceInstallKey: async () => null }));
vi.mock('../src/storage/store', () => ({ getStore: async () => null, holdsUnsent: async () => false }));
vi.mock('../src/sync/handOver', () => ({ anyHandOvers: async () => false }));
// What the phone knows of the organization's sharing while open, handed on in the grant (2026-11-24).
vi.mock('../src/nearby/nearbyIdentity.native', () => ({
  keepOpenOrgsFromJoin: async () => undefined, nearbyOpenOrgs: async () => new Set<string>(fake.openOrgs), nearbyOpenSwitch: async () => fake.switchOn
}));
vi.mock('../src/nearby/nearbyPhone.native', () => ({
  keepChains: async () => undefined, nearbyGateFor: async () => ({ people: () => [] }), nearbyMakerFor: async () => null, readChains: async () => ({}),
  readRevoked: async () => null, ROOT_KEYS: new Map()
}));
vi.mock('../src/nearby/nearbyRun.native', () => ({
  nearbyDiagFor: (orgId: string, languageId: string) => (record: unknown) => { fake.diag.push({ orgId, languageId, record }); },
  findKeyFor: async () => ({ key: new Uint8Array(32), gen: 1, floor: 0 }),
  nearbyPiecesFor: async () => (fake.pieces
    ? { ok: true, pieces: { crypto: phoneCryptoOf(new Uint8Array(randomBytes(32)), (n: number) => new Uint8Array(randomBytes(n))), chain: [], deviceId: 'd1', signer: {} } }
    : { ok: false })
}));
// The session after the link is taken is sync's, tested there: here it only says it ran and how it ended.
vi.mock('@langquest-next/sync/nearby', async (importOriginal) => {
  const real = await importOriginal<typeof import('@langquest-next/sync/nearby')>();
  class NearbySession {
    constructor(options: Record<string, unknown>) { fake.sessions += 1; fake.options.push(options); }
    run() { fake.events.push('session'); return Promise.resolve(fake.report); }
    stop() { /* nothing runs */ }
  }
  // The record a session's report makes is sync's, tested there: here only that one is made, of a join, and where.
  const sessionDiagOf = (_r: unknown, ms: number, mode: string) => ({ t: { event: 'session', mode }, n: { ms } });
  return { ...real, NearbySession, sessionDiagOf };
});

const GIVE_GROUP = { kind: 'wifi-direct' as const, ssid: 'DIRECT-gv-Android_1a2b', passphrase: 'give-pass-1234', port: 4300 };

/** A radio that records each call in order; its group's one link comes when the test says. */
function fakeRadio(o: { give: boolean; giveFails?: boolean }) {
  let come: (link: NearbyLink | PromiseLike<NearbyLink>) => void = () => undefined;
  const link = new Promise<NearbyLink>((resolve) => { come = resolve; });
  const group = (details: HostDetails): HostDetails & HostedGroup => ({
    ...details, link, onRefused: () => () => undefined, takeDown: async () => { fake.events.push('takeDown'); }
  });
  const radio = {
    giveGroupServing: async () => {
      fake.events.push('giveGroupServing');
      if (o.giveFails) throw new Error('no status');
      return o.give;
    },
    host: async (kind: string, options: HostOptions) => {
      fake.events.push(`host ${kind}`);
      return group({ kind: 'wifi-direct', ssid: options.ssid!, passphrase: options.passphrase!, port: 4100 });
    },
    hostOnGiveGroup: async () => { fake.events.push('hostOnGiveGroup'); return group(GIVE_GROUP); },
    setGiveJoin: async (l: string | null) => { fake.events.push(l === null ? 'setGiveJoin null' : 'setGiveJoin link'); },
    stopGiveApp: async () => { fake.events.push('stopGiveApp'); }
  } as unknown as PhoneRadio;
  const closed: string[] = [];
  const theLink = { kind: 'wifi-direct', close: async () => { closed.push('link'); } } as unknown as NearbyLink;
  return { radio, linkComes: () => come(theLink), closed };
}

async function letIn() {
  return (await import('../src/nearby/nearbyJoin.android')).letInWithPass;
}

/** One attempt, as useLetIn.android.ts starts it, with what its hooks were told. */
async function attempt(radio: PhoneRadio, over: { still?: () => boolean; stopped?: Promise<void>; giveHandedOver?: boolean; worn?: boolean; language?: NearbyLanguage } = {}) {
  const shown: { uri: string; until: number; onGiveGroup: boolean }[] = [];
  const run = (await letIn())({
    radio, actorId: 'ana', orgId: 'o1', languageId: 'l1', roleId: 'translator', pass: {} as JoinPass, org: {} as never, inspectOrg: async () => null,
    language: over.language ?? ({ client: {} } as unknown as NearbyLanguage), orgClient: null, worn: over.worn ?? false, codeMs: letInCodeMs, onSession: () => undefined,
    ...(over.stopped ? { stopped: over.stopped } : {}),
    ...(over.giveHandedOver ? { giveHandedOver: true } : {}),
    hooks: {
      showing: (uri, until, onGiveGroup) => { fake.events.push('showing'); shown.push({ uri, until, onGiveGroup }); },
      connected: () => { fake.events.push('connected'); },
      tap: async () => true,
      progress: () => undefined,
      turnedAway: () => undefined,
      still: over.still ?? (() => true)
    }
  });
  return { run, shown };
}

/** Until the attempt has drawn its code: every step before it is a resolved promise. */
async function untilShown(shown: unknown[]) {
  for (let i = 0; i < 50 && shown.length === 0; i += 1) await vi.advanceTimersByTimeAsync(0);
  expect(shown).toHaveLength(1);
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  fake.events = [];
  fake.noted = [];
  fake.sessions = 0;
  fake.pieces = true;
  fake.options = [];
  fake.diag = [];
  fake.openOrgs = [];
  fake.switchOn = true;
  fake.report = { ended: { how: 'done' }, join: { granted: true, refused: null } };
});
afterEach(() => { vi.useRealTimers(); });

describe('while Give the app serves', () => {
  it('hosts on its group, shows and publishes a code for that group, and keeps it up as long as Give the app waits', async () => {
    const r = fakeRadio({ give: true });
    const { run, shown } = await attempt(r.radio);
    await untilShown(shown);
    const code = parseKey(shown[0]!.uri);
    expect(code).toMatchObject({ kind: 'join', network: 'wifi-direct', ssid: GIVE_GROUP.ssid, passphrase: GIVE_GROUP.passphrase, port: GIVE_GROUP.port });
    expect(shown[0]).toMatchObject({ until: 1_000_000 + GIVE_IDLE_MS, onGiveGroup: true });
    expect(fake.events).toEqual(['giveGroupServing', 'hostOnGiveGroup', 'showing', 'setGiveJoin link']);
    // Still up past a code's usual two minutes: the new phone is still installing.
    await vi.advanceTimersByTimeAsync(LET_IN_CODE_MS + 1);
    expect(fake.events).not.toContain('takeDown');
    await vi.advanceTimersByTimeAsync(GIVE_IDLE_MS - LET_IN_CODE_MS);
    await expect(run).resolves.toEqual({ report: null, why: 'expired' });
    // Nobody used it: off the server, the listener down, and Give the app's session ended with it.
    expect(fake.events.slice(4)).toEqual(['setGiveJoin null', 'takeDown', 'stopGiveApp']);
  });

  it('takes the link off the server once a phone takes it, runs the session as ever, and ends Give the app after', async () => {
    const r = fakeRadio({ give: true });
    const { run, shown } = await attempt(r.radio);
    await untilShown(shown);
    r.linkComes();
    await expect(run).resolves.toEqual({ report: fake.report });
    expect(fake.events).toEqual([
      'giveGroupServing', 'hostOnGiveGroup', 'showing', 'setGiveJoin link', 'setGiveJoin null', 'connected', 'session', 'takeDown', 'stopGiveApp'
    ]);
    expect(fake.sessions).toBe(1);
  });

  it('comes down at once when the person stops or leaves, not at the code\'s end', async () => {
    const r = fakeRadio({ give: true });
    let stop: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => { stop = resolve; });
    let still = true;
    const { run, shown } = await attempt(r.radio, { stopped, still: () => still });
    await untilShown(shown);
    still = false;
    stop();
    await vi.advanceTimersByTimeAsync(0);
    await expect(run).resolves.toEqual({ report: null, why: 'stopped' });
    expect(fake.events.slice(4)).toEqual(['setGiveJoin null', 'takeDown', 'stopGiveApp']);
  });

  it('ends Give the app even when the attempt ends before any code', async () => {
    fake.pieces = false;
    const r = fakeRadio({ give: true });
    const { run } = await attempt(r.radio);
    await expect(run).resolves.toEqual({ report: null, why: 'no-certificate' });
    expect(fake.events).toEqual(['giveGroupServing', 'stopGiveApp']);
  });

  it('a link a phone took after the person left is closed, and still everything comes down', async () => {
    const r = fakeRadio({ give: true });
    let still = true;
    const { run, shown } = await attempt(r.radio, { still: () => still });
    await untilShown(shown);
    still = false;
    r.linkComes();
    await expect(run).resolves.toEqual({ report: null, why: 'stopped' });
    expect(r.closed).toEqual(['link']);
    expect(fake.events.slice(4)).toEqual(['setGiveJoin null', 'takeDown', 'stopGiveApp']);
  });
});

describe('Give the app handed over to Let someone in (giveHandOver.ts)', () => {
  it('runs on its group and ends it with the attempt, once', async () => {
    const r = fakeRadio({ give: true });
    const { run, shown } = await attempt(r.radio, { giveHandedOver: true });
    await untilShown(shown);
    expect(shown[0]!.onGiveGroup).toBe(true);
    await vi.advanceTimersByTimeAsync(GIVE_IDLE_MS);
    await expect(run).resolves.toEqual({ report: null, why: 'expired' });
    expect(fake.events).toEqual(['giveGroupServing', 'hostOnGiveGroup', 'showing', 'setGiveJoin link', 'setGiveJoin null', 'takeDown', 'stopGiveApp']);
  });

  it('a session the code cannot run on (a build without it) is stopped first, so this phone\'s own group can form', async () => {
    const r = fakeRadio({ give: false });
    const { run, shown } = await attempt(r.radio, { giveHandedOver: true });
    await untilShown(shown);
    expect(shown[0]!.onGiveGroup).toBe(false);
    await vi.advanceTimersByTimeAsync(LET_IN_CODE_MS);
    await expect(run).resolves.toEqual({ report: null, why: 'expired' });
    expect(fake.events).toEqual(['giveGroupServing', 'stopGiveApp', 'host wifi-direct', 'showing', 'takeDown']);
  });
});

describe('without Give the app', () => {
  it('hosts a group of its own with a two-minute code, publishes nothing and stops no Give the app', async () => {
    const r = fakeRadio({ give: false });
    const { run, shown } = await attempt(r.radio);
    await untilShown(shown);
    expect(shown[0]).toMatchObject({ until: 1_000_000 + LET_IN_CODE_MS, onGiveGroup: false });
    expect(parseKey(shown[0]!.uri)).toMatchObject({ kind: 'join', network: 'wifi-direct', port: 4100 });
    await vi.advanceTimersByTimeAsync(LET_IN_CODE_MS);
    await expect(run).resolves.toEqual({ report: null, why: 'expired' });
    expect(fake.events).toEqual(['giveGroupServing', 'host wifi-direct', 'showing', 'takeDown']);
  });

  it('runs the session over its own group as before', async () => {
    const r = fakeRadio({ give: false });
    const { run, shown } = await attempt(r.radio);
    await untilShown(shown);
    r.linkComes();
    await expect(run).resolves.toEqual({ report: fake.report });
    expect(fake.events).toEqual(['giveGroupServing', 'host wifi-direct', 'showing', 'connected', 'session', 'takeDown']);
  });

  it('a phone that cannot say whether Give the app serves hosts a group of its own', async () => {
    const r = fakeRadio({ give: true, giveFails: true });
    const { run, shown } = await attempt(r.radio);
    await untilShown(shown);
    expect(shown[0]!.onGiveGroup).toBe(false);
    await vi.advanceTimersByTimeAsync(LET_IN_CODE_MS);
    await expect(run).resolves.toEqual({ report: null, why: 'expired' });
    expect(fake.events).toEqual(['giveGroupServing', 'host wifi-direct', 'showing', 'takeDown']);
    expect(fake.noted).toEqual(['let in: give the app: no status']);
  });
});

// The review of 2026-11-24 (items 2, 8 and 14; T5): the session after the link is taken was faked here with its options
// thrown away, so nothing showed that the app gave it what the join now needs.
describe('the inviter\'s session, as the app builds it', () => {
  const moves = { wanted: async () => [], serveFile: async () => ({ no: 'not-here' as const }), fetchFile: async () => null, landed: async () => undefined, discard: async () => undefined, held: async () => [] };
  const language = { client: { nearbyHelloNow: 1 }, moves } as unknown as NearbyLanguage;
  const linked = async (o: { worn?: boolean } = {}) => {
    const r = fakeRadio({ give: false });
    const { run, shown } = await attempt(r.radio, { language, ...o });
    await untilShown(shown);
    r.linkComes();
    await run;
    expect(fake.options).toHaveLength(1);
    return fake.options[0]!;
  };

  it('moves the language\'s files and library files after the copy, so the newcomer leaves with this phone\'s newest work and its files', async () => {
    const options = await linked();
    expect(options['files']).toBe(moves);
    expect(options['library']).toBeDefined();
    expect(options['copy']).toBeDefined();
    expect(options['join']).toMatchObject({ as: 'inviter' });
  });

  it('notes the join as a meeting only where this phone may share while LangQuest is open, and never under a cover', async () => {
    fake.openOrgs = ['o1'];
    expect((await linked())['notesMetForMs']).toBe(14 * 86_400_000);
    fake.options = [];
    expect((await linked({ worn: true }))['notesMetForMs']).toBeUndefined();
    fake.options = [];
    fake.switchOn = false;
    expect((await linked())['notesMetForMs']).toBeUndefined();
    fake.options = [];
    fake.switchOn = true;
    fake.openOrgs = [];
    expect((await linked())['notesMetForMs']).toBeUndefined();
  });

  it('records the join in field diagnostics, under its organization and language, as a join', async () => {
    await linked();
    expect(fake.diag).toEqual([{ orgId: 'o1', languageId: 'l1', record: { t: { event: 'session', mode: 'join' }, n: { ms: expect.any(Number) } } }]);
  });
});
