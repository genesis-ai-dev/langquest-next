import { readFileSync } from 'node:fs';
import { ORG_STREAM } from '@langquest-next/core';
import { copyStreamsOf, updatesLookByThemselves } from '../src/shell/updatesHeldModel';

/**
 * Over-the-air updates wait while a teammate's starting copy is held (2026-11-24, review item 26).
 * Why these tests: an update with another reducer, caught at a market, dropped a newcomer's copy
 * at its next start, and offline only a teammate could give it again. The app's own looks skip while
 * a copy is held; expo-updates' own look at each start stops once a store build carries `NEVER`.
 */

const fake = vi.hoisted(() => ({
  person: null as unknown,
  meta: new Map<string, string>(),
  checks: 0,
  fetches: 0,
  enabled: true,
  auto: 'ON_LOAD' as string | null
}));

vi.mock('expo-updates', () => ({
  get isEnabled() { return fake.enabled; },
  get checkAutomatically() { return fake.auto; },
  isEmergencyLaunch: false,
  checkForUpdateAsync: async () => { fake.checks += 1; return { isAvailable: true }; },
  fetchUpdateAsync: async () => { fake.fetches += 1; return { isNew: true }; }
}));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => undefined }));
vi.mock('../src/server/localPerson', () => ({ readLocalPerson: async () => fake.person }));
vi.mock('../src/storage/store', () => ({ getStore: async () => ({ meta: async (k: string) => fake.meta.get(k) }) }));
vi.mock('../src/session/localPersonModel', () => ({
  membershipOf: (p: { orgId: string; languageId: string } | null) => p
}));

beforeEach(() => {
  fake.person = null;
  fake.meta = new Map();
  fake.checks = 0;
  fake.fetches = 0;
  fake.enabled = true;
  fake.auto = 'ON_LOAD';
});

describe('over-the-air updates while a starting copy is held', () => {
  it('a person let in offline may hold a copy of their organization and their language, and nobody else holds one', () => {
    expect(copyStreamsOf({ orgId: 'o1', languageId: 'l1' })).toEqual([{ orgId: 'o1', streamId: ORG_STREAM }, { orgId: 'o1', streamId: 'l1' }]);
    expect(copyStreamsOf(null)).toEqual([]);
  });

  it('looks for an update only while no copy is held, the organization\'s or the language\'s', async () => {
    const { lookForUpdate, startingCopyHere } = await import('../src/shell/updatesHeld.native');
    await lookForUpdate();
    expect([fake.checks, fake.fetches]).toEqual([1, 1]);
    fake.person = { orgId: 'o1', languageId: 'l1' };
    expect(await startingCopyHere()).toBe(false);
    fake.meta.set('startingCopy:o1/l1', '42');
    expect(await startingCopyHere()).toBe(true);
    await lookForUpdate();
    expect([fake.checks, fake.fetches]).toEqual([1, 1]);
    fake.meta = new Map([[`startingCopy:o1/${ORG_STREAM}`, '7']]);
    await lookForUpdate();
    expect(fake.checks).toBe(1);
    // The server's first download replaced it: updates come again.
    fake.meta = new Map([['startingCopy:o1/l1', '']]);
    await lookForUpdate();
    expect(fake.checks).toBe(2);
  });

  // The review of the fixes, 2026-11-24: `checkAutomatically` `NEVER` in app.json changed both platforms' native fingerprint,
  // so the change that carried it could reach no phone by update. It lands with a store build; until then expo-updates looks
  // at each start by itself, and the app's own look at start would only look twice.
  it('the app looks at start only where expo-updates does not look by itself, so no build looks twice', () => {
    expect(updatesLookByThemselves('ON_LOAD')).toBe(true);
    expect(updatesLookByThemselves('WIFI_ONLY')).toBe(true);
    expect(updatesLookByThemselves('NEVER')).toBe(false);
    expect(updatesLookByThemselves('ON_ERROR_RECOVERY')).toBe(false);
    expect(updatesLookByThemselves(null)).toBe(false);
    // Today's setting, which the store builds carry: the app's look at start waits for the build that says NEVER.
    const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as { expo: { updates: { checkAutomatically: string } } };
    expect(updatesLookByThemselves(app.expo.updates.checkAutomatically)).toBe(app.expo.updates.checkAutomatically !== 'NEVER');
  });

  it('looks at start only on a build where expo-updates does not, and then not while a copy is held', async () => {
    const { lookAtStart } = await import('../src/shell/updatesHeld.native');
    await lookAtStart();
    expect(fake.checks).toBe(0);
    fake.auto = 'NEVER';
    await lookAtStart();
    expect([fake.checks, fake.fetches]).toEqual([1, 1]);
    fake.person = { orgId: 'o1', languageId: 'l1' };
    fake.meta.set('startingCopy:o1/l1', '42');
    await lookAtStart();
    expect(fake.checks).toBe(1);
  });
});
